import { Hono } from "hono";
import { cors } from "hono/cors";
import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { serveStatic } from "@hono/node-server/serve-static";
import { fileURLToPath } from "node:url";

import noteApi from "@/api/routes/note.ts";
import infraGithubApi from "@/api/routes/infra-github.ts";
import prRadarJobApi from "@/api/routes/pr-radar-job.ts";
import prRadarMergedApi from "@/api/routes/pr-radar-merged.ts";
import prRadarWatchApi from "@/api/routes/pr-radar-watch.ts";
import { startPrRadarJobWorker } from "@/api/lib/prRadarAsyncWorker.ts";
import { startPrRadarScheduler } from "@/api/lib/prRadarScheduler.ts";

import { historyApiFallback } from "hono-history-api-fallback";
import { loadInfra } from "@/api/lib/infra.ts";

await loadInfra();
startPrRadarJobWorker();
startPrRadarScheduler();

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const app = new Hono();

const api = new OpenAPIHono();

api.route("/notes", noteApi);
api.route("/infra", infraGithubApi);
api.route("/pr-radar/watch-tasks", prRadarWatchApi);
api.route("/pr-radar/merged-prs", prRadarMergedApi);
api.route("/pr-radar/jobs", prRadarJobApi);

api.doc("/doc", {
  openapi: "3.0.0",
  info: {
    version: "1.0.0",
    title: "API",
    description: "全栈 Web 应用 API（含 GitHub PR 雷达与笔记等）。",
  },
  servers: [{ url: "/api", description: "API base path" }],
});

api.get("/ui", swaggerUI({ url: "/api/doc", baseUrl: "https://unpkg.com" }));

api.get("/health", (c) => c.text("OK"));

/** 用于测试服务端请求体大小限制：POST 任意内容，返回接收到的字节数 */
api.post("/debug/body-size", async (c) => {
  const body = await c.req.arrayBuffer();
  const sizeBytes = body.byteLength;
  return c.json({
    sizeBytes,
    sizeKB: Number((sizeBytes / 1024).toFixed(2)),
    sizeMB: Number((sizeBytes / 1024 / 1024).toFixed(2)),
    contentLengthHeader: c.req.header("Content-Length") ?? null,
  });
});

app.get("/vi/health", (c) => c.text("OK"));

app.use("/api/*", cors());

app.route("/api", api);

app.use("/*", historyApiFallback({ root: __dirname }));
app.use("/*", serveStatic({ root: __dirname }));

export default app;
