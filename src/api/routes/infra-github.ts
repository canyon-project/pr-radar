import { createRoute, z } from "@hono/zod-openapi";
import { OpenAPIHono } from "@hono/zod-openapi";

import { InfraKey, upsertInfra } from "@/api/lib/infra.ts";
import { prisma } from "@/api/lib/prisma.ts";

const tokenStatusDto = z.object({
  configured: z.boolean(),
});

const putBody = z.object({
  token: z.string().min(1),
});

const getRoute = createRoute({
  method: "get",
  path: "/github-token",
  summary: "查询 GitHub Token 是否已在 Infra 表配置（不返回明文）",
  tags: ["PR Radar · Infra"],
  responses: {
    200: {
      description: "是否已保存 PAT",
      content: { "application/json": { schema: tokenStatusDto } },
    },
  },
});

const putRouteDef = createRoute({
  method: "put",
  path: "/github-token",
  summary: "将 GITHUB_PRIVATE_TOKEN 写入 Infra 表（id 固定为 InfraKey）",
  tags: ["PR Radar · Infra"],
  request: {
    body: {
      content: { "application/json": { schema: putBody } },
    },
  },
  responses: {
    204: {
      description: "已保存",
    },
  },
});

const infraGithubApi = new OpenAPIHono();

infraGithubApi.openapi(getRoute, async (c) => {
  const row = await prisma.infra.findUnique({ where: { id: InfraKey.GITHUB_PRIVATE_TOKEN } });
  return c.json({
    configured: Boolean(row?.value?.trim().length),
  });
});

infraGithubApi.openapi(putRouteDef, async (c) => {
  const { token } = c.req.valid("json");
  await upsertInfra(
    InfraKey.GITHUB_PRIVATE_TOKEN,
    "GitHub Private Token（PR 雷达）",
    token.trim(),
  );
  return c.body(null, 204);
});

export default infraGithubApi;
