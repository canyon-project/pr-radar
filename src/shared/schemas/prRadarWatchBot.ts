import { z } from "zod";

export const BOT_WORKFLOW_REPO_PATH = ".github/workflows/test.yaml";

const overlayRowSchema = z
  .object({
    path: z.string(),
    content: z.string(),
  })
  .strict();

export type PrRadarWatchBotOverlayDto = z.infer<typeof overlayRowSchema>;

function normalizeRelativePath(raw: string): string {
  const trimmed = raw.trim().replace(/\\/g, "/");
  if (!trimmed) {
    throw new Error("覆盖文件路径不能为空");
  }
  if (trimmed.startsWith("/")) {
    throw new Error("路径不能以 / 开头");
  }
  const parts = trimmed.split("/").filter((p) => p.length > 0);
  if (parts.some((p) => p === "." || p === "..")) {
    throw new Error("路径不能包含 . 或 ..");
  }
  const normalized = parts.join("/");
  const lower = normalized.toLowerCase();
  if (lower === ".github/workflows" || lower.startsWith(".github/workflows/")) {
    throw new Error("不能使用 .github/workflows 下的路径（由平台强制写入 test.yaml）");
  }
  if (normalized.length > 4096) {
    throw new Error("路径过长");
  }
  return normalized;
}

/** 校验并规范化任务中的「覆盖路径」条目（入库 / API 共用）*/
export function parseBotOverlayPayload(raw: unknown): PrRadarWatchBotOverlayDto[] {
  const arr = z.array(overlayRowSchema).max(128).parse(raw ?? []);
  const dedup = new Map<string, string>();
  for (const row of arr) {
    const rawPath = typeof row.path === "string" ? row.path.trim() : "";
    const rawContent = typeof row.content === "string" ? row.content : "";
    if (!rawPath && rawContent.trim() === "") {
      continue;
    }
    if (!rawPath) {
      throw new Error("覆盖文件缺少路径（已填写内容但未填路径）");
    }
    const key = normalizeRelativePath(rawPath);
    dedup.set(key, rawContent);
  }
  return [...dedup.entries()].map(([path, content]) => {
    if (content.length > 1_500_000) {
      throw new Error(`文件过大「${path}」`);
    }
    return { path, content };
  });
}

export function parseMandatoryBotWorkflowYaml(raw: string): string {
  const t = typeof raw === "string" ? raw.trimEnd() : "";
  if (!t.trim()) {
    throw new Error("必须填写 .github/workflows/test.yaml 的正文内容");
  }
  if (t.length > 500_000) {
    throw new Error("test.yaml 内容过长（≤500KB）");
  }
  return t.endsWith("\n") ? t : `${t}\n`;
}

export const DEFAULT_BOT_TEST_YAML = `name: pr-radar-test
on:
  workflow_dispatch:

jobs:
  noop:
    runs-on: ubuntu-latest
    steps:
      - run: echo "PR Radar Bot OK"
`;
