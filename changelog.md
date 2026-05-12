# Changelog

本文件记录与本项目相关的需求沟通与实现变更摘要，便于追溯「对话 → 代码」的演进。

## 2026-05-12

- **需求（用户）**：实现 GitHub PR 雷达。
  1. 创建监听任务：仓库地址、分支、监听频率（分钟）。
  2. 仅当 PR 已合并（GitHub `merged_at` 非空）且目标 base 为指定分支时，才落库管理。
  3. `GITHUB_PRIVATE_TOKEN` 存入数据库（沿用 `Infra` 表，`id = GITHUB_PRIVATE_TOKEN`），并在 `schema.prisma` 中注明用途。
  4. 将本次对话产生的实现与约定写入本 `changelog.md`。
- **实现摘要**：
  - Prisma 新增 `PrRadarWatchTask`、`PrRadarMergedPr`；`Infra` 模型增加文档注释说明 PAT 存储键。
  - 后端：`/api/infra/github-token`（查询是否已配置 / 写入 Token）、`/api/pr-radar/watch-tasks`（CRUD + 立即拉取）、`/api/pr-radar/merged-prs`（列表）；启动后每分钟调度一次到期任务，使用 GitHub REST API `pulls?state=closed&base=...` 并过滤 `merged_at`。
  - 前端：新增页面 `/pr-radar`（侧栏「PR 雷达」），含 Token 配置、任务表、已合并 PR 表与任务筛选。
