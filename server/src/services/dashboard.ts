import { CommentKind, Prisma, ProjectStatus, TaskPriority, TaskStatus } from "@prisma/client";
import { prisma } from "../prisma";
import { taskVisibilityWhere } from "./taskAccess";
import { projectVisibilityWhere } from "./projectAccess";
import type { AuthUser } from "../types/express";

/**
 * Everything the dashboards are made of.
 *
 * Two rules run through this file. First, every figure is computed over the
 * rows the caller is allowed to see, by starting from taskVisibilityWhere:
 * a dashboard that leaks a count is still a leak. Second, an office's worth of
 * work fits in memory, so aggregation happens here in one pass rather than in
 * six round trips to MySQL; when an office outgrows that, these functions are
 * the only place that has to change.
 */

export const DAY = 24 * 60 * 60 * 1000;
/** No progress reported for this long and a work item is considered stale. */
export const STALE_DAYS = 10;
/** "Due soon" horizon, in days. */
export const SOON_DAYS = 3;

export type Severity = "critical" | "warning" | "info";

export interface Alert {
  id: string;
  severity: Severity;
  kind: string;
  title: string;
  detail?: string;
  count?: number;
  url: string;
  at?: Date | null;
}

export interface Bucket {
  key: string;
  label: string;
  count: number;
}

const startOfDay = (d = new Date()) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

export const STATUS_LABEL: Record<TaskStatus, string> = {
  YET_TO_BE_ASSIGNED: "Unassigned",
  INITIATED: "Initiated",
  IN_PROGRESS: "In progress",
  FINISHED: "Finished",
  ON_HOLD: "On hold",
};

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  LOW: "Low",
  NORMAL: "Normal",
  HIGH: "High",
  URGENT: "Urgent",
};

/** The columns every dashboard needs off a work item. */
const taskCardSelect = {
  id: true,
  title: true,
  status: true,
  priority: true,
  dueDate: true,
  pctComplete: true,
  lastUpdateAt: true,
  updatedAt: true,
  createdAt: true,
  departmentId: true,
  primaryLead: { select: { id: true, fullName: true } },
  currentlyWith: { select: { id: true, fullName: true } },
  department: { select: { id: true, name: true } },
  project: { select: { id: true, name: true } },
  _count: { select: { comments: true, attachments: true } },
} satisfies Prisma.TaskSelect;

export type TaskCard = Prisma.TaskGetPayload<{ select: typeof taskCardSelect }>;

// ---------------------------------------------------------------------------
// Classification. These four functions decide what "urgent", "late" and
// "ignored" mean, and every screen in the app defers to them so that two
// pages can never disagree about whether an item is in trouble.
// ---------------------------------------------------------------------------

export function isOpen(t: { status: TaskStatus }): boolean {
  return t.status !== TaskStatus.FINISHED;
}

export function daysUntil(due: Date | null | undefined): number | null {
  if (!due) return null;
  return Math.round((startOfDay(due).getTime() - startOfDay().getTime()) / DAY);
}

export function isOverdue(t: { status: TaskStatus; dueDate: Date | null }): boolean {
  const d = daysUntil(t.dueDate);
  return isOpen(t) && d !== null && d < 0;
}

export function isDueSoon(t: { status: TaskStatus; dueDate: Date | null }): boolean {
  const d = daysUntil(t.dueDate);
  return isOpen(t) && d !== null && d >= 0 && d <= SOON_DAYS;
}

/**
 * Urgent means one of three things, not just the priority flag: somebody marked
 * it urgent, it is already late, or it is high priority and nearly due. An
 * "urgent" list that only reads the flag misses every item that quietly became
 * urgent by running out of time.
 */
export function isUrgent(t: { status: TaskStatus; priority: TaskPriority; dueDate: Date | null }): boolean {
  if (!isOpen(t)) return false;
  if (t.priority === TaskPriority.URGENT) return true;
  if (isOverdue(t)) return true;
  return t.priority === TaskPriority.HIGH && isDueSoon(t);
}

/** Open, and nobody has reported anything on it for STALE_DAYS. */
export function isStale(t: { status: TaskStatus; lastUpdateAt: Date | null; updatedAt: Date }): boolean {
  if (!isOpen(t)) return false;
  const last = t.lastUpdateAt ?? t.updatedAt;
  return Date.now() - last.getTime() > STALE_DAYS * DAY;
}

export function ragOf(t: { status: TaskStatus; dueDate: Date | null }): "done" | "red" | "amber" | "green" | "none" {
  if (t.status === TaskStatus.FINISHED) return "done";
  const d = daysUntil(t.dueDate);
  if (d === null) return "none";
  if (d < 0) return "red";
  if (d <= SOON_DAYS) return "amber";
  return "green";
}

// ---------------------------------------------------------------------------
// Aggregation over a set of work items
// ---------------------------------------------------------------------------

export interface WorkTotals {
  total: number;
  open: number;
  finished: number;
  overdue: number;
  dueToday: number;
  dueSoon: number;
  urgent: number;
  unassigned: number;
  onHold: number;
  stale: number;
  noDueDate: number;
  /** Straight mean of pctComplete over open items. */
  avgCompletion: number;
  /** Finished / total, as a percentage. */
  completionRate: number;
  /** Of the items that finished with a due date, how many made it. */
  onTimeRate: number | null;
}

export function totalsFor(tasks: TaskCard[]): WorkTotals {
  let finished = 0;
  let overdue = 0;
  let dueToday = 0;
  let dueSoon = 0;
  let urgent = 0;
  let unassigned = 0;
  let onHold = 0;
  let stale = 0;
  let noDueDate = 0;
  let pctSum = 0;
  let pctCount = 0;
  let finishedWithDue = 0;
  let finishedOnTime = 0;

  for (const t of tasks) {
    if (!isOpen(t)) {
      finished++;
      if (t.dueDate) {
        finishedWithDue++;
        // Best available proxy for "when it was finished": the last write.
        if (t.updatedAt.getTime() <= t.dueDate.getTime() + DAY) finishedOnTime++;
      }
      continue;
    }
    if (t.status === TaskStatus.ON_HOLD) onHold++;
    if (t.status === TaskStatus.YET_TO_BE_ASSIGNED || !t.primaryLead) unassigned++;
    if (isOverdue(t)) overdue++;
    if (daysUntil(t.dueDate) === 0) dueToday++;
    if (isDueSoon(t)) dueSoon++;
    if (isUrgent(t)) urgent++;
    if (isStale(t)) stale++;
    if (!t.dueDate) noDueDate++;
    pctSum += t.pctComplete ?? 0;
    pctCount++;
  }

  return {
    total: tasks.length,
    open: tasks.length - finished,
    finished,
    overdue,
    dueToday,
    dueSoon,
    urgent,
    unassigned,
    onHold,
    stale,
    noDueDate,
    avgCompletion: pctCount ? Math.round(pctSum / pctCount) : 0,
    completionRate: tasks.length ? Math.round((finished / tasks.length) * 100) : 0,
    onTimeRate: finishedWithDue ? Math.round((finishedOnTime / finishedWithDue) * 100) : null,
  };
}

export function statusMix(tasks: TaskCard[]): Bucket[] {
  return (Object.keys(STATUS_LABEL) as TaskStatus[]).map((key) => ({
    key,
    label: STATUS_LABEL[key],
    count: tasks.filter((t) => t.status === key).length,
  }));
}

export function priorityMix(tasks: TaskCard[]): Bucket[] {
  const open = tasks.filter(isOpen);
  return (["URGENT", "HIGH", "NORMAL", "LOW"] as TaskPriority[]).map((key) => ({
    key,
    label: PRIORITY_LABEL[key],
    count: open.filter((t) => t.priority === key).length,
  }));
}

export interface WorkloadRow {
  userId: string;
  name: string;
  open: number;
  overdue: number;
  urgent: number;
  finished: number;
  avgCompletion: number;
}

/**
 * Who is carrying what. Counted against the person the item currently sits
 * with, falling back to the primary lead, because "who do I chase" is the
 * question this table exists to answer.
 */
export function workloadFor(tasks: TaskCard[]): WorkloadRow[] {
  const rows = new Map<string, WorkloadRow & { pctSum: number; pctCount: number }>();

  for (const t of tasks) {
    const who = t.currentlyWith ?? t.primaryLead;
    const key = who?.id ?? "__unassigned__";
    const name = who?.fullName ?? "Unassigned";
    const row =
      rows.get(key) ??
      { userId: key, name, open: 0, overdue: 0, urgent: 0, finished: 0, avgCompletion: 0, pctSum: 0, pctCount: 0 };

    if (isOpen(t)) {
      row.open++;
      if (isOverdue(t)) row.overdue++;
      if (isUrgent(t)) row.urgent++;
      row.pctSum += t.pctComplete ?? 0;
      row.pctCount++;
    } else {
      row.finished++;
    }
    rows.set(key, row);
  }

  return [...rows.values()]
    .map((r) => ({
      userId: r.userId,
      name: r.name,
      open: r.open,
      overdue: r.overdue,
      urgent: r.urgent,
      finished: r.finished,
      avgCompletion: r.pctCount ? Math.round(r.pctSum / r.pctCount) : 0,
    }))
    .sort((a, b) => b.overdue - a.overdue || b.open - a.open || a.name.localeCompare(b.name));
}

export interface DeptRow {
  name: string;
  open: number;
  overdue: number;
  finished: number;
}

export function byDepartment(tasks: TaskCard[]): DeptRow[] {
  const rows = new Map<string, DeptRow>();
  for (const t of tasks) {
    const name = t.department?.name ?? "No department";
    const row = rows.get(name) ?? { name, open: 0, overdue: 0, finished: 0 };
    if (isOpen(t)) {
      row.open++;
      if (isOverdue(t)) row.overdue++;
    } else row.finished++;
    rows.set(name, row);
  }
  return [...rows.values()].sort((a, b) => b.open - a.open);
}

export interface TrendPoint {
  date: string;
  created: number;
  finished: number;
  open: number;
}

/**
 * Raised against closed, day by day. `open` is the running backlog, which is
 * the line that actually tells you whether the office is keeping up.
 */
export function trendFor(tasks: TaskCard[], days = 14): TrendPoint[] {
  const from = startOfDay(new Date(Date.now() - (days - 1) * DAY));
  const points: TrendPoint[] = [];

  for (let i = 0; i < days; i++) {
    const d = new Date(from.getTime() + i * DAY);
    const key = dayKey(d);
    const created = tasks.filter((t) => dayKey(t.createdAt) === key).length;
    const finished = tasks.filter((t) => t.status === TaskStatus.FINISHED && dayKey(t.updatedAt) === key).length;
    points.push({ date: key, created, finished, open: 0 });
  }

  // Backlog at the end of each day, walked forwards from the current total.
  let running = tasks.filter(isOpen).length;
  for (let i = points.length - 1; i >= 0; i--) {
    points[i].open = running;
    running = running - points[i].created + points[i].finished;
  }
  return points;
}

// ---------------------------------------------------------------------------
// Alerts. The dashboard's job is to be read in ten seconds, so anything that
// needs a human decision today has to arrive as a line of text with a link.
// ---------------------------------------------------------------------------

export interface AlertInputs {
  tasks: TaskCard[];
  meetingsSoon: { id: string; title: string; startsAt: Date; mode: string; location: string | null }[];
  awaitingMyAcceptance: number;
  awaitingMyApproval: number;
  openBlockers: { id: string; taskId: string; taskTitle: string; body: string; createdAt: Date }[];
  projectsAtRisk: { id: string; name: string; overdue: number }[];
  unreadNotifications: number;
}

export function buildAlerts(input: AlertInputs): Alert[] {
  const alerts: Alert[] = [];
  const { tasks } = input;

  const overdue = tasks.filter(isOverdue);
  if (overdue.length) {
    const worst = overdue.reduce((a, b) => ((daysUntil(a.dueDate) ?? 0) < (daysUntil(b.dueDate) ?? 0) ? a : b));
    alerts.push({
      id: "overdue",
      severity: "critical",
      kind: "overdue",
      title: `${overdue.length} work item${overdue.length === 1 ? "" : "s"} past the due date`,
      detail: `Worst: "${worst.title}", ${Math.abs(daysUntil(worst.dueDate) ?? 0)} day(s) late`,
      count: overdue.length,
      url: "/tasks?filter=overdue",
    });
  }

  const dueToday = tasks.filter((t) => isOpen(t) && daysUntil(t.dueDate) === 0);
  if (dueToday.length) {
    alerts.push({
      id: "due-today",
      severity: "warning",
      kind: "due_today",
      title: `${dueToday.length} due today`,
      detail: dueToday.slice(0, 3).map((t) => t.title).join(", "),
      count: dueToday.length,
      url: "/tasks?filter=due-today",
    });
  }

  const urgent = tasks.filter((t) => isOpen(t) && t.priority === TaskPriority.URGENT && !isOverdue(t));
  if (urgent.length) {
    alerts.push({
      id: "urgent",
      severity: "warning",
      kind: "urgent",
      title: `${urgent.length} marked urgent`,
      detail: urgent.slice(0, 3).map((t) => t.title).join(", "),
      count: urgent.length,
      url: "/tasks?filter=urgent",
    });
  }

  for (const b of input.openBlockers.slice(0, 3)) {
    alerts.push({
      id: `blocker-${b.id}`,
      severity: "critical",
      kind: "blocker",
      title: `Blocked: ${b.taskTitle}`,
      detail: b.body.length > 120 ? `${b.body.slice(0, 117)}...` : b.body,
      url: `/tasks/${b.taskId}`,
      at: b.createdAt,
    });
  }

  if (input.awaitingMyAcceptance) {
    alerts.push({
      id: "accept",
      severity: "warning",
      kind: "awaiting_acceptance",
      title: `${input.awaitingMyAcceptance} work item${input.awaitingMyAcceptance === 1 ? "" : "s"} waiting for you to accept`,
      detail: "Until you accept or decline, nobody knows who is doing it.",
      count: input.awaitingMyAcceptance,
      url: "/approvals",
    });
  }

  if (input.awaitingMyApproval) {
    alerts.push({
      id: "approve",
      severity: "warning",
      kind: "awaiting_approval",
      title: `${input.awaitingMyApproval} request${input.awaitingMyApproval === 1 ? "" : "s"} waiting on your approval`,
      count: input.awaitingMyApproval,
      url: "/approvals",
    });
  }

  for (const m of input.meetingsSoon.slice(0, 4)) {
    const mins = Math.round((m.startsAt.getTime() - Date.now()) / 60000);
    const when =
      mins < 0 ? "in progress" : mins < 60 ? `in ${mins} min` : `at ${m.startsAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
    alerts.push({
      id: `meeting-${m.id}`,
      severity: mins <= 60 ? "warning" : "info",
      kind: "meeting",
      title: `Meeting ${when}: ${m.title}`,
      detail: m.mode === "ONLINE" ? "Online" : m.location ?? "Venue not set",
      url: "/meetings",
      at: m.startsAt,
    });
  }

  const stale = tasks.filter(isStale);
  if (stale.length) {
    alerts.push({
      id: "stale",
      severity: "info",
      kind: "stale",
      title: `${stale.length} item${stale.length === 1 ? "" : "s"} with no progress reported in ${STALE_DAYS} days`,
      detail: stale.slice(0, 3).map((t) => t.title).join(", "),
      count: stale.length,
      url: "/tasks?filter=stale",
    });
  }

  const unassigned = tasks.filter((t) => isOpen(t) && !t.primaryLead);
  if (unassigned.length) {
    alerts.push({
      id: "unassigned",
      severity: "info",
      kind: "unassigned",
      title: `${unassigned.length} item${unassigned.length === 1 ? "" : "s"} with nobody leading`,
      count: unassigned.length,
      url: "/tasks?filter=unassigned",
    });
  }

  for (const p of input.projectsAtRisk.slice(0, 3)) {
    alerts.push({
      id: `project-${p.id}`,
      severity: "warning",
      kind: "project_at_risk",
      title: `${p.name}: ${p.overdue} overdue item${p.overdue === 1 ? "" : "s"}`,
      url: `/projects/${p.id}`,
    });
  }

  const rank: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

// ---------------------------------------------------------------------------
// Project health. One number, and the reasons behind it, because a colour with
// no explanation gets argued with rather than acted on.
// ---------------------------------------------------------------------------

export interface Health {
  score: number;
  label: "On track" | "Needs attention" | "At risk" | "Not started";
  reasons: string[];
}

export function projectHealth(
  tasks: TaskCard[],
  project: { dueDate: Date | null; status: ProjectStatus; lastUpdateAt: Date | null; updatedAt: Date }
): Health {
  if (!tasks.length) {
    return {
      score: 0,
      label: "Not started",
      reasons: ["No work items have been added to this project yet."],
    };
  }

  const t = totalsFor(tasks);
  let score = 100;
  const reasons: string[] = [];

  if (t.open) {
    const overdueShare = t.overdue / t.open;
    if (overdueShare > 0) {
      score -= Math.round(overdueShare * 45);
      reasons.push(`${t.overdue} of ${t.open} open items are past due.`);
    }
    if (t.stale) {
      score -= Math.min(20, t.stale * 5);
      reasons.push(`${t.stale} item(s) have had no progress reported in ${STALE_DAYS} days.`);
    }
    if (t.unassigned) {
      score -= Math.min(15, t.unassigned * 5);
      reasons.push(`${t.unassigned} open item(s) have no lead.`);
    }
    if (t.urgent) reasons.push(`${t.urgent} item(s) need attention today.`);
  }

  const projectDue = daysUntil(project.dueDate);
  if (projectDue !== null && projectDue < 0 && project.status !== ProjectStatus.COMPLETED) {
    score -= 20;
    reasons.push(`The project itself is ${Math.abs(projectDue)} day(s) past its own due date.`);
  }

  const lastUpdate = project.lastUpdateAt ?? project.updatedAt;
  const quietDays = Math.floor((Date.now() - lastUpdate.getTime()) / DAY);
  if (quietDays > STALE_DAYS) {
    score -= 10;
    reasons.push(`Nothing has been posted here for ${quietDays} days.`);
  }

  if (project.status === ProjectStatus.ON_HOLD) {
    reasons.push("The project is on hold.");
    score -= 10;
  }

  score = Math.max(0, Math.min(100, score));
  const label: Health["label"] = score >= 75 ? "On track" : score >= 50 ? "Needs attention" : "At risk";
  if (!reasons.length) reasons.push("Everything open is inside its due date and being reported on.");
  return { score, label, reasons };
}

/**
 * Weighted completion: an item worth 40% counts for 40%, and every item counts
 * equally against the whole. A finished item is 100 regardless of what its
 * percentage field says, because "finished at 70%" is a data-entry artefact.
 */
export function weightedCompletion(tasks: TaskCard[]): number {
  if (!tasks.length) return 0;
  const sum = tasks.reduce((acc, t) => acc + (t.status === TaskStatus.FINISHED ? 100 : t.pctComplete ?? 0), 0);
  return Math.round(sum / tasks.length);
}

// ---------------------------------------------------------------------------
// Loaders. The only functions here that touch the database.
// ---------------------------------------------------------------------------

/** Every non-archived work item this user may see, in dashboard shape. */
export async function loadVisibleTasks(user: AuthUser, extra?: Prisma.TaskWhereInput): Promise<TaskCard[]> {
  return prisma.task.findMany({
    where: { AND: [taskVisibilityWhere(user), { archivedAt: null }, ...(extra ? [extra] : [])] },
    select: taskCardSelect,
    orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
    take: 3000,
  });
}

/** Meetings starting between now and `hours` from now, that this user is in. */
export async function loadMeetingsSoon(user: AuthUser, hours = 48) {
  return prisma.meeting.findMany({
    where: {
      startsAt: { gte: new Date(Date.now() - 30 * 60 * 1000), lte: new Date(Date.now() + hours * 60 * 60 * 1000) },
      OR: [{ createdById: user.id }, { participants: { some: { userId: user.id } } }],
    },
    select: {
      id: true,
      title: true,
      startsAt: true,
      endsAt: true,
      mode: true,
      location: true,
      project: { select: { id: true, name: true } },
      task: { select: { id: true, title: true } },
      _count: { select: { participants: true } },
    },
    orderBy: { startsAt: "asc" },
    take: 25,
  });
}

/** Pinned, undeleted BLOCKER posts on work items this user can see. */
export async function loadOpenBlockers(user: AuthUser, taskIds?: string[]) {
  const posts = await prisma.taskComment.findMany({
    where: {
      kind: CommentKind.BLOCKER,
      deletedAt: null,
      isPinned: true,
      ...(taskIds ? { taskId: { in: taskIds } } : { task: taskVisibilityWhere(user) }),
    },
    select: {
      id: true,
      body: true,
      createdAt: true,
      taskId: true,
      task: { select: { id: true, title: true, status: true } },
      author: { select: { id: true, fullName: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return posts
    .filter((p) => p.task && p.task.status !== TaskStatus.FINISHED)
    .map((p) => ({
      id: p.id,
      taskId: p.taskId,
      taskTitle: p.task?.title ?? "Work item",
      body: p.body,
      createdAt: p.createdAt,
      author: p.author,
    }));
}

/** Projects this user may see, with the counts a card needs. */
export async function loadVisibleProjects(user: AuthUser) {
  return prisma.project.findMany({
    where: { AND: [projectVisibilityWhere(user), { archivedAt: null }] },
    select: {
      id: true,
      name: true,
      code: true,
      status: true,
      priority: true,
      dueDate: true,
      startDate: true,
      lastUpdateAt: true,
      updatedAt: true,
      office: { select: { id: true, name: true } },
      department: { select: { id: true, name: true } },
      members: {
        where: { role: "PRIMARY_LEAD" },
        select: { user: { select: { id: true, fullName: true } } },
      },
      _count: { select: { tasks: true, members: true, comments: true, attachments: true } },
    },
    orderBy: [{ status: "asc" }, { dueDate: "asc" }],
    take: 300,
  });
}

