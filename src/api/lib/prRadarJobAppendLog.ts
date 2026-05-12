import { prisma } from "@/api/lib/prisma.ts";

const MAX_LOG_CHARS = 400_000;

/**
 * 追加一行运行日志（单 worker + 短时事务可降低并发撕裂风险）。
 */
export async function appendJobLog(jobId: string, line: string): Promise<void> {
  const safe = line.replace(/\r?\n/g, "\\n").slice(0, 8000);
  const entry = `[${new Date().toISOString()}] ${safe}\n`;

  await prisma.$transaction(async (tx) => {
    const row = await tx.prRadarJobRun.findUnique({
      where: { id: jobId },
      select: { logText: true },
    });
    if (!row) return;
    let next = `${row.logText ?? ""}${entry}`;
    if (next.length > MAX_LOG_CHARS) {
      next = next.slice(next.length - MAX_LOG_CHARS);
    }
    await tx.prRadarJobRun.update({
      where: { id: jobId },
      data: { logText: next },
    });
  });
}
