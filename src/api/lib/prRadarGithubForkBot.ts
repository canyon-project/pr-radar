import axios from "axios";
import crypto from "node:crypto";

import type { PrRadarWatchTask } from "@prisma/client";

import { prisma } from "@/api/lib/prisma.ts";
import type { PrRadarPollLogFn } from "@/api/lib/prRadarPollLog.ts";

const GH_API_BASE = "https://api.github.com";

/** 大型仓库 fork 时 GitHub 可能长时间才返回 HTTP 响应；axios 默认无超时易表现为「卡住」*/
const GH_FORK_CREATE_TIMEOUT_MS = 300_000;

/** fork 创建后对象同步可能超过数分钟（官方文档亦提示需等待）*/
const GH_FORK_READY_MAX_MS = 600_000;

async function logLine(cb: PrRadarPollLogFn | undefined, msg: string) {
  await Promise.resolve(cb?.(msg));
}

export function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function parseGithubAxiosMessage(status: number, data: unknown): string {
  const raw = typeof data === "string" ? data : JSON.stringify(data ?? {});
  return `(${status}) ${raw.slice(0, 900)}`;
}

async function axiosThrowGitHub<T>(
  label: string,
  request: Promise<{ status: number; data: unknown }>,
): Promise<T> {
  const res = await request;
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`${label} ${parseGithubAxiosMessage(res.status, res.data)}`);
  }
  return res.data as T;
}

export async function fetchAuthenticatedLogin(token: string): Promise<string> {
  const data = await axiosThrowGitHub<{ login: string }>(
    "读取 GitHub 用户失败",
    axios.get(`${GH_API_BASE}/user`, { headers: ghHeaders(token), validateStatus: () => true }),
  );
  if (!data.login) throw new Error("GitHub 用户缺少 login 字段");
  return data.login;
}

function sanitizeSlugPart(segment: string): string {
  const s = segment
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return s.length > 0 ? s : "x";
}

/** 形如 `${org}-${repo}-${randomSuffix}`（随机后缀不含连接符前缀）*/
function composeForkRepoName(upstreamOwner: string, upstreamRepo: string, randomSuffix: string): string {
  const o = sanitizeSlugPart(upstreamOwner);
  const r = sanitizeSlugPart(upstreamRepo);
  let base = `${o}-${r}`;
  const suffixWithDash = `-${sanitizeSlugPart(randomSuffix)}`;
  const maxBase = Math.max(1, 100 - suffixWithDash.length);
  if (base.length > maxBase) base = base.slice(0, maxBase).replace(/-+$/, "") || "upstream";
  return `${base}${suffixWithDash}`;
}

async function githubRepoAccessible(token: string, owner: string, repo: string): Promise<boolean> {
  const res = await axios.get(`${GH_API_BASE}/repos/${owner}/${repo}`, {
    headers: ghHeaders(token),
    validateStatus: () => true,
  });
  return res.status === 200;
}

type RepoPayload = {
  name?: string;
  fork?: boolean;
  parent?: { full_name?: string };
};

async function githubGetRepo(token: string, owner: string, repo: string): Promise<RepoPayload | null> {
  const res = await axios.get<RepoPayload>(`${GH_API_BASE}/repos/${owner}/${repo}`, {
    headers: ghHeaders(token),
    validateStatus: () => true,
  });
  if (res.status !== 200) return null;
  return res.data ?? null;
}

function upstreamMatchesParent(parentFullName: string | undefined, upstreamOwner: string, upstreamRepo: string) {
  if (!parentFullName) return false;
  const needle = `${upstreamOwner}/${upstreamRepo}`.toLowerCase();
  return parentFullName.toLowerCase() === needle;
}

type ForkCreateApiPayload = {
  name?: string;
  fork?: boolean;
  parent?: { full_name?: string };
};

function actualForkRepoSlugFromCreateResponse(requestedName: string, data: unknown): string {
  const p = data && typeof data === "object" ? (data as ForkCreateApiPayload) : null;
  const n = typeof p?.name === "string" && p.name.trim().length > 0 ? p.name.trim() : null;
  return n ?? requestedName;
}

async function githubCreateFork(
  token: string,
  upstreamOwner: string,
  upstreamRepo: string,
  forkRepoName: string,
): Promise<string> {
  const res = await axios.post(
    `${GH_API_BASE}/repos/${upstreamOwner}/${upstreamRepo}/forks`,
    { name: forkRepoName, default_branch_only: true },
    {
      headers: ghHeaders(token),
      validateStatus: () => true,
      timeout: GH_FORK_CREATE_TIMEOUT_MS,
    },
  );
  const bodyStr =
    typeof res.data === "string" ? res.data : JSON.stringify(res.data ?? null, null, 2);
  const maxLen = 16_384;
  const truncated = bodyStr.length > maxLen ? `${bodyStr.slice(0, maxLen)}…(truncated ${bodyStr.length} chars)` : bodyStr;
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`创建 fork「${upstreamOwner}/${upstreamRepo}」→「${forkRepoName}」失败 ${parseGithubAxiosMessage(res.status, res.data)}`);
  }
  const actualSlug = actualForkRepoSlugFromCreateResponse(forkRepoName, res.data);
  return actualSlug;
}

async function awaitForkAccessible(
  token: string,
  forkOwner: string,
  forkRepoName: string,
  log?: PrRadarPollLogFn,
): Promise<void> {
  const maxMs = GH_FORK_READY_MAX_MS;
  const pollMs = 4_000;
  const deadline = Date.now() + maxMs;
  const started = Date.now();
  let lastProgressLog = started;
  await logLine(log, `Fork：创建 API 已返回，正在等待远端仓库就绪（大型仓库可能需数分钟）…`);
  while (Date.now() < deadline) {
    if (await githubRepoAccessible(token, forkOwner, forkRepoName)) return;
    const now = Date.now();
    if (now - lastProgressLog >= 30_000) {
      const waitedSec = Math.round((now - started) / 1000);
      await logLine(log, `Fork：仍等待仓库就绪（已约 ${waitedSec}s）…`);
      lastProgressLog = now;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`Fork 仓库就绪超时「${forkOwner}/${forkRepoName}」（已等待约 ${Math.round(maxMs / 1000)}s）`);
}

export async function ensureUpstreamForkMapped(
  token: string,
  upstreamOwner: string,
  upstreamRepo: string,
  log?: PrRadarPollLogFn,
): Promise<{ forkOwner: string; forkRepo: string }> {
  await logLine(log, `Fork：校验 / 映射 ${upstreamOwner}/${upstreamRepo}`);
  const login = await fetchAuthenticatedLogin(token);

  const row = await prisma.prRadarUpstreamFork.findUnique({
    where: {
      upstreamOwner_upstreamRepo_githubLogin: {
        upstreamOwner,
        upstreamRepo,
        githubLogin: login,
      },
    },
  });

  if (row) {
    const okDirect = await githubRepoAccessible(token, login, row.forkRepoName);
    if (!okDirect) {
      await prisma.prRadarUpstreamFork.deleteMany({
        where: { id: row.id },
      });
    } else {
      const r = { forkOwner: login, forkRepo: row.forkRepoName };
      await logLine(log, `Fork：复用 DB 记录 ${r.forkOwner}/${r.forkRepo}`);
      return r;
    }
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const suffix = crypto.randomBytes(6).toString("hex"); // ~12 chars
    const forkRepoName = composeForkRepoName(upstreamOwner, upstreamRepo, suffix);

    if (await githubRepoAccessible(token, login, forkRepoName)) {
      const meta = await githubGetRepo(token, login, forkRepoName);
      const actualName =
        typeof meta?.name === "string" && meta.name.length > 0 ? meta.name : forkRepoName;
      if (meta?.fork && upstreamMatchesParent(meta.parent?.full_name, upstreamOwner, upstreamRepo)) {
        await prisma.prRadarUpstreamFork.upsert({
          where: {
            upstreamOwner_upstreamRepo_githubLogin: {
              upstreamOwner,
              upstreamRepo,
              githubLogin: login,
            },
          },
          create: {
            upstreamOwner,
            upstreamRepo,
            githubLogin: login,
            forkRepoName: actualName,
            randomSuffix: suffix,
          },
          update: {
            forkRepoName: actualName,
            randomSuffix: suffix,
          },
        });
        const r = { forkOwner: login, forkRepo: actualName };
        await logLine(log, `Fork：认领已存在 remote ${r.forkOwner}/${r.forkRepo}`);
        return r;
      }

      /** 名称冲突但被他人占用或非该上游 fork → 换新名重试 */
      continue;
    }

    try {
      await logLine(log, `Fork：尝试创建远端仓库名 ${forkRepoName} …`);
      const actualForkRepo = await githubCreateFork(token, upstreamOwner, upstreamRepo, forkRepoName);
      if (actualForkRepo !== forkRepoName) {
        await logLine(
          log,
          `Fork：API 实际仓库名「${actualForkRepo}」（与请求「${forkRepoName}」不一致，常以已有 fork / 202 为准）`,
        );
      }
      await awaitForkAccessible(token, login, actualForkRepo, log);

      await prisma.prRadarUpstreamFork.upsert({
        where: {
          upstreamOwner_upstreamRepo_githubLogin: {
            upstreamOwner,
            upstreamRepo,
            githubLogin: login,
          },
        },
        create: {
          upstreamOwner,
          upstreamRepo,
          githubLogin: login,
          forkRepoName: actualForkRepo,
          randomSuffix: suffix,
        },
        update: {
          forkRepoName: actualForkRepo,
          randomSuffix: suffix,
        },
      });

      const r = { forkOwner: login, forkRepo: actualForkRepo };
      await logLine(log, `Fork：创建完成 ${r.forkOwner}/${r.forkRepo}`);
      return r;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        /\b422\b|\b409\b/.test(msg) ||
        msg.toLowerCase().includes("already exists") ||
        msg.toLowerCase().includes("name already exists") ||
        msg.toLowerCase().includes("duplicate")
      ) {
        continue;
      }
      throw e;
    }
  }

  throw new Error("多次尝试后仍未成功创建或认领 fork，请稍后重试或检查 Token 权限。");
}

/** 对齐 fork 中与 upstream 同名的追踪分支（一般即监听任务的 base branch）*/
export async function syncForkUpstreamBranch(
  token: string,
  forkOwner: string,
  forkRepo: string,
  branch: string,
): Promise<void> {
  await axiosThrowGitHub(
    `sync fork 「${forkOwner}/${forkRepo}」与 upstream「${branch}」失败`,
    axios.post(
      `${GH_API_BASE}/repos/${forkOwner}/${forkRepo}/merge-upstream`,
      { branch },
      { headers: ghHeaders(token), validateStatus: () => true },
    ),
  );
}

async function githubGetPullMergeSha(
  token: string,
  upstreamOwner: string,
  upstreamRepo: string,
  prNumber: number,
): Promise<string | null> {
  const data = await axiosThrowGitHub<{ merge_commit_sha?: string | null }>(
    `获取 PR #${prNumber} 详情失败`,
    axios.get(`${GH_API_BASE}/repos/${upstreamOwner}/${upstreamRepo}/pulls/${prNumber}`, {
      headers: ghHeaders(token),
      validateStatus: () => true,
    }),
  );
  const sha = data.merge_commit_sha ?? null;
  return sha && sha.length >= 7 ? sha : null;
}

async function commitAccessible(token: string, forkOwner: string, forkRepo: string, sha: string): Promise<boolean> {
  const res = await axios.get(`${GH_API_BASE}/repos/${forkOwner}/${forkRepo}/commits/${sha}`, {
    headers: ghHeaders(token),
    validateStatus: () => true,
  });
  return res.status === 200;
}

export function botBranchNameForPr(prNumber: number): string {
  return `canyon-bot/pr-${prNumber}`;
}

async function githubCreateRef(
  token: string,
  forkOwner: string,
  forkRepo: string,
  branchShort: string,
  sha: string,
): Promise<void> {
  await axiosThrowGitHub(
    `创建分支「refs/heads/${branchShort}」失败`,
    axios.post(
      `${GH_API_BASE}/repos/${forkOwner}/${forkRepo}/git/refs`,
      { ref: `refs/heads/${branchShort}`, sha },
      { headers: ghHeaders(token), validateStatus: () => true },
    ),
  );
}

async function githubPatchBranchRefSha(
  token: string,
  forkOwner: string,
  forkRepo: string,
  branchShort: string,
  sha: string,
  force = true,
): Promise<void> {
  const url = `${GH_API_BASE}/repos/${forkOwner}/${forkRepo}/git/refs/heads/${encodeURIComponent(branchShort)}`;
  await axiosThrowGitHub(
    `移动分支「${branchShort}」到 ${sha.slice(0, 7)} 失败`,
    axios.patch<{ object: { sha: string } }>(url, { sha, force }, { headers: ghHeaders(token), validateStatus: () => true }),
  );
}

async function githubCreateBranchOrPointToSha(
  token: string,
  forkOwner: string,
  forkRepo: string,
  branchShort: string,
  sha: string,
): Promise<void> {
  try {
    await githubCreateRef(token, forkOwner, forkRepo, branchShort, sha);
    return;
  } catch (eFirst) {
    const msgFirst = eFirst instanceof Error ? eFirst.message : String(eFirst);
    /** 分支已存在：移动到本次 merge_sha */
    if (/\(422\)/.test(msgFirst) || /already exists/i.test(msgFirst)) {
      await githubPatchBranchRefSha(token, forkOwner, forkRepo, branchShort, sha, true);
      return;
    }
    throw eFirst;
  }
}

/** GitHub Contents API：新建与更新都应使用 PUT */
async function githubPutTestMd(args: {
  token: string;
  forkOwner: string;
  forkRepo: string;
  branchShort: string;
  prNumber: number;
  mergeSha: string;
}): Promise<void> {
  const { token, forkOwner, forkRepo, branchShort, prNumber, mergeSha } = args;

  type ContentResp = {
    sha?: string;
    type?: string;
  };

  const getRes = await axios.get<ContentResp>(
    `${GH_API_BASE}/repos/${forkOwner}/${forkRepo}/contents/test.md`,
    {
      headers: ghHeaders(token),
      params: { ref: branchShort },
      validateStatus: () => true,
    },
  );

  const bodyMarkdown =
    `# test\n\n` + `- upstream PR #${prNumber}\n` + `- merge_commit \`${mergeSha}\`\n`;

  const content = Buffer.from(bodyMarkdown, "utf8").toString("base64");
  const payload: Record<string, string> = {
    message: `chore(bot): add test.md for PR #${prNumber}`,
    content,
    branch: branchShort,
  };

  if (getRes.status === 200 && getRes.data?.sha) payload.sha = getRes.data.sha;

  await axiosThrowGitHub(
    `写入 test.md（分支「${branchShort}」）失败`,
    axios.put(`${GH_API_BASE}/repos/${forkOwner}/${forkRepo}/contents/test.md`, payload, {
      headers: ghHeaders(token),
      validateStatus: () => true,
    }),
  );
}

async function persistMergeShaIfNeeded(mergedRowId: string, current: string | null, resolved: string) {
  if (current && current === resolved) return;
  await prisma.prRadarMergedPr.update({
    where: { id: mergedRowId },
    data: { mergeCommitSha: resolved },
  });
}

/** 对已入库且尚未完成 bot 流水的合并 PR，进行 fork mirror */
export async function processMergedPrForkMirror(args: {
  token: string;
  task: PrRadarWatchTask;
  fork: { forkOwner: string; forkRepo: string };
  mergedRowId: string;
  prNumber: number;
  storedMergeSha: string | null;
  log?: PrRadarPollLogFn;
}): Promise<void> {
  const { token, task, fork, mergedRowId, prNumber, storedMergeSha, log } = args;

  let mergeSha = storedMergeSha;

  if (!mergeSha || mergeSha.length < 7) {
    mergeSha = await githubGetPullMergeSha(token, task.owner, task.repo, prNumber);
    if (!mergeSha) {
      throw new Error(`PR #${prNumber} 无法获取 merge_commit_sha（未完成合并或非预期状态）`);
    }
    await persistMergeShaIfNeeded(mergedRowId, storedMergeSha, mergeSha);
  }

  await logLine(log, `Bot：PR #${prNumber} merge_sha=${mergeSha.slice(0, 7)} …`);

  const tryMergeUpstreamQuiet = async () => {
    try {
      await syncForkUpstreamBranch(token, fork.forkOwner, fork.forkRepo, task.branch);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[pr-radar-bot] merge-upstream 「${fork.forkRepo}:${task.branch}」${msg}`);
    }
  };

  let ok = await commitAccessible(token, fork.forkOwner, fork.forkRepo, mergeSha);
  if (!ok) {
    await logLine(log, `Bot：merge_sha 对 fork 尚不可见，重试 merge-upstream …`);
    await tryMergeUpstreamQuiet();
    await new Promise((r) => setTimeout(r, 2_500));
    ok = await commitAccessible(token, fork.forkOwner, fork.forkRepo, mergeSha);
  }
  if (!ok) {
    throw new Error(
      `Fork「${fork.forkOwner}/${fork.forkRepo}」上仍不可用 merge_sha=${mergeSha.slice(0, 7)}：` +
        `请先确认已对「${task.branch}」merge-upstream 或与 upstream 对齐。`,
    );
  }

  const branchShort = botBranchNameForPr(prNumber);
  await logLine(log, `Bot：建/移分支 refs/heads/${branchShort}`);
  await githubCreateBranchOrPointToSha(token, fork.forkOwner, fork.forkRepo, branchShort, mergeSha);

  await logLine(log, `Bot：PUT Contents test.md@${branchShort}`);
  await githubPutTestMd({
    token,
    forkOwner: fork.forkOwner,
    forkRepo: fork.forkRepo,
    branchShort,
    prNumber,
    mergeSha,
  });

  const branchUrl = `https://github.com/${fork.forkOwner}/${fork.forkRepo}/tree/${branchShort}`;
  await prisma.prRadarMergedPr.update({
    where: { id: mergedRowId },
    data: {
      mergeCommitSha: mergeSha,
      botBranchName: branchShort,
      botBranchHtmlUrl: branchUrl,
      botPushedAt: new Date(),
      botLastError: null,
    },
  });
  await logLine(log, `Bot：PR #${prNumber} 完成 ${branchUrl}`);
}

/** 对已入库条目跑 bot：确保 fork→sync→建分支→写 test.md（失败写 botLastError，后续轮询会重试） */
export async function runPendingMergedPrBotsForTask(props: {
  token: string;
  task: PrRadarWatchTask;
  /** 单次轮询最多处理的 backlog 条目数 */
  limit: number;
  log?: PrRadarPollLogFn;
}): Promise<{ processedOk: number; processedFail: number }> {
  const { token, task, limit, log } = props;

  const fork = await ensureUpstreamForkMapped(token, task.owner, task.repo, log);

  await logLine(log, `merge-upstream：${fork.forkRepo} ← upstream/${task.branch}`);

  try {
    await syncForkUpstreamBranch(token, fork.forkOwner, fork.forkRepo, task.branch);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logLine(log, `初始 merge-upstream 警告：${msg}`);
    console.warn(`[pr-radar-bot] 初始 merge-upstream：${msg}`);
  }

  let processedOk = 0;
  let processedFail = 0;

  const backlog = await prisma.prRadarMergedPr.findMany({
    where: {
      taskId: task.id,
      botPushedAt: null,
    },
    orderBy: [{ mergedAt: "asc" }],
    take: limit,
    select: {
      id: true,
      githubPrNumber: true,
      mergeCommitSha: true,
    },
  });

  for (const row of backlog) {
    try {
      await logLine(log, `排队处理 mergedRow=${row.id} PR #${row.githubPrNumber}`);
      await processMergedPrForkMirror({
        token,
        task,
        fork,
        mergedRowId: row.id,
        prNumber: row.githubPrNumber,
        storedMergeSha: row.mergeCommitSha,
        log,
      });
      processedOk += 1;
    } catch (e) {
      processedFail += 1;
      const msg = e instanceof Error ? e.message : String(e);
      await prisma.prRadarMergedPr.update({
        where: { id: row.id },
        data: { botLastError: msg.slice(0, 8000) },
      });
      console.error(
        `[pr-radar-bot] fork mirror failed mergedPr=${row.id} pr=#${row.githubPrNumber}`,
        e,
      );
    }
  }

  return { processedOk, processedFail };
}
