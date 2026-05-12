import { createRoute, z } from "@hono/zod-openapi";
import { OpenAPIHono } from "@hono/zod-openapi";

import { parseGithubRepo } from "@/api/lib/githubRepo.ts";
import { pollWatchTask } from "@/api/lib/prRadarPoll.ts";
import { prisma } from "@/api/lib/prisma.ts";

const taskDto = z.object({
  id: z.string().uuid(),
  repositoryUrl: z.string(),
  owner: z.string(),
  repo: z.string(),
  branch: z.string(),
  intervalMinutes: z.number().int(),
  enabled: z.boolean(),
  lastPolledAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const paramsId = z.object({
  id: z.string().uuid(),
});

const createBody = z.object({
  repositoryUrl: z.string().min(1),
  branch: z.string().min(1),
  intervalMinutes: z.coerce.number().int().min(1).max(24 * 60),
  enabled: z.boolean().optional(),
});

const patchBody = z
  .object({
    repositoryUrl: z.string().min(1).optional(),
    branch: z.string().min(1).optional(),
    intervalMinutes: z.coerce.number().int().min(1).max(24 * 60).optional(),
    enabled: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.repositoryUrl !== undefined ||
      v.branch !== undefined ||
      v.intervalMinutes !== undefined ||
      v.enabled !== undefined,
    { message: "至少需要修改一个字段" },
  );

const pollResultDto = z.object({
  newCount: z.number().int(),
});

function toDto(row: {
  id: string;
  repositoryUrl: string;
  owner: string;
  repo: string;
  branch: string;
  intervalMinutes: number;
  enabled: boolean;
  lastPolledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    repositoryUrl: row.repositoryUrl,
    owner: row.owner,
    repo: row.repo,
    branch: row.branch,
    intervalMinutes: row.intervalMinutes,
    enabled: row.enabled,
    lastPolledAt: row.lastPolledAt ? row.lastPolledAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function errJson(c: { json: (b: unknown, s: number) => Response }, message: string, status: number) {
  return c.json({ message }, status);
}

const listRoute = createRoute({
  method: "get",
  path: "/",
  summary: "列出监听任务",
  tags: ["PR Radar · Watch"],
  responses: {
    200: {
      description: "任务列表",
      content: { "application/json": { schema: z.array(taskDto) } },
    },
  },
});

const getRoute = createRoute({
  method: "get",
  path: "/{id}",
  summary: "按 id 获取监听任务",
  tags: ["PR Radar · Watch"],
  request: { params: paramsId },
  responses: {
    200: {
      content: { "application/json": { schema: taskDto } },
      description: "单个任务",
    },
    404: { description: "不存在" },
  },
});

const createRouteDef = createRoute({
  method: "post",
  path: "/",
  summary: "创建监听任务",
  tags: ["PR Radar · Watch"],
  request: {
    body: { content: { "application/json": { schema: createBody } } },
  },
  responses: {
    201: {
      description: "已创建",
      content: { "application/json": { schema: taskDto } },
    },
    400: { description: "参数错误" },
  },
});

const patchRouteDef = createRoute({
  method: "patch",
  path: "/{id}",
  summary: "更新监听任务",
  tags: ["PR Radar · Watch"],
  request: {
    params: paramsId,
    body: { content: { "application/json": { schema: patchBody } } },
  },
  responses: {
    200: {
      description: "已更新",
      content: { "application/json": { schema: taskDto } },
    },
    404: { description: "不存在" },
    400: { description: "参数错误" },
  },
});

const deleteRouteDef = createRoute({
  method: "delete",
  path: "/{id}",
  summary: "删除监听任务",
  tags: ["PR Radar · Watch"],
  request: { params: paramsId },
  responses: {
    204: { description: "已删除" },
    404: { description: "不存在" },
  },
});

const pollRouteDef = createRoute({
  method: "post",
  path: "/{id}/poll",
  summary: "立即为该任务执行一次 GitHub 拉取（仍会过滤仅合并 PR）",
  tags: ["PR Radar · Watch"],
  request: { params: paramsId },
  responses: {
    200: {
      description: "已完成一次拉取",
      content: { "application/json": { schema: pollResultDto } },
    },
    404: { description: "不存在" },
    400: { description: "调用失败（如 Token 缺失或 GitHub 错误）" },
  },
});

const watchApi = new OpenAPIHono();

watchApi.openapi(listRoute, async (c) => {
  const rows = await prisma.prRadarWatchTask.findMany({ orderBy: { updatedAt: "desc" } });
  return c.json(rows.map(toDto));
});

watchApi.openapi(getRoute, async (c) => {
  const { id } = c.req.valid("param");
  const row = await prisma.prRadarWatchTask.findUnique({ where: { id } });
  if (!row) {
    return errJson(c, "未找到监听任务", 404);
  }
  return c.json(toDto(row));
});

watchApi.openapi(createRouteDef, async (c) => {
  const body = c.req.valid("json");
  let parsed;
  try {
    parsed = parseGithubRepo(body.repositoryUrl);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "仓库地址无效";
    return errJson(c, msg, 400);
  }
  const row = await prisma.prRadarWatchTask.create({
    data: {
      repositoryUrl: parsed.repositoryUrl,
      owner: parsed.owner,
      repo: parsed.repo,
      branch: body.branch.trim(),
      intervalMinutes: body.intervalMinutes,
      enabled: body.enabled ?? true,
    },
  });
  return c.json(toDto(row), 201);
});

watchApi.openapi(patchRouteDef, async (c) => {
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const exists = await prisma.prRadarWatchTask.findUnique({ where: { id } });
  if (!exists) {
    return errJson(c, "未找到监听任务", 404);
  }
  let owner = exists.owner;
  let repo = exists.repo;
  let repositoryUrl = exists.repositoryUrl;
  if (body.repositoryUrl !== undefined) {
    try {
      const p = parseGithubRepo(body.repositoryUrl);
      owner = p.owner;
      repo = p.repo;
      repositoryUrl = p.repositoryUrl;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "仓库地址无效";
      return errJson(c, msg, 400);
    }
  }
  const row = await prisma.prRadarWatchTask.update({
    where: { id },
    data: {
      repositoryUrl,
      owner,
      repo,
      branch: body.branch !== undefined ? body.branch.trim() : undefined,
      intervalMinutes: body.intervalMinutes,
      enabled: body.enabled,
    },
  });
  return c.json(toDto(row));
});

watchApi.openapi(deleteRouteDef, async (c) => {
  const { id } = c.req.valid("param");
  try {
    await prisma.prRadarWatchTask.delete({ where: { id } });
    return c.body(null, 204);
  } catch {
    return errJson(c, "未找到监听任务", 404);
  }
});

watchApi.openapi(pollRouteDef, async (c) => {
  const { id } = c.req.valid("param");
  const row = await prisma.prRadarWatchTask.findUnique({ where: { id } });
  if (!row) {
    return errJson(c, "未找到监听任务", 404);
  }
  try {
    const { newCount } = await pollWatchTask(row);
    return c.json({ newCount });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return errJson(c, msg, 400);
  }
});

export default watchApi;
