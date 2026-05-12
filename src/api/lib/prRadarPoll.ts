import axios from "axios";
import type { Prisma, PrRadarWatchTask } from "@prisma/client";

import { getInfra, InfraKey } from "@/api/lib/infra.ts";
import { prisma } from "@/api/lib/prisma.ts";

const MAX_PAGES = 30;

type GitHubPull = {
  number: number;
  title: string;
  merged_at: string | null;
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

async function fetchMergedPullPage(
  owner: string,
  repo: string,
  branch: string,
  token: string,
  page: number,
): Promise<GitHubPull[]> {
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls`;
  const response = await axios.get<GitHubPull[]>(url, {
    params: {
      state: "closed",
      base: branch,
      sort: "updated",
      direction: "desc",
      per_page: 50,
      page,
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
  return Array.isArray(data) ? data : [];
}

export async function pollWatchTask(task: PrRadarWatchTask): Promise<{ newCount: number }> {
  const token = getInfra(InfraKey.GITHUB_PRIVATE_TOKEN);
  if (!token || token.length === 0) {
    throw new Error('未配置 GITHUB_PRIVATE_TOKEN（请在 Infra /「GitHub Token」中保存 PAT）');
  }

  const existing = new Set(
    (
      await prisma.prRadarMergedPr.findMany({
        where: { taskId: task.id },
        select: { githubPrNumber: true },
      })
    ).map((r) => r.githubPrNumber),
  );

  let newCount = 0;
  let page = 1;
  while (page <= MAX_PAGES) {
    const pulls = await fetchMergedPullPage(task.owner, task.repo, task.branch, token, page);
    if (pulls.length === 0) break;

    const batch: Prisma.PrRadarMergedPrCreateManyInput[] = [];
    for (const pr of pulls) {
      if (!pr.merged_at) continue;
      if (!pr.base || pr.base.ref !== task.branch) continue;
      if (existing.has(pr.number)) continue;
      batch.push({
        taskId: task.id,
        githubPrNumber: pr.number,
        title: pr.title,
        mergedAt: new Date(pr.merged_at),
        htmlUrl: pr.html_url,
        mergedByLogin: pr.merged_by?.login ?? null,
        baseRef: pr.base.ref,
      });
      existing.add(pr.number);
    }

    if (batch.length > 0) {
      const res = await prisma.prRadarMergedPr.createMany({
        data: batch,
        skipDuplicates: true,
      });
      newCount += res.count;
    }

    page += 1;
  }

  await prisma.prRadarWatchTask.update({
    where: { id: task.id },
    data: { lastPolledAt: new Date() },
  });

  return { newCount };
}
