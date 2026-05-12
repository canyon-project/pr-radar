import { createRoute, z } from "@hono/zod-openapi";
import { OpenAPIHono } from "@hono/zod-openapi";

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

export default mergedApi;
