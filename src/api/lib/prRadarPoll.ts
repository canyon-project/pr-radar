import axios from "axios";
import type { PrRadarWatchTask } from "@prisma/client";

import { ghHeaders } from "@/api/lib/githubGhRest.ts";
import { getInfra, InfraKey } from "@/api/lib/infra.ts";
import { prisma } from "@/api/lib/prisma.ts";
import type { PrRadarPollLogFn } from "@/api/lib/prRadarPollLog.ts";
import { runPendingMergedPrBotsForTask } from "@/api/lib/prRadarGithubForkBot.ts";

/** 单次轮询每个任务至多 1 条合并 PR 记录 → backlog 至多处理 1 条 */
const BOT_BACKLOG_PER_POLL = 1;

/** 在「closed + base」下列表里向前翻页的步长与上限（GitHub LIST 不能直接按 merged_at 排序）。 */
const MERGED_SCAN_PER_PAGE = 100;
const MERGED_SCAN_MAX_PAGES = 8;

type GitHubPull = {
  number: number;
  title: string;
  merged_at: string | null;
  merge_commit_sha: string | null;
  html_url: string;
  base: { ref: string };
  merged_by?: { login?: string | null } | null;
};

async function emitLine(log: PrRadarPollLogFn | undefined, line: string) {
  await Promise.resolve(log?.(line));
}

/**
 * 「最近一条合并进指定 base 的 PR」：GitHub LIST 仅支持按 updated/created 排序，故在 closed+base 下列表上
 * 分页收集 `merged_at != null` 的项，再本地按 `merged_at` 取最新。
 */
async function fetchLatestMergedPullIntoBase(
  owner: string,
  repo: string,
  branch: string,
  token: string,
): Promise<{ pr: GitHubPull | null; scanned: number }> {
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls`;
  const merged: GitHubPull[] = [];
  let scanned = 0;

  for (let page = 1; page <= MERGED_SCAN_MAX_PAGES; page += 1) {
    const response = await axios.get<GitHubPull[]>(url, {
      params: {
        state: "closed",
        base: branch,
        sort: "updated",
        direction: "desc",
        per_page: MERGED_SCAN_PER_PAGE,
        page,
      },
      headers: ghHeaders(token),
      validateStatus: () => true,
    });
    if (response.status < 200 || response.status >= 300) {
      const body =
        typeof response.data === "string"
          ? response.data
          : JSON.stringify(response.data ?? {});
      throw new Error(`GitHub API 请求失败（${response.status}）：${body.slice(0, 500)}`);
    }
    const data = response.data;
    if (!Array.isArray(data) || data.length === 0) break;
    scanned += data.length;
    for (const p of data) {
      if (p.merged_at && p.base?.ref === branch) merged.push(p);
    }
    if (data.length < MERGED_SCAN_PER_PAGE) break;
  }

  if (merged.length === 0) return { pr: null, scanned };

  const best = merged.reduce((a, b) => {
    const ta = new Date(a.merged_at!).getTime();
    const tb = new Date(b.merged_at!).getTime();
    return tb >= ta ? b : a;
  });
  return { pr: best, scanned };
}

/**
 * 同步执行抓取逻辑（仅供 Job worker 调用）。`lastPolledAt` 由 worker 在成功后统一写入。
 */
export async function pollWatchTaskWithLog(
  task: PrRadarWatchTask,
  log?: PrRadarPollLogFn,
): Promise<{ newCount: number }> {
  await emitLine(log, `进入抓取：upstream ${task.owner}/${task.repo} base=${task.branch}`);

  const token = getInfra(InfraKey.GITHUB_PRIVATE_TOKEN);
  if (!token || token.length === 0) {
    throw new Error('未配置 GITHUB_PRIVATE_TOKEN（请在 Infra /「GitHub Token」中保存 PAT）');
  }

  await emitLine(
    log,
    `LIST pulls：state=closed base=${task.branch}，` +
      `分页至多 ${MERGED_SCAN_MAX_PAGES}×${MERGED_SCAN_PER_PAGE} 条，择优 merged_at 最新（已合并进 base）`,
  );
  const { pr, scanned } = await fetchLatestMergedPullIntoBase(task.owner, task.repo, task.branch, token);

  let newCount = 0;

  if (!pr) {
    await emitLine(
      log,
      scanned === 0
        ? "LIST 在所扫范围内无 closed PR（该 base）"
        : `LIST 在所扫 ${scanned} 条 closed PR 内未发现已合并（merged_at）进 base 的记录`,
    );
  } else {
    await emitLine(
      log,
      `排头兵（已合并 PR）#${pr.number} merged_at=${pr.merged_at} base=${pr.base.ref} merge_commit=${(pr.merge_commit_sha ?? "").slice(0, 7)}`,
    );
  }

  if (pr?.merged_at && pr.base?.ref === task.branch) {
    const current = await prisma.prRadarMergedPr.findFirst({
      where: { taskId: task.id },
      orderBy: { mergedAt: "desc" },
    });

    if (current?.githubPrNumber === pr.number) {
      await prisma.prRadarMergedPr.deleteMany({
        where: { taskId: task.id, NOT: { id: current.id } },
      });
      await emitLine(log, `入库无变化：仍为 PR #${pr.number}（去重多余行）`);
      newCount = 0;
    } else {
      await prisma.$transaction([
        prisma.prRadarMergedPr.deleteMany({ where: { taskId: task.id } }),
        prisma.prRadarMergedPr.create({
          data: {
            taskId: task.id,
            githubPrNumber: pr.number,
            title: pr.title,
            mergedAt: new Date(pr.merged_at),
            htmlUrl: pr.html_url,
            mergedByLogin: pr.merged_by?.login ?? null,
            baseRef: pr.base.ref,
            mergeCommitSha: pr.merge_commit_sha ?? null,
          },
        }),
      ]);
      await emitLine(
        log,
        `已写入合并 PR 记录 PR #${pr.number} merge_commit=${(pr.merge_commit_sha ?? "").slice(0, 7)}`,
      );
      newCount = 1;
    }
  } else {
    const rows = await prisma.prRadarMergedPr.findMany({
      where: { taskId: task.id },
      orderBy: { mergedAt: "desc" },
    });
    const [latest, ...older] = rows;
    if (latest && older.length > 0) {
      await prisma.prRadarMergedPr.deleteMany({
        where: {
          taskId: task.id,
          NOT: { id: latest.id },
        },
      });
      await emitLine(log, `本次未解析到已合并排头兵：裁剪重复行，保留 PR #${latest.githubPrNumber}`);
    } else {
      await emitLine(log, "本次未解析到已合并排头兵：保留原有合并记录（若有）");
    }
  }

  await emitLine(log, `Fork/Bot backlog（limit=${BOT_BACKLOG_PER_POLL}）`);
  try {
    const botRes = await runPendingMergedPrBotsForTask({
      token,
      task,
      limit: BOT_BACKLOG_PER_POLL,
      log,
    });
    await emitLine(
      log,
      `Fork/Bot backlog 小结：processedOk=${botRes.processedOk} processedFail=${botRes.processedFail}`,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await emitLine(log, `Fork/Bot backlog 捕获异常（已记入控制台）：${msg}`);
    console.error(`[pr-radar-bot] backlog for task ${task.id}`, e);
  }

  return { newCount };
}
