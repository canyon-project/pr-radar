import { PrRadarJobStatus } from "@prisma/client";
import { createRoute, z } from "@hono/zod-openapi";
import { OpenAPIHono } from "@hono/zod-openapi";

import { prisma } from "@/api/lib/prisma.ts";

const paramsId = z.object({
  id: z.string().uuid(),
});

const jobDto = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  status: z.nativeEnum(PrRadarJobStatus),
  logText: z.string(),
  newCount: z.number().int().nullable(),
  error: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  createdAt: z.string(),
});

function jobToDto(job: {
  id: string;
  taskId: string;
  status: PrRadarJobStatus;
  logText: string;
  newCount: number | null;
  error: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: job.id,
    taskId: job.taskId,
    status: job.status,
    logText: job.logText,
    newCount: job.newCount,
    error: job.error,
    startedAt: job.startedAt ? job.startedAt.toISOString() : null,
    finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
    createdAt: job.createdAt.toISOString(),
  };
}

function errJson(c: { json: (b: unknown, s: number) => Response }, message: string, status: number) {
  return c.json({ message }, status);
}

const getJobRoute = createRoute({
  method: "get",
  path: "/{id}",
  summary: "按 id 查询异步抓取作业（轮询日志 / 状态）",
  tags: ["PR Radar · Job"],
  request: { params: paramsId },
  responses: {
    200: { description: "作业详情", content: { "application/json": { schema: jobDto } } },
    404: { description: "不存在" },
  },
});

const listJobsRoute = createRoute({
  method: "get",
  path: "/",
  summary: "按任务列出最近的作业运行（前端可轮询最新一条）",
  tags: ["PR Radar · Job"],
  request: {
    query: z.object({
      taskId: z.string().uuid(),
      limit: z.coerce.number().int().min(1).max(30).optional().default(10),
    }),
  },
  responses: {
    200: { description: "作业列表（新在前）", content: { "application/json": { schema: z.array(jobDto) } } },
  },
});

const jobsApi = new OpenAPIHono();

jobsApi.openapi(listJobsRoute, async (c) => {
  const { taskId, limit } = c.req.valid("query");
  const rows = await prisma.prRadarJobRun.findMany({
    where: { taskId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return c.json(rows.map(jobToDto));
});

jobsApi.openapi(getJobRoute, async (c) => {
  const { id } = c.req.valid("param");
  const row = await prisma.prRadarJobRun.findUnique({ where: { id } });
  if (!row) {
    return errJson(c, "未找到作业记录", 404);
  }
  return c.json(jobToDto(row));
});

export default jobsApi;
