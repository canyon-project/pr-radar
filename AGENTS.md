# AI Agent 项目指南

> 本文档为 AI 编程助手提供项目上下文，便于理解结构与规范。

## 项目概述

全栈 Web 应用：Vite + React + Hono + Prisma，前后端同构，API 与前端共用一套代码库。

## 技术栈

- **前端**：React 19、React Router、Ant Design 6、Tailwind CSS 4
- **后端**：Hono、Prisma、PostgreSQL
- **构建**：Vite 8、vite-plugin-pages（文件路由）
- **工具**：TypeScript、oxlint、oxfmt、Vitest

## 项目结构

```
src/
├── api/                 # 后端 API
│   ├── index.ts         # Hono 入口，路由挂载
│   ├── lib/prisma.ts    # Prisma 单例
│   └── routes/          # API 路由模块（按资源划分）
├── pages/               # 页面组件（vite-plugin-pages 自动路由）
│   ├── index.tsx
├── layouts/             # 布局组件
├── shared/schemas/      # 前后端共享 Zod schema 与类型
├── services/            # 前端 API 调用封装
├── lib/                 # 工具函数
├── App.tsx
└── main.tsx
prisma/
└── schema.prisma        # 数据库模型
```

## 常用命令

| 命令                | 说明                                      |
| ------------------- | ----------------------------------------- |
| `pnpm dev`          | 开发（Vite + Hono dev server）            |
| `pnpm build`        | 构建（prisma generate + client + server） |
| `pnpm start`        | 生产运行 `node dist/index.js`             |
| `pnpm run generate` | 生成 Prisma Client                        |
| `pnpm test`         | 运行 Vitest                               |
| `pnpm lint`         | oxlint 检查                               |
| `pnpm fmt`          | oxfmt 格式化                              |

## 路径别名

- `@/` → `src/`（如 `@/api/lib/prisma`）

## API 规范

- **前缀**：所有 API 路径以 `/api` 开头
- **路由**：`src/api/routes/` 下按资源拆分，使用 `@hono/zod-openapi` 定义 schema 与路由
- **Swagger**：`/api/ui` 为 Swagger UI，`/api/doc` 为 OpenAPI JSON
- **健康检查**：`/api/health`

## 前端样式规范

- **组件**：使用 Ant Design 组件（Button、Form、Table、Card 等）
- **布局**：用 Tailwind CSS 写布局（flex、grid、间距、响应式等），如 `flex`、`gap-4`、`p-6`、`max-w-2xl`

## 前后端类型同构

- **共享 schema**：`src/shared/schemas/` 下用 Zod 定义 schema，用 `z.infer` 推导 TypeScript 类型
- **后端**：路由从 shared 导入 schema 做校验与 OpenAPI
- **前端**：service 从 shared 导入类型，避免重复定义

## 代码规范

- 前后端都用axios来获取外部数据，保持一致
- 使用 TypeScript，严格模式
- 组件：函数组件，优先使用 hooks
- API 调用：通过 `src/services/` 封装，不直接在前端写 fetch
- 数据库：统一使用 `src/api/lib/prisma.ts` 的 Prisma 实例
- 新增 API 路由：在 `src/api/index.ts` 中 `api.route()` 挂载

## 注意事项

- 开发时：非 `/api` 请求走 Vite，`/api` 请求走 Hono
- 生产构建：client 与 server 分别构建，server 用 `serveStatic` 托管静态资源
