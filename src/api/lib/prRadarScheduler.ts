import { prisma } from "@/api/lib/prisma.ts";
import { pollWatchTask } from "@/api/lib/prRadarPoll.ts";

let started = false;

function isDue(lastPolledAt: Date | null, intervalMinutes: number, nowMs: number): boolean {
  if (!lastPolledAt) return true;
  const delta = intervalMinutes * 60 * 1000;
  return nowMs - lastPolledAt.getTime() >= delta;
}

/**
 * 每分钟检查一次已到期的监听任务并拉取 GitHub（仅 merged 的 PR 会写入库表）
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
        await pollWatchTask(task);
      } catch (e) {
        console.error(`[pr-radar] poll failed for task ${task.id} (${task.owner}/${task.repo} ${task.branch})`, e);
      }
    }
  }

  void cycle();
  setInterval(() => {
    void cycle().catch((e) => console.error("[pr-radar] scheduler cycle error", e));
  }, tickMs);
}
