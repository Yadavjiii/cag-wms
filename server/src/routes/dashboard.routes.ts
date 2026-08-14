import { Router } from "express";
import { RequestState, TaskStatus } from "@prisma/client";
import { prisma } from "../prisma";
import { asyncHandler } from "../utils/http";
import { authenticate } from "../middleware/auth";
import { taskVisibilityWhere } from "../services/taskAccess";
import {
  Alert,
  TaskCard,
  buildAlerts,
  byDepartment,
  isDueSoon,
  isOpen,
  isOverdue,
  isStale,
  isUrgent,
  daysUntil,
  loadMeetingsSoon,
  loadOpenBlockers,
  loadVisibleProjects,
  loadVisibleTasks,
  priorityMix,
  projectHealth,
  statusMix,
  totalsFor,
  trendFor,
  weightedCompletion,
  workloadFor,
  STALE_DAYS,
  SOON_DAYS,
} from "../services/dashboard";

/**
 * The dashboard endpoints.
 *
 * One request per screen, on purpose. A dashboard that fires eleven parallel
 * fetches renders eleven times, arrives in a different order every reload, and
 * makes "why is this number different from that one" impossible to answer. The
 * server computes a single consistent snapshot and stamps it with a time.
 */
export const dashboardRouter = Router();
dashboardRouter.use(authenticate);

/** How many of a list to send down. The rest is a click away. */
const CAP = 12;

const byUrgency = (a: TaskCard, b: TaskCard) => {
  const da = daysUntil(a.dueDate);
  const db = daysUntil(b.dueDate);
  if (da === null && db === null) return 0;
  if (da === null) return 1;
  if (db === null) return -1;
  return da - db;
};

// GET /api/dashboard  -  everything the landing screen shows, in one snapshot
dashboardRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = req.user!;

    const [tasks, meetings, projects, blockers, awaitingAcceptance, awaitingApproval, unread] = await Promise.all([
      loadVisibleTasks(user),
      loadMeetingsSoon(user, 24 * 7),
      loadVisibleProjects(user),
      loadOpenBlockers(user),
      prisma.taskRequest.count({ where: { toId: user.id, state: RequestState.PENDING_ACCEPTANCE } }),
      prisma.taskRequest.count({
        where: {
          state: RequestState.PENDING_APPROVAL,
          OR: [
            ...(user.headsDepartmentIds.length ? [{ toDepartmentId: { in: user.headsDepartmentIds } }] : []),
            ...(user.headsOfficeIds.length ? [{ toOfficeId: { in: user.headsOfficeIds } }] : []),
          ],
        },
      }),
      prisma.notification.count({ where: { userId: user.id, isRead: false } }),
    ]);

    // "Mine" is the work that will be my problem if it slips: I hold it, I lead
    // it, or I raised it.
    const mine = tasks.filter(
      (t) => t.currentlyWith?.id === user.id || t.primaryLead?.id === user.id
    );

    const now = Date.now();
    const meetingsToday = meetings.filter(
      (m) => new Date(m.startsAt).toDateString() === new Date().toDateString()
    );
    const meetingsSoon = meetings.filter((m) => new Date(m.startsAt).getTime() - now < 4 * 60 * 60 * 1000);

    // Which projects are in trouble, computed from the work items we already
    // have in memory rather than a query per project.
    const tasksByProject = new Map<string, TaskCard[]>();
    for (const t of tasks) {
      if (!t.project) continue;
      const list = tasksByProject.get(t.project.id) ?? [];
      list.push(t);
      tasksByProject.set(t.project.id, list);
    }

    const projectCards = projects.map((p) => {
      const own = tasksByProject.get(p.id) ?? [];
      const health = projectHealth(own, p);
      const t = totalsFor(own);
      return {
        id: p.id,
        name: p.name,
        code: p.code,
        status: p.status,
        priority: p.priority,
        dueDate: p.dueDate,
        lastUpdateAt: p.lastUpdateAt,
        lead: p.members[0]?.user ?? null,
        department: p.department,
        counts: {
          tasks: p._count.tasks,
          members: p._count.members,
          posts: p._count.comments,
          files: p._count.attachments,
        },
        totals: t,
        completion: weightedCompletion(own),
        health,
      };
    });

    const alerts: Alert[] = buildAlerts({
      tasks,
      meetingsSoon: meetingsSoon.map((m) => ({
        id: m.id,
        title: m.title,
        startsAt: m.startsAt,
        mode: m.mode,
        location: m.location,
      })),
      awaitingMyAcceptance: awaitingAcceptance,
      awaitingMyApproval: awaitingApproval,
      openBlockers: blockers.map((b) => ({
        id: b.id,
        taskId: b.taskId ?? "",
        taskTitle: b.taskTitle,
        body: b.body,
        createdAt: b.createdAt,
      })),
      projectsAtRisk: projectCards
        .filter((p) => p.totals.overdue > 0)
        .sort((a, b) => b.totals.overdue - a.totals.overdue)
        .map((p) => ({ id: p.id, name: p.name, overdue: p.totals.overdue })),
      unreadNotifications: unread,
    });

    const recentActivity = await prisma.activityLog.findMany({
      where: {
        OR: [
          { task: taskVisibilityWhere(user) },
          { projectId: { in: projects.map((p) => p.id) } },
        ],
      },
      select: {
        id: true,
        action: true,
        detail: true,
        createdAt: true,
        actor: { select: { id: true, fullName: true } },
        task: { select: { id: true, title: true } },
        project: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    res.json({
      generatedAt: new Date(),
      thresholds: { staleDays: STALE_DAYS, dueSoonDays: SOON_DAYS },
      totals: totalsFor(tasks),
      mine: {
        totals: totalsFor(mine),
        awaitingMyAcceptance: awaitingAcceptance,
        awaitingMyApproval: awaitingApproval,
        unreadNotifications: unread,
      },
      alerts,
      urgent: tasks.filter(isUrgent).sort(byUrgency).slice(0, CAP),
      overdue: tasks.filter(isOverdue).sort(byUrgency).slice(0, CAP),
      dueSoon: tasks.filter(isDueSoon).sort(byUrgency).slice(0, CAP),
      stale: tasks.filter(isStale).slice(0, CAP),
      unassigned: tasks.filter((t) => isOpen(t) && !t.primaryLead).slice(0, CAP),
      myWork: mine.filter(isOpen).sort(byUrgency).slice(0, CAP),
      blockers: blockers.slice(0, CAP),
      meetings: { today: meetingsToday, upcoming: meetings.slice(0, CAP) },
      projects: projectCards
        .sort((a, b) => a.health.score - b.health.score || b.totals.overdue - a.totals.overdue)
        .slice(0, CAP),
      statusMix: statusMix(tasks),
      priorityMix: priorityMix(tasks),
      workload: workloadFor(tasks).slice(0, 15),
      byDepartment: byDepartment(tasks),
      trend: trendFor(tasks, 14),
      recentActivity,
    });
  })
);

// GET /api/dashboard/alerts  -  the alert strip on its own, for polling
dashboardRouter.get(
  "/alerts",
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const [tasks, meetings, blockers, awaitingAcceptance, awaitingApproval, unread, projects] = await Promise.all([
      loadVisibleTasks(user),
      loadMeetingsSoon(user, 24),
      loadOpenBlockers(user),
      prisma.taskRequest.count({ where: { toId: user.id, state: RequestState.PENDING_ACCEPTANCE } }),
      prisma.taskRequest.count({
        where: {
          state: RequestState.PENDING_APPROVAL,
          OR: [
            ...(user.headsDepartmentIds.length ? [{ toDepartmentId: { in: user.headsDepartmentIds } }] : []),
            ...(user.headsOfficeIds.length ? [{ toOfficeId: { in: user.headsOfficeIds } }] : []),
          ],
        },
      }),
      prisma.notification.count({ where: { userId: user.id, isRead: false } }),
      loadVisibleProjects(user),
    ]);

    const tasksByProject = new Map<string, TaskCard[]>();
    for (const t of tasks) {
      if (!t.project) continue;
      const list = tasksByProject.get(t.project.id) ?? [];
      list.push(t);
      tasksByProject.set(t.project.id, list);
    }

    res.json({
      generatedAt: new Date(),
      alerts: buildAlerts({
        tasks,
        meetingsSoon: meetings.map((m) => ({
          id: m.id,
          title: m.title,
          startsAt: m.startsAt,
          mode: m.mode,
          location: m.location,
        })),
        awaitingMyAcceptance: awaitingAcceptance,
        awaitingMyApproval: awaitingApproval,
        openBlockers: blockers.map((b) => ({
          id: b.id,
          taskId: b.taskId ?? "",
          taskTitle: b.taskTitle,
          body: b.body,
          createdAt: b.createdAt,
        })),
        projectsAtRisk: projects
          .map((p) => ({
            id: p.id,
            name: p.name,
            overdue: (tasksByProject.get(p.id) ?? []).filter(isOverdue).length,
          }))
          .filter((p) => p.overdue > 0),
        unreadNotifications: unread,
      }),
    });
  })
);

// GET /api/dashboard/my-day  -  the short version: today, and what is late
dashboardRouter.get(
  "/my-day",
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const [tasks, meetings] = await Promise.all([
      loadVisibleTasks(user, {
        OR: [{ currentlyWithId: user.id }, { primaryLeadId: user.id }, { secondaryLeadId: user.id }],
      }),
      loadMeetingsSoon(user, 24),
    ]);

    const open = tasks.filter(isOpen);
    res.json({
      generatedAt: new Date(),
      totals: totalsFor(tasks),
      overdue: open.filter(isOverdue).sort(byUrgency),
      today: open.filter((t) => daysUntil(t.dueDate) === 0),
      next: open
        .filter((t) => {
          const d = daysUntil(t.dueDate);
          return d !== null && d > 0 && d <= 7;
        })
        .sort(byUrgency),
      inProgress: open.filter((t) => t.status === TaskStatus.IN_PROGRESS).slice(0, CAP),
      meetings,
    });
  })
);
