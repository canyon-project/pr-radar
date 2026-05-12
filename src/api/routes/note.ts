import { createRoute, z } from "@hono/zod-openapi";
import { OpenAPIHono } from "@hono/zod-openapi";

import { prisma } from "@/api/lib/prisma.ts";

const noteDto = z.object({
  id: z.string().uuid(),
  title: z.string(),
  content: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const paramsId = z.object({
  id: z.string().uuid(),
});

const createBody = z.object({
  title: z.string().min(1),
  content: z.string(),
});

const updateBody = z
  .object({
    title: z.string().min(1).optional(),
    content: z.string().optional(),
  })
  .refine((v) => v.title !== undefined || v.content !== undefined, {
    message: "至少需要提供 title 或 content 之一",
  });

const listRoute = createRoute({
  method: "get",
  path: "/",
  summary: "列出所有笔记",
  tags: ["Note"],
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.array(noteDto),
        },
      },
      description: "笔记列表",
    },
  },
});

const getRoute = createRoute({
  method: "get",
  path: "/{id}",
  summary: "按 id 获取笔记",
  tags: ["Note"],
  request: {
    params: paramsId,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: noteDto,
        },
      },
      description: "单个笔记",
    },
    404: {
      description: "不存在",
    },
  },
});

const createRouteDef = createRoute({
  method: "post",
  path: "/",
  summary: "创建笔记",
  tags: ["Note"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: createBody,
        },
      },
    },
  },
  responses: {
    201: {
      content: {
        "application/json": {
          schema: noteDto,
        },
      },
      description: "已创建",
    },
  },
});

const patchRouteDef = createRoute({
  method: "patch",
  path: "/{id}",
  summary: "更新笔记",
  tags: ["Note"],
  request: {
    params: paramsId,
    body: {
      content: {
        "application/json": {
          schema: updateBody,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: noteDto,
        },
      },
      description: "已更新",
    },
    404: {
      description: "不存在",
    },
  },
});

const deleteRouteDef = createRoute({
  method: "delete",
  path: "/{id}",
  summary: "删除笔记",
  tags: ["Note"],
  request: {
    params: paramsId,
  },
  responses: {
    204: {
      description: "已删除",
    },
    404: {
      description: "不存在",
    },
  },
});

function toDto(row: {
  id: string;
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const noteApi = new OpenAPIHono();

noteApi.openapi(listRoute, async (c) => {
  const rows = await prisma.note.findMany({ orderBy: { updatedAt: "desc" } });
  return c.json(rows.map(toDto));
});

noteApi.openapi(getRoute, async (c) => {
  const { id } = c.req.valid("param");
  const row = await prisma.note.findUnique({ where: { id } });
  if (!row) {
    return c.json({ message: "未找到笔记" }, 404);
  }
  return c.json(toDto(row));
});

noteApi.openapi(createRouteDef, async (c) => {
  const body = c.req.valid("json");
  const row = await prisma.note.create({
    data: { title: body.title, content: body.content },
  });
  return c.json(toDto(row), 201);
});

noteApi.openapi(patchRouteDef, async (c) => {
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const exists = await prisma.note.findUnique({ where: { id } });
  if (!exists) {
    return c.json({ message: "未找到笔记" }, 404);
  }
  const row = await prisma.note.update({
    where: { id },
    data: body,
  });
  return c.json(toDto(row));
});

noteApi.openapi(deleteRouteDef, async (c) => {
  const { id } = c.req.valid("param");
  try {
    await prisma.note.delete({ where: { id } });
    return c.body(null, 204);
  } catch {
    return c.json({ message: "未找到笔记" }, 404);
  }
});

export default noteApi;
