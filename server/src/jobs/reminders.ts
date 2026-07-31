import { TaskStatus } from "@prisma/client";
import { prisma } from "../prisma";
import { notify } from "../services/notify";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Simple daily reminder scan: notifies the primary lead of work that is due
 * within a day or already overdue. This is a lightweight dev scheduler; a
 * production deployment should use a real cron/queue (e.g. BullMQ on Redis).
 */
export function startReminders(): void {
  async function run() {
    try {
      const now = new Date();
      const soon = new Date(now.getTime() + DAY);
      const tasks = await prisma.task.findMany({
        where: { status: { not: TaskStatus.FINISHED }, dueDate: { not: null, lte: soon } },
        select: { id: true, title: true, dueDate: true, primaryLeadId: true },
      });
      for (const t of tasks) {
        const overdue = !!t.dueDate && t.dueDate < now;
        await notify({
          userId: t.primaryLeadId,
          kind: overdue ? "overdue" : "due_soon",
          title: `${overdue ? "Overdue" : "Due soon"}: ${t.title}`,
          taskId: t.id,
        });
      }
      console.log(`[reminders] processed ${tasks.length} due/overdue item(s)`);
    } catch (e) {
      console.error("[reminders] failed:", (e as Error).message);
    }
  }
  run();
  setInterval(run, DAY);
}
