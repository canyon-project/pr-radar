import axios from "axios";
import type { PrRadarWatchTask } from "@prisma/client";

import { getInfra, InfraKey } from "@/api/lib/infra.ts";
import { prisma } from "@/api/lib/prisma.ts";
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

/**
 * 每次只请求「updated 排序下最新的一条 closed PR」（per_page=1）。
 * GitHub pulls 列表无 closed_at / merged_at 排序项，故以 updated_at 近似「最近活跃度最高」的一条。
 *
 * 「总量为 1」：`pollWatchTask` 对每个监听任务至多保留一行 `PrRadarMergedPr`；
 * GitHub API 排头兵若换成另一条 merged PR，则整表替换为该条。
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

export async function pollWatchTask(task: PrRadarWatchTask): Promise<{ newCount: number }> {
  const token = getInfra(InfraKey.GITHUB_PRIVATE_TOKEN);
  if (!token || token.length === 0) {
    throw new Error('未配置 GITHUB_PRIVATE_TOKEN（请在 Infra /「GitHub Token」中保存 PAT）');
  }

  let newCount = 0;
  const pr = await fetchLatestClosedPull(task.owner, task.repo, task.branch, token);

  if (pr?.merged_at && pr.base?.ref === task.branch) {
    const current = await prisma.prRadarMergedPr.findFirst({
      where: { taskId: task.id },
      orderBy: { mergedAt: "desc" },
    });

    if (current?.githubPrNumber === pr.number) {
      await prisma.prRadarMergedPr.deleteMany({
        where: { taskId: task.id, NOT: { id: current.id } },
      });
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
    }
  }

  try {
    await runPendingMergedPrBotsForTask({
      token,
      task,
      limit: BOT_BACKLOG_PER_POLL,
    });
  } catch (e) {
    console.error(`[pr-radar-bot] backlog for task ${task.id}`, e);
  }

  await prisma.prRadarWatchTask.update({
    where: { id: task.id },
    data: { lastPolledAt: new Date() },
  });

  return { newCount };
}
