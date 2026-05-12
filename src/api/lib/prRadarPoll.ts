import axios from "axios";
import type { PrRadarWatchTask } from "@prisma/client";

import { getInfra, InfraKey } from "@/api/lib/infra.ts";
import { prisma } from "@/api/lib/prisma.ts";
import type { PrRadarPollLogFn } from "@/api/lib/prRadarPollLog.ts";
import { runPendingMergedPrBotsForTask } from "@/api/lib/prRadarGithubForkBot.ts";

/** 单次轮询每个任务至多 1 条合并 PR 记录 → backlog 至多处理 1 条 */
const BOT_BACKLOG_PER_POLL = 1;

type GitHubPull = {
  number: number;
  title: string;
  merged_at: string | null;
  merge_commit_sha: string | null;
  html_url: string;
  base: { ref: string };
  merged_by?: { login?: string | null } | null;
};

function githubHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function emitLine(log: PrRadarPollLogFn | undefined, line: string) {
  await Promise.resolve(log?.(line));
}

/**
 * 每次只请求「updated 排序下最新的一条 closed PR」（per_page=1）。
 * 「总量为 1」：每个监听任务至多保留一行 `PrRadarMergedPr`。
 */
async function fetchLatestClosedPull(
  owner: string,
  repo: string,
  branch: string,
  token: string,
): Promise<GitHubPull | null> {
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls`;
  const response = await axios.get<GitHubPull[]>(url, {
    params: {
      state: "closed",
      base: branch,
      sort: "updated",
      direction: "desc",
      per_page: 1,
      page: 1,
    },
    headers: githubHeaders(token),
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
  if (!Array.isArray(data) || data.length === 0) return null;
  const pr = data[0];
  return pr ?? null;
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

  await emitLine(log, "LIST pulls：per_page=1 state=closed");
  const pr = await fetchLatestClosedPull(task.owner, task.repo, task.branch, token);

  let newCount = 0;

  if (!pr) {
    await emitLine(log, "LIST 返回 0 条 closed PR（该 base）");
  } else {
    await emitLine(
      log,
      `排头兵 PR #${pr.number} merged_at=${pr.merged_at ?? "∅"} base=${pr.base.ref}`,
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
      await emitLine(log, `LIST 排头兵非 merged：裁剪重复行，保留 PR #${latest.githubPrNumber}`);
    } else {
      await emitLine(log, "LIST 排头兵非 merged：保留原有合并记录（若有）");
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
