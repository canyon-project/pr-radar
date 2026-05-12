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

- **跟进（用户）**：
  - pulls **LIST**：由早期「分页至多 10 页」演变为 **单次 `per_page=1`**。
  - 入库策略：每个监听任务 **`PrRadarMergedPr` 总量至多 1 行**，见「轻量化 LIST · 总量为 1」。库表仍为 **`@@unique(taskId, githubPrNumber)`** 兜底。

- **跟进（Fork + Bot）**：
  - 对已合并 PR：Token 持有者下确保 upstream 对应的 fork（仓库名 sanitized 为 `org-repo-{随机后缀}`；若已通过父仓库校验为同一上游 fork，则回填 DB **跳过新建**）。
  - 对监听 base 分支调用 GitHub **`POST .../merge-upstream`**。
  - 在 fork 上创建分支 **`canyon-bot/pr-{n}`**，`sha` = upstream **`merge_commit_sha`**；再用 Contents API **`PUT`** 根路径 **`test.md`**（含 PR 信息与 merge SHA）。
  - 状态字段：`mergeCommitSha`、`botBranchName`、`botBranchHtmlUrl`、`botPushedAt`、`botLastError`；轮询结束前补跑未完 backlog；**与「总量为 1」一致后，每任务每轮 backlog 上限为 1**。

- **跟进（轻量化 LIST · 总量为 1）**：每次监听 **`GET .../pulls` 仅 1 次**、`per_page=1`；**数据库侧每个 `watchTask` 至多保留 1 行 `PrRadarMergedPr`**——若 LIST 排头兵已从旧 merged PR 换成另一条 merged，会 **`deleteMany` + `create`** 整块替换；若为同一 PR 则不动数据，只做 **去重多于一行**（防历史异常）。排头兵若短时不是 merged，则 **保留上一轮**已存那条 merged。

- **跟进（异步 Job + 日志轮询）**：新增 **`PrRadarJobRun`**（状态、`logText`、`newCount`、`error`）。`POST .../watch-tasks/:id/poll` 返回 **202** + **`jobId`**，流水线由进程内 **FIFO worker** 异步执行 **`pollWatchTaskWithLog`** 并逐步 **`appendJobLog`**。提供 **`GET /api/pr-radar/jobs/:id`** 与 **`GET /api/pr-radar/jobs?taskId=`** 供前端轮询日志；定时调度改为 **`tryEnqueuePollJob`**。
