import { PrRadarJobStatus } from "@prisma/client";

import { appendJobLog } from "@/api/lib/prRadarJobAppendLog.ts";
import { pollWatchTaskWithLog } from "@/api/lib/prRadarPoll.ts";
import { prisma } from "@/api/lib/prisma.ts";

let workerStarted = false;
let draining = false;

/** 若无 PENDING/RUNNING 则可创建新作业；已有则返回既有 jobId（不重复排队）。 */
export async function tryEnqueuePollJob(
  taskId: string,
): Promise<{ jobId: string; createdNew: boolean }> {
  const inflight = await prisma.prRadarJobRun.findFirst({
    where: {
      taskId,
      status: { in: [PrRadarJobStatus.PENDING, PrRadarJobStatus.RUNNING] },
    },
    orderBy: { createdAt: "desc" },
  });
  if (inflight) {
    return { jobId: inflight.id, createdNew: false };
  }
  const job = await prisma.prRadarJobRun.create({
    data: { taskId, status: PrRadarJobStatus.PENDING },
  });
  return { jobId: job.id, createdNew: true };
}

async function claimNextPendingJob(): Promise<{ id: string; taskId: string } | null> {
  return prisma.$transaction(async (tx) => {
    const j = await tx.prRadarJobRun.findFirst({
      where: { status: PrRadarJobStatus.PENDING },
      orderBy: { createdAt: "asc" },
    });
    if (!j) return null;
    await tx.prRadarJobRun.update({
      where: { id: j.id },
      data: { status: PrRadarJobStatus.RUNNING, startedAt: new Date() },
    });
    return { id: j.id, taskId: j.taskId };
  });
}

async function finalizeJob(jobId: string, patch: Parameters<typeof prisma.prRadarJobRun.update>[0]["data"]) {
  await prisma.prRadarJobRun.update({
    where: { id: jobId },
    data: patch,
  });
}

async function executeJobRun(jobId: string, taskId: string): Promise<void> {
  const emit = async (msg: string) => {
    await appendJobLog(jobId, msg);
  };

  await emit(`worker：开始执行 job=${jobId}`);

  const task = await prisma.prRadarWatchTask.findUnique({ where: { id: taskId } });
  if (!task) {
    await emit("错误：监听任务不存在，作业终止");
    await finalizeJob(jobId, {
      status: PrRadarJobStatus.FAILED,
      finishedAt: new Date(),
      error: `watch task ${taskId} not found`,
    });
    return;
  }

  try {
    const { newCount } = await pollWatchTaskWithLog(task, emit);
    await emit(`抓取与 Bot 流水线完成，newCount=${newCount}`);
    await prisma.prRadarWatchTask.update({
      where: { id: taskId },
      data: { lastPolledAt: new Date() },
    });
    await finalizeJob(jobId, {
      status: PrRadarJobStatus.SUCCEEDED,
      newCount,
      finishedAt: new Date(),
      error: null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await emit(`流水线失败：${msg}`);
    await finalizeJob(jobId, {
      status: PrRadarJobStatus.FAILED,
      finishedAt: new Date(),
      error: msg.slice(0, 8000),
    });
  }
}

async function drainQueueOnce(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    for (;;) {
      const job = await claimNextPendingJob();
      if (!job) break;
      await executeJobRun(job.id, job.taskId);
    }
  } finally {
    draining = false;
  }
}

/**
 * FIFO 顺序消费 `PENDING` 作业；抓取 / fork 全流程在进程中异步执行。
 */
export function startPrRadarJobWorker(): void {
  if (workerStarted) return;
  workerStarted = true;

  const tickMs = 800;

  void drainQueueOnce();

  setInterval(() => {
    void drainQueueOnce().catch((e) => console.error("[pr-radar-job-worker] drain error", e));
  }, tickMs);
}
