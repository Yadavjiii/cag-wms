import { TaskStatus } from "@prisma/client";
import { prisma } from "../prisma";
import { notify } from "../services/notify";
import { STALE_DAYS } from "../services/dashboard";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * The reminder scans.
 *
 * Three separate jobs on three different clocks, because they answer three
 * different questions. Due work is a daily question. Meetings are an hourly one,
 * since a reminder for a 10am meeting is worthless if it arrives at 4pm. Stale
 * work is a weekly one, and is aimed at leads rather than at whoever is holding
 * the item, because the point of it is escalation.
 *
 * Everything below is deliberately idempotent-ish rather than exactly-once: a
 * duplicate reminder is a mild annoyance, a missed one is a missed deadline.
 * This is a lightweight in-process scheduler for a single-instance deployment;
 * more than one API process wants a real queue (BullMQ on Redis) instead.
 */

/** Everyone who should be reminded about a work item, not just its lead. */
function peopleOn(t: {
  primaryLeadId: string | null;
  secondaryLeadId: string | null;
  currentlyWithId: string | null;
}): string[] {
  return [...new Set([t.currentlyWithId, t.primaryLeadId, t.secondaryLeadId].filter(Boolean) as string[])];
}

/** Daily: work that is due within a day, or already past its date. */
async function dueWorkScan(): Promise<void> {
  const now = new Date();
  const soon = new Date(now.getTime() + DAY);

  const tasks = await prisma.task.findMany({
    where: {
      archivedAt: null,
      status: { not: TaskStatus.FINISHED },
      dueDate: { not: null, lte: soon },
    },
    select: {
      id: true,
      title: true,
      dueDate: true,
      priority: true,
      primaryLeadId: true,
      secondaryLeadId: true,
      currentlyWithId: true,
    },
  });

  let sent = 0;
  for (const t of tasks) {
    const overdue = !!t.dueDate && t.dueDate < now;
    const days = t.dueDate ? Math.abs(Math.round((t.dueDate.getTime() - now.getTime()) / DAY)) : 0;
    for (const userId of peopleOn(t)) {
      await notify({
        userId,
        kind: overdue ? "overdue" : "due_soon",
        title: `${overdue ? `Overdue by ${days} day(s)` : "Due within 24 hours"}: ${t.title}`,
        body: overdue
          ? "This is past its due date. Report progress or move the date, but do not leave it silent."
          : "Due tomorrow. Post a progress update if it will not make it.",
        taskId: t.id,
      });
      sent++;
    }
  }
  console.log(`[reminders] due/overdue: ${tasks.length} item(s), ${sent} notice(s)`);
}

/** Hourly: meetings starting in the next hour, and tomorrow's, once. */
async function meetingScan(): Promise<void> {
  const now = new Date();

  const imminent = await prisma.meeting.findMany({
    where: { startsAt: { gte: now, lte: new Date(now.getTime() + HOUR) } },
    select: {
      id: true,
      title: true,
      startsAt: true,
      mode: true,
      location: true,
      projectId: true,
      taskId: true,
      participants: { select: { userId: true } },
    },
  });

  for (const m of imminent) {
    const mins = Math.max(0, Math.round((m.startsAt.getTime() - now.getTime()) / MINUTE));
    for (const p of m.participants) {
      await notify({
        userId: p.userId,
        kind: "meeting_reminder",
        title: `Meeting in ${mins} min: ${m.title}`,
        body: m.mode === "ONLINE" ? "Online meeting" : `Venue: ${m.location ?? "not stated"}`,
        taskId: m.taskId,
        projectId: m.projectId,
        url: "/meetings",
      });
    }
  }

  // The day-before nudge fires in one hourly window only, so it goes out once.
  if (now.getHours() === 17) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const dayAfter = new Date(tomorrow.getTime() + DAY);

    const upcoming = await prisma.meeting.findMany({
      where: { startsAt: { gte: tomorrow, lt: dayAfter } },
      select: {
        id: true,
        title: true,
        startsAt: true,
        mode: true,
        location: true,
        projectId: true,
        taskId: true,
        participants: { select: { userId: true } },
      },
    });

    for (const m of upcoming) {
      const when = m.startsAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
      for (const p of m.participants) {
        await notify({
          userId: p.userId,
          kind: "meeting_reminder",
          title: `Tomorrow at ${when}: ${m.title}`,
          body: m.mode === "ONLINE" ? "Online meeting" : `Venue: ${m.location ?? "not stated"}`,
          taskId: m.taskId,
          projectId: m.projectId,
          url: "/meetings",
        });
      }
    }
    console.log(`[reminders] meetings: ${imminent.length} imminent, ${upcoming.length} tomorrow`);
  }
}

/** Weekly: open work nobody has said anything about for STALE_DAYS. */
async function staleWorkScan(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_DAYS * DAY);

  const tasks = await prisma.task.findMany({
    where: {
      archivedAt: null,
      status: { not: TaskStatus.FINISHED },
      OR: [{ lastUpdateAt: { lt: cutoff } }, { AND: [{ lastUpdateAt: null }, { updatedAt: { lt: cutoff } }] }],
    },
    select: {
      id: true,
      title: true,
      lastUpdateAt: true,
      updatedAt: true,
      primaryLeadId: true,
      secondaryLeadId: true,
      currentlyWithId: true,
    },
    take: 500,
  });

  for (const t of tasks) {
    const days = Math.floor((Date.now() - (t.lastUpdateAt ?? t.updatedAt).getTime()) / DAY);
    for (const userId of peopleOn(t)) {
      await notify({
        userId,
        kind: "stale",
        title: `No progress reported for ${days} days: ${t.title}`,
        body: "Post a short update so the dashboard stops showing this as silent.",
        taskId: t.id,
      });
    }
  }
  console.log(`[reminders] stale: ${tasks.length} item(s) with no update in ${STALE_DAYS} days`);
}

async function safely(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    console.error(`[reminders] ${name} failed:`, (e as Error).message);
  }
}

export function startReminders(): void {
  const daily = () => safely("due work", dueWorkScan);
  const hourly = () => safely("meetings", meetingScan);
  const weekly = () => safely("stale work", staleWorkScan);

  daily();
  hourly();
  weekly();

  setInterval(daily, DAY);
  setInterval(hourly, HOUR);
  setInterval(weekly, 7 * DAY);
}
