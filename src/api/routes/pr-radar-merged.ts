import { createRoute, z } from "@hono/zod-openapi";
import { OpenAPIHono } from "@hono/zod-openapi";

import { InfraKey, getInfra } from "@/api/lib/infra.ts";
import {
  botBranchNameForPr,
  fetchAuthenticatedLogin,
} from "@/api/lib/prRadarGithubForkBot.ts";
import { githubDeleteBranchRefQuiet } from "@/api/lib/prRadarGithubSingleCommit.ts";
import { prisma } from "@/api/lib/prisma.ts";

const dto = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  githubPrNumber: z.number().int(),
  title: z.string(),
  mergedAt: z.string(),
  htmlUrl: z.string(),
  mergedByLogin: z.string().nullable(),
  baseRef: z.string(),
  mergeCommitSha: z.string().nullable(),
  botBranchName: z.string().nullable(),
  botBranchHtmlUrl: z.string().nullable(),
  botPushedAt: z.string().nullable(),
  botLastError: z.string().nullable(),
  createdAt: z.string(),
  taskSummary: z.object({
    repositoryUrl: z.string(),
    branch: z.string(),
  }),
});

function toDto(row: {
  id: string;
  taskId: string;
  githubPrNumber: number;
  title: string;
  mergedAt: Date;
  htmlUrl: string;
  mergedByLogin: string | null;
  baseRef: string;
  mergeCommitSha: string | null;
  botBranchName: string | null;
  botBranchHtmlUrl: string | null;
  botPushedAt: Date | null;
  botLastError: string | null;
  createdAt: Date;
  task: { repositoryUrl: string; branch: string };
}) {
  return {
    id: row.id,
    taskId: row.taskId,
    githubPrNumber: row.githubPrNumber,
    title: row.title,
    mergedAt: row.mergedAt.toISOString(),
    htmlUrl: row.htmlUrl,
    mergedByLogin: row.mergedByLogin,
    baseRef: row.baseRef,
    mergeCommitSha: row.mergeCommitSha,
    botBranchName: row.botBranchName,
    botBranchHtmlUrl: row.botBranchHtmlUrl,
    botPushedAt: row.botPushedAt ? row.botPushedAt.toISOString() : null,
    botLastError: row.botLastError,
    createdAt: row.createdAt.toISOString(),
    taskSummary: { repositoryUrl: row.task.repositoryUrl, branch: row.task.branch },
  };
}

const listRoute = createRoute({
  method: "get",
  path: "/",
  summary: "列出已入库的合并 PR（可选按任务筛选）",
  tags: ["PR Radar · Merged PR"],
  request: {
    query: z.object({
      taskId: z.string().uuid().optional(),
    }),
  },
  responses: {
    200: {
      description: "列表",
      content: { "application/json": { schema: z.array(dto) } },
    },
  },
});

const deleteRouteDef = createRoute({
  method: "delete",
  path: "/{id}",
  summary: "删除已入库合并 PR，并删除 fork 上 canyon-bot 对应分支（有映射且无 Token 时失败）",
  tags: ["PR Radar · Merged PR"],
  request: {
    params: z.object({ id: z.string().uuid() }),
  },
  responses: {
    204: { description: "已删除" },
    404: { description: "不存在" },
    400: { description: "未配置 Token 或远端删分支失败" },
  },
});

const mergedApi = new OpenAPIHono();

mergedApi.openapi(listRoute, async (c) => {
  const { taskId } = c.req.valid("query");
  const rows = await prisma.prRadarMergedPr.findMany({
    where: taskId ? { taskId } : undefined,
    orderBy: [{ mergedAt: "desc" }],
    include: { task: { select: { repositoryUrl: true, branch: true } } },
  });
  return c.json(rows.map((r) => toDto({ ...r, task: r.task })));
});

mergedApi.openapi(deleteRouteDef, async (c) => {
  const { id } = c.req.valid("param");
  const merged = await prisma.prRadarMergedPr.findUnique({
    where: { id },
    include: { task: { select: { owner: true, repo: true } } },
  });
  if (!merged) {
    return c.json({ message: "未找到合并 PR 记录" }, 404);
  }

  const token = getInfra(InfraKey.GITHUB_PRIVATE_TOKEN);
  if (!token || token.length === 0) {
    return c.json({ message: "未配置 GITHUB_PRIVATE_TOKEN，无法删除 fork 分支" }, 400);
  }

  const branchShort =
    typeof merged.botBranchName === "string" && merged.botBranchName.trim().length > 0
      ? merged.botBranchName.trim()
      : botBranchNameForPr(merged.githubPrNumber);

  try {
    const login = await fetchAuthenticatedLogin(token);
    const fork = await prisma.prRadarUpstreamFork.findUnique({
      where: {
        upstreamOwner_upstreamRepo_githubLogin: {
          upstreamOwner: merged.task.owner,
          upstreamRepo: merged.task.repo,
          githubLogin: login,
        },
      },
    });
    if (fork) {
      await githubDeleteBranchRefQuiet(token, login, fork.forkRepoName, branchShort);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ message: msg }, 400);
  }

  await prisma.prRadarMergedPr.delete({ where: { id } });
  return c.body(null, 204);
});

export default mergedApi;
