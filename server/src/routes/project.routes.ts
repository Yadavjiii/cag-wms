import { Router, Request } from "express";
import { z } from "zod";
import { Prisma, ProjectStatus, ProjectRole, TaskPriority, CommentKind } from "@prisma/client";
import { prisma } from "../prisma";
import { asyncHandler, HttpError } from "../utils/http";
import { authenticate, isGlobalAdmin } from "../middleware/auth";
import { notify } from "../services/notify";
import { broadcast } from "../realtime";
import { VISIBLE } from "../services/accountLifecycle";
import {
  canContributeToProject,
  canManageProject,
  projectVisibilityWhere,
} from "../services/projectAccess";
import {
  byDepartment,
  daysUntil,
  isDueSoon,
  isOpen,
  isOverdue,
  isStale,
  isUrgent,
  loadOpenBlockers,
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
 * Projects are the containers that gather people and work. There are no
 * standing teams: each project forms its own working group, with a primary
 * lead, an optional secondary lead, members and read-only observers, all of
 * which stay editable for the life of the project.
 */
export const projectRouter = Router();
projectRouter.use(authenticate);

type ReqUser = NonNullable<Request["user"]>;

const memberInclude = {
  members: {
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          email: true,
          designation: { select: { id: true, name: true, code: true, rank: true } },
          avatarUrl: true,
          department: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { addedAt: "asc" },
  },
  office: { select: { id: true, name: true, code: true } },
  department: { select: { id: true, name: true } },
  createdBy: { select: { id: true, fullName: true } },
  _count: { select: { tasks: true } },
} as const;

// Visibility and the manage/contribute rules now live in services/projectAccess
// so the discussion, attachment and dashboard endpoints answer the same
// question the same way. These two aliases keep the call sites below readable.
const projectVisibility = projectVisibilityWhere;
const canManage = canManageProject;

async function loadProject(id: string) {
  const project = await prisma.project.findUnique({
    where: { id },
    include: { ...memberInclude },
  });
  if (!project) throw new HttpError(404, "Project not found");
  return project;
}

// GET /api/projects  -  projects I can see
projectRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const filters: Prisma.ProjectWhereInput[] = [projectVisibility(req.user!)];

    if (req.query.includeArchived !== "true") filters.push({ archivedAt: null });
    const status = req.query.status as string | undefined;
    if (status && status in ProjectStatus) filters.push({ status: status as ProjectStatus });
    if (req.query.mine === "true") filters.push({ members: { some: { userId: req.user!.id } } });

    const projects = await prisma.project.findMany({
      where: { AND: filters },
      include: memberInclude,
      orderBy: [{ status: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
    });
    res.json(projects);
  })
);

// GET /api/projects/:id  -  detail, with members and work items
projectRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const project = await prisma.project.findFirst({
      where: { AND: [{ id: req.params.id }, projectVisibility(req.user!)] },
      include: {
        ...memberInclude,
        tasks: {
          where: { archivedAt: null },
          select: {
            id: true,
            title: true,
            status: true,
            priority: true,
            dueDate: true,
            pctComplete: true,
            primaryLead: { select: { id: true, fullName: true } },
            currentlyWith: { select: { id: true, fullName: true } },
          },
          orderBy: [{ dueDate: "asc" }],
        },
      },
    });
    if (!project) throw new HttpError(404, "Project not found or not visible to you");
    res.json({
      ...project,
      canManage: canManage(req.user!, project),
      canContribute: canContributeToProject(req.user!, project),
    });
  })
);

// GET /api/projects/:id/dashboard  -  the project-wise dashboard
//
// One request, one consistent snapshot. Everything here is computed from the
// project's own work items, so the figures on this screen and the figures on the
// office dashboard are produced by the same functions and cannot disagree.
projectRouter.get(
  "/:id/dashboard",
  asyncHandler(async (req, res) => {
    const project = await prisma.project.findFirst({
      where: { AND: [{ id: req.params.id }, projectVisibility(req.user!)] },
      include: {
        ...memberInclude,
        _count: { select: { tasks: true, members: true, comments: true, attachments: true, meetings: true, activities: true } },
      },
    });
    if (!project) throw new HttpError(404, "Project not found or not visible to you");

    const tasks = await prisma.task.findMany({
      where: { projectId: project.id, archivedAt: null },
      select: {
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
      },
      orderBy: [{ dueDate: "asc" }],
    });

    const [blockers, updates, files, meetings, activity] = await Promise.all([
      loadOpenBlockers(req.user!, tasks.map((t) => t.id)),
      // The reporting narrative: project-level updates and work-item updates
      // interleaved, newest first, because that is how a review reads it.
      prisma.projectComment.findMany({
        where: { projectId: project.id, deletedAt: null, kind: CommentKind.STATUS_UPDATE },
        select: {
          id: true,
          body: true,
          createdAt: true,
          author: { select: { id: true, fullName: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      prisma.attachment.findMany({
        where: { OR: [{ projectId: project.id }, { task: { projectId: project.id } }] },
        select: {
          id: true,
          fileName: true,
          size: true,
          mimeType: true,
          createdAt: true,
          taskId: true,
          uploadedBy: { select: { id: true, fullName: true } },
          task: { select: { id: true, title: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      // platform-scope: keyed to one project that loadVisibleProject already
      // confirmed this user may see, and a project belongs to exactly one
      // office. Meetings on it cannot cross the boundary.
      prisma.meeting.findMany({
        where: { OR: [{ projectId: project.id }, { task: { projectId: project.id } }] },
        select: {
          id: true,
          title: true,
          startsAt: true,
          endsAt: true,
          mode: true,
          location: true,
          task: { select: { id: true, title: true } },
          _count: { select: { participants: true } },
        },
        orderBy: { startsAt: "asc" },
      }),
      prisma.activityLog.findMany({
        where: { OR: [{ projectId: project.id }, { task: { projectId: project.id } }] },
        select: {
          id: true,
          action: true,
          detail: true,
          createdAt: true,
          actor: { select: { id: true, fullName: true } },
          task: { select: { id: true, title: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
    ]);

    const totals = totalsFor(tasks);
    const now = new Date();

    // Per-member view: what each person on the team is actually carrying on
    // this project, including the ones carrying nothing.
    const load = workloadFor(tasks);
    const team = project.members.map((m) => {
      const row = load.find((l) => l.userId === m.userId);
      return {
        userId: m.userId,
        role: m.role,
        user: m.user,
        open: row?.open ?? 0,
        overdue: row?.overdue ?? 0,
        urgent: row?.urgent ?? 0,
        finished: row?.finished ?? 0,
        avgCompletion: row?.avgCompletion ?? 0,
      };
    });

    const elapsed =
      project.startDate && project.dueDate
        ? Math.min(
            100,
            Math.max(
              0,
              Math.round(
                ((now.getTime() - project.startDate.getTime()) /
                  (project.dueDate.getTime() - project.startDate.getTime())) *
                  100
              )
            )
          )
        : null;

    res.json({
      project: {
        ...project,
        canManage: canManage(req.user!, project),
        canContribute: canContributeToProject(req.user!, project),
      },
      generatedAt: now,
      thresholds: { staleDays: STALE_DAYS, dueSoonDays: SOON_DAYS },
      health: projectHealth(tasks, project),
      totals,
      completion: weightedCompletion(tasks),
      // Percentage of the schedule spent against percentage of work done: the
      // one comparison that tells you early whether the plan is holding.
      schedule: {
        startDate: project.startDate,
        dueDate: project.dueDate,
        daysToDue: daysUntil(project.dueDate),
        elapsedPct: elapsed,
      },
      counts: {
        tasks: project._count.tasks,
        members: project._count.members,
        posts: project._count.comments,
        files: files.length,
        meetings: project._count.meetings,
        blockers: blockers.length,
      },
      statusMix: statusMix(tasks),
      priorityMix: priorityMix(tasks),
      byDepartment: byDepartment(tasks),
      trend: trendFor(tasks, 21),
      team,
      lists: {
        urgent: tasks.filter(isUrgent),
        overdue: tasks.filter(isOverdue),
        dueSoon: tasks.filter(isDueSoon),
        stale: tasks.filter(isStale),
        unassigned: tasks.filter((t) => isOpen(t) && !t.primaryLead),
        finished: tasks.filter((t) => !isOpen(t)).slice(0, 20),
        all: tasks,
      },
      blockers,
      updates,
      files,
      meetings: {
        upcoming: meetings.filter((m) => m.startsAt >= now),
        past: meetings.filter((m) => m.startsAt < now).slice(-10),
      },
      activity,
    });
  })
);

// GET /api/projects/:id/activity  -  the project's own timeline
projectRouter.get(
  "/:id/activity",
  asyncHandler(async (req, res) => {
    const project = await prisma.project.findFirst({
      where: { AND: [{ id: req.params.id }, projectVisibility(req.user!)] },
      select: { id: true },
    });
    if (!project) throw new HttpError(404, "Project not found or not visible to you");
    const entries = await prisma.activityLog.findMany({
      where: { OR: [{ projectId: project.id }, { task: { projectId: project.id } }] },
      select: {
        id: true,
        action: true,
        detail: true,
        createdAt: true,
        actor: { select: { id: true, fullName: true } },
        task: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json(entries);
  })
);

const createSchema = z.object({
  name: z.string().min(2, "Give the project a name"),
  code: z.string().optional(),
  description: z.string().optional(),
  status: z.nativeEnum(ProjectStatus).optional(),
  priority: z.nativeEnum(TaskPriority).optional(),
  departmentId: z.string().nullable().optional(),
  startDate: z.coerce.date().nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  primaryLeadId: z.string().nullable().optional(),
  secondaryLeadId: z.string().nullable().optional(),
  memberIds: z.array(z.string()).optional(),
  observerIds: z.array(z.string()).optional(),
});

/** Everyone named on a project must belong to the project's office. */
async function assertSameOffice(officeId: string, userIds: string[]) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return;
  const found = await prisma.user.findMany({
    where: { ...VISIBLE, id: { in: ids } },
    select: { id: true, fullName: true, officeId: true, isActive: true },
  });
  for (const id of ids) {
    const u = found.find((f) => f.id === id);
    if (!u) throw new HttpError(404, "One of the people you selected does not exist");
    if (u.officeId !== officeId) throw new HttpError(400, `${u.fullName} belongs to a different office`);
    if (!u.isActive) throw new HttpError(400, `${u.fullName}'s account is deactivated`);
  }
}

// POST /api/projects  -  create a project and its working group in one go
projectRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body);
    const officeId = req.user!.officeId;
    if (!officeId) throw new HttpError(400, "Your account is not attached to an office");

    if (data.primaryLeadId && data.primaryLeadId === data.secondaryLeadId) {
      throw new HttpError(400, "The primary and secondary lead must be different people");
    }

    const everyone = [
      ...(data.primaryLeadId ? [data.primaryLeadId] : []),
      ...(data.secondaryLeadId ? [data.secondaryLeadId] : []),
      ...(data.memberIds ?? []),
      ...(data.observerIds ?? []),
    ];
    await assertSameOffice(officeId, everyone);

    // Build the membership rows, letting the more senior standing win if
    // somebody appears in more than one list.
    const rows = new Map<string, ProjectRole>();
    for (const id of data.observerIds ?? []) rows.set(id, ProjectRole.OBSERVER);
    for (const id of data.memberIds ?? []) rows.set(id, ProjectRole.MEMBER);
    if (data.secondaryLeadId) rows.set(data.secondaryLeadId, ProjectRole.SECONDARY_LEAD);
    if (data.primaryLeadId) rows.set(data.primaryLeadId, ProjectRole.PRIMARY_LEAD);
    // The creator is always on their own project.
    if (!rows.has(req.user!.id)) rows.set(req.user!.id, ProjectRole.MEMBER);

    const project = await prisma.project.create({
      data: {
        name: data.name,
        code: data.code,
        description: data.description,
        status: data.status ?? ProjectStatus.ACTIVE,
        priority: data.priority ?? TaskPriority.NORMAL,
        officeId,
        departmentId: data.departmentId ?? req.user!.departmentId ?? undefined,
        startDate: data.startDate ?? undefined,
        dueDate: data.dueDate ?? undefined,
        createdById: req.user!.id,
        members: {
          create: [...rows.entries()].map(([userId, role]) => ({ userId, role, addedById: req.user!.id })),
        },
      },
      include: memberInclude,
    });

    // Tell everyone except the creator that they are on it.
    for (const [userId, role] of rows) {
      if (userId === req.user!.id) continue;
      await notify({
        userId,
        kind: "project_added",
        title: `Added to project: ${project.name}`,
        body: `${req.user!.fullName} added you to "${project.name}" as ${labelFor(role)}.`,
        projectId: project.id,
      });
    }

    await prisma.activityLog.create({
      data: {
        projectId: project.id,
        actorId: req.user!.id,
        action: "project_created",
        detail: { name: project.name, members: rows.size },
      },
    });

    broadcast("project:changed", { projectId: project.id });
    res.status(201).json(project);
  })
);

function labelFor(role: ProjectRole): string {
  switch (role) {
    case ProjectRole.PRIMARY_LEAD:
      return "primary lead";
    case ProjectRole.SECONDARY_LEAD:
      return "secondary lead";
    case ProjectRole.OBSERVER:
      return "an observer";
    default:
      return "a member";
  }
}

const updateSchema = createSchema
  .omit({ memberIds: true, observerIds: true, primaryLeadId: true, secondaryLeadId: true })
  .partial();

// PATCH /api/projects/:id  -  rename, reschedule, change status
projectRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const project = await loadProject(req.params.id);
    if (!canManage(req.user!, project)) throw new HttpError(403, "You cannot edit this project");

    const data = updateSchema.parse(req.body);
    const updated = await prisma.project.update({
      where: { id: project.id },
      data: {
        ...data,
        startDate: data.startDate ?? undefined,
        dueDate: data.dueDate ?? undefined,
        departmentId: data.departmentId ?? undefined,
      },
      include: memberInclude,
    });

    await prisma.activityLog.create({
      data: {
        projectId: project.id,
        actorId: req.user!.id,
        action: data.status && data.status !== project.status ? "project_status_changed" : "project_updated",
        detail: {
          ...(data.status ? { statusFrom: project.status, statusTo: data.status } : {}),
          ...(data.priority ? { priority: data.priority } : {}),
        } as Prisma.InputJsonValue,
      },
    });

    // Everyone on the team hears about a status change; nobody needs an email
    // because somebody fixed a typo in the description.
    if (data.status && data.status !== project.status) {
      for (const m of project.members) {
        if (m.userId === req.user!.id) continue;
        await notify({
          userId: m.userId,
          kind: "project_status_changed",
          title: `${project.name} is now ${data.status.replace(/_/g, " ").toLowerCase()}`,
          body: `${req.user!.fullName} changed the project status.`,
          projectId: project.id,
        });
      }
    }

    broadcast("project:changed", { projectId: project.id });
    res.json(updated);
  })
);

// DELETE /api/projects/:id  -  archive (soft delete). History is preserved.
projectRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const project = await loadProject(req.params.id);
    if (!canManage(req.user!, project)) throw new HttpError(403, "You cannot delete this project");

    await prisma.project.update({
      where: { id: project.id },
      data: { archivedAt: new Date(), archivedById: req.user!.id },
    });
    // Work items survive; they simply lose their project link.
    await prisma.task.updateMany({ where: { projectId: project.id }, data: { projectId: null } });

    broadcast("project:changed", { projectId: project.id });
    res.status(204).end();
  })
);

// POST /api/projects/:id/restore  -  bring an archived project back
projectRouter.post(
  "/:id/restore",
  asyncHandler(async (req, res) => {
    const project = await loadProject(req.params.id);
    if (!canManage(req.user!, project)) throw new HttpError(403, "You cannot restore this project");
    const updated = await prisma.project.update({
      where: { id: project.id },
      data: { archivedAt: null, archivedById: null },
      include: memberInclude,
    });
    res.json(updated);
  })
);

const memberSchema = z.object({
  userId: z.string(),
  role: z.nativeEnum(ProjectRole).optional(),
});

// POST /api/projects/:id/members  -  add someone, or change their standing
projectRouter.post(
  "/:id/members",
  asyncHandler(async (req, res) => {
    const project = await loadProject(req.params.id);
    if (!canManage(req.user!, project)) throw new HttpError(403, "You cannot change this project's team");

    const { userId, role = ProjectRole.MEMBER } = memberSchema.parse(req.body);
    await assertSameOffice(project.officeId, [userId]);

    // Only one primary and one secondary lead at a time: promoting someone
    // demotes the incumbent to a plain member rather than silently duplicating.
    if (role === ProjectRole.PRIMARY_LEAD || role === ProjectRole.SECONDARY_LEAD) {
      await prisma.projectMember.updateMany({
        where: { projectId: project.id, role, NOT: { userId } },
        data: { role: ProjectRole.MEMBER },
      });
    }

    const member = await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: project.id, userId } },
      update: { role },
      create: { projectId: project.id, userId, role, addedById: req.user!.id },
      include: { user: { select: { id: true, fullName: true, designation: { select: { id: true, name: true, code: true, rank: true } }, email: true } } },
    });

    await prisma.activityLog.create({
      data: {
        projectId: project.id,
        actorId: req.user!.id,
        action: "member_added",
        detail: { who: member.user.fullName, as: labelFor(role) },
      },
    });

    await notify({
      userId,
      kind: "project_added",
      title: `Project: ${project.name}`,
      body: `${req.user!.fullName} made you ${labelFor(role)} on "${project.name}".`,
      projectId: project.id,
    });

    broadcast("project:changed", { projectId: project.id });
    res.status(201).json(member);
  })
);

// PATCH /api/projects/:id/members/:userId  -  change someone's standing
projectRouter.patch(
  "/:id/members/:userId",
  asyncHandler(async (req, res) => {
    const project = await loadProject(req.params.id);
    if (!canManage(req.user!, project)) throw new HttpError(403, "You cannot change this project's team");

    const { role } = z.object({ role: z.nativeEnum(ProjectRole) }).parse(req.body);
    if (role === ProjectRole.PRIMARY_LEAD || role === ProjectRole.SECONDARY_LEAD) {
      await prisma.projectMember.updateMany({
        where: { projectId: project.id, role, NOT: { userId: req.params.userId } },
        data: { role: ProjectRole.MEMBER },
      });
    }

    const member = await prisma.projectMember.update({
      where: { projectId_userId: { projectId: project.id, userId: req.params.userId } },
      data: { role },
      include: { user: { select: { id: true, fullName: true, designation: { select: { id: true, name: true, code: true, rank: true } }, email: true } } },
    });

    await prisma.activityLog.create({
      data: {
        projectId: project.id,
        actorId: req.user!.id,
        action: "member_role_changed",
        detail: { who: member.user.fullName, as: labelFor(role) },
      },
    });

    await notify({
      userId: req.params.userId,
      kind: "project_role_changed",
      title: `Your role changed on ${project.name}`,
      body: `${req.user!.fullName} made you ${labelFor(role)} on "${project.name}".`,
      projectId: project.id,
    });

    broadcast("project:changed", { projectId: project.id });
    res.json(member);
  })
);

// DELETE /api/projects/:id/members/:userId  -  take someone off the project
projectRouter.delete(
  "/:id/members/:userId",
  asyncHandler(async (req, res) => {
    const project = await loadProject(req.params.id);
    if (!canManage(req.user!, project)) throw new HttpError(403, "You cannot change this project's team");

    await prisma.projectMember.deleteMany({ where: { projectId: project.id, userId: req.params.userId } });

    await prisma.activityLog.create({
      data: {
        projectId: project.id,
        actorId: req.user!.id,
        action: "member_removed",
        detail: { who: project.members.find((m) => m.userId === req.params.userId)?.user.fullName ?? null },
      },
    });

    await notify({
      userId: req.params.userId,
      kind: "project_removed",
      title: `Removed from project: ${project.name}`,
      body: `${req.user!.fullName} removed you from "${project.name}".`,
      projectId: project.id,
    });

    broadcast("project:changed", { projectId: project.id });
    res.status(204).end();
  })
);

// GET /api/projects/:id/available-people  -  office staff not yet on the project
projectRouter.get(
  "/:id/available-people",
  asyncHandler(async (req, res) => {
    const project = await loadProject(req.params.id);
    const existing = project.members.map((m) => m.userId);
    const people = await prisma.user.findMany({
      where: { ...VISIBLE, officeId: project.officeId, isActive: true, id: { notIn: existing.length ? existing : ["__none__"] } },
      orderBy: [{ role: { level: "desc" } }, { fullName: "asc" }],
      select: {
        id: true,
        fullName: true,
        email: true,
        designation: { select: { id: true, name: true, code: true, rank: true } },
        department: { select: { id: true, name: true } },
      },
    });
    res.json(people);
  })
);
