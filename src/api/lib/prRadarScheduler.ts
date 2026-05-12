import { prisma } from "@/api/lib/prisma.ts";
import { tryEnqueuePollJob } from "@/api/lib/prRadarAsyncWorker.ts";

let started = false;

function isDue(lastPolledAt: Date | null, intervalMinutes: number, nowMs: number): boolean {
  if (!lastPolledAt) return true;
  const delta = intervalMinutes * 60 * 1000;
  return nowMs - lastPolledAt.getTime() >= delta;
}

/**
 * 每分钟检查一次已到期的监听任务，向其投递异步抓取作业（由 Job worker FIFO 执行）
 */
export function startPrRadarScheduler(): void {
  if (started) return;
  started = true;

  const tickMs = 60_000;

  async function cycle(): Promise<void> {
    const tasks = await prisma.prRadarWatchTask.findMany({
      where: { enabled: true },
    });
    const now = Date.now();
    for (const task of tasks) {
      if (!isDue(task.lastPolledAt, task.intervalMinutes, now)) continue;
      try {
        const enq = await tryEnqueuePollJob(task.id);
        if (enq.createdNew) {
          console.info(`[pr-radar] enqueued poll job ${enq.jobId} for task ${task.id}`);
        }
      } catch (e) {
        console.error(`[pr-radar] enqueue failed for task ${task.id}`, e);
      }
    }
  }

  void cycle();
  setInterval(() => {
    void cycle().catch((e) => console.error("[pr-radar] scheduler cycle error", e));
  }, tickMs);
}
