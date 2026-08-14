import { Router, Request } from "express";
import { z } from "zod";
import { Prisma, TaskStatus, TaskPriority, RequestState, RequestScope } from "@prisma/client";
import { prisma } from "../prisma";
import { asyncHandler, HttpError } from "../utils/http";
import { authenticate, isGlobalAdmin, headsOffice } from "../middleware/auth";
import { notify } from "../services/notify";
import { taskVisibilityWhere as taskVisibility, canEditTask as canEdit } from "../services/taskAccess";
import { broadcast } from "../realtime";
import { VISIBLE } from "../services/accountLifecycle";
import { OFFICE_ADMIN_ROLE_FILTER } from "../services/roles";
import { canReportProgress } from "../services/discussion";
import { daysUntil, isOverdue, isStale, isUrgent, ragOf, STALE_DAYS } from "../services/dashboard";

export const taskRouter = Router();
taskRouter.use(authenticate);

type ReqUser = NonNullable<Request["user"]>;

const leadInclude = {
  primaryLead: { select: { id: true, fullName: true } },
  secondaryLead: { select: { id: true, fullName: true } },
  currentlyWith: { select: { id: true, fullName: true } },
  project: { select: { id: true, name: true } },
} as const;

// GET /api/tasks?status=&projectId=&mine=true
taskRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const filters: Prisma.TaskWhereInput[] = [taskVisibility(req.user!)];

    // Deleted work items are archived, not destroyed. They stay out of every
    // list unless explicitly asked for.
    if (req.query.includeArchived !== "true") filters.push({ archivedAt: null });

    const status = req.query.status as string | undefined;
    if (status && status in TaskStatus) filters.push({ status: status as TaskStatus });

    const projectId = req.query.projectId as string | undefined;
    if (projectId) filters.push({ projectId });

    const priority = req.query.priority as string | undefined;
    if (priority && priority in TaskPriority) filters.push({ priority: priority as TaskPriority });

    if (req.query.mine === "true") {
      filters.push({
        OR: [
          { primaryLeadId: req.user!.id },
          { secondaryLeadId: req.user!.id },
          { currentlyWithId: req.user!.id },
        ],
      });
    }

    // The dashboard links straight into a filtered list, so the same words it
    // uses on the alert strip have to mean the same thing here. They are
    // resolved after the query rather than in SQL because "urgent" and "stale"
    // are judgements about the row, not columns on it.
    const open = { status: { not: TaskStatus.FINISHED } } as const;
    const filter = req.query.filter as string | undefined;
    if (filter === "overdue") filters.push({ ...open, dueDate: { not: null, lt: new Date() } });
    if (filter === "due-today" || filter === "urgent" || filter === "stale") filters.push(open);
    if (filter === "unassigned") filters.push({ ...open, primaryLeadId: null });

    // platform-scope: filters[0] is always taskVisibility(req.user), which is
    // the office boundary. The checker cannot see through the array.
    let tasks = await prisma.task.findMany({
      where: { AND: filters },
      include: leadInclude,
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
    });

    if (filter === "due-today") tasks = tasks.filter((t) => daysUntil(t.dueDate) === 0);
    if (filter === "urgent") tasks = tasks.filter(isUrgent);
    if (filter === "stale") tasks = tasks.filter(isStale);

    res.json(tasks);
  })
);

const createSchema = z.object({
  title: z.string().min(2),
  description: z.string().optional(),
  status: z.nativeEnum(TaskStatus).optional(),
  priority: z.nativeEnum(TaskPriority).optional(),
  projectId: z.string().optional(),
  primaryLeadId: z.string().optional(),
  secondaryLeadId: z.string().optional(),
  currentlyWithId: z.string().optional(),
  assignedDate: z.coerce.date().optional(),
  dueDate: z.coerce.date().optional(),
  pctComplete: z.number().int().min(0).max(100).optional(),
});

// POST /api/tasks
taskRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body);
    const task = await prisma.task.create({
      data: {
        ...data,
        createdById: req.user!.id,
        owningOfficeId: req.user!.officeId,
        executingOfficeId: req.user!.officeId,
        departmentId: req.user!.departmentId ?? undefined,
        currentlyWithId: data.currentlyWithId ?? req.user!.id,
      },
      include: leadInclude,
    });
    await prisma.activityLog.create({
      data: { taskId: task.id, actorId: req.user!.id, action: "created", detail: { title: task.title } },
    });
    broadcast("task:changed", { taskId: task.id });
    res.status(201).json(task);
  })
);

// GET /api/tasks/:id
taskRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const task = await prisma.task.findFirst({
      where: { AND: [{ id: req.params.id }, taskVisibility(req.user!)] },
      include: {
        ...leadInclude,
        comments: {
          include: {
            author: { select: { id: true, fullName: true, avatarUrl: true, designation: { select: { id: true, name: true, code: true } } } },
            attachments: { select: { id: true, fileName: true, size: true, mimeType: true, createdAt: true } },
          },
          orderBy: { createdAt: "asc" },
        },
        // Files attached to the item as a whole. Files that belong to a single
        // post travel with that post, not here, or the list becomes a dumping
        // ground within a week.
        attachments: {
          where: { taskCommentId: null },
          include: { uploadedBy: { select: { id: true, fullName: true } } },
          orderBy: { createdAt: "desc" },
        },
        department: { select: { id: true, name: true } },
        owningOffice: { select: { id: true, name: true, code: true } },
        executingOffice: { select: { id: true, name: true, code: true } },
        createdBy: { select: { id: true, fullName: true } },
        _count: { select: { comments: true, attachments: true, meetings: true, activities: true } },
      },
    });
    if (!task) throw new HttpError(404, "Task not found or not visible to you");
    res.json({
      ...task,
      canEdit: canEdit(req.user!, task),
      canReportProgress: await canReportProgress(req.user!, task),
    });
  })
);

const updateSchema = createSchema.partial();

// PATCH /api/tasks/:id
taskRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const existing = await prisma.task.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new HttpError(404, "Task not found");
    if (!canEdit(req.user!, existing)) throw new HttpError(403, "You cannot edit this task");

    const data = updateSchema.parse(req.body);
    if (data.status === TaskStatus.FINISHED && data.pctComplete === undefined) data.pctComplete = 100;

    // Moving the status or the percentage IS reporting progress, even when it
    // was done from the edit form rather than the thread. Without this the
    // staleness alert fires on work that is visibly moving.
    const reportedProgress = data.status !== undefined || data.pctComplete !== undefined;

    const task = await prisma.task.update({
      where: { id: existing.id },
      data: { ...data, ...(reportedProgress ? { lastUpdateAt: new Date() } : {}) },
      include: leadInclude,
    });
    await prisma.activityLog.create({
      data: {
        taskId: task.id,
        projectId: task.projectId,
        actorId: req.user!.id,
        action: reportedProgress ? "progress_reported" : "updated",
        detail: {
          ...(JSON.parse(JSON.stringify(data)) as Record<string, unknown>),
          ...(data.status ? { statusFrom: existing.status, statusTo: data.status } : {}),
          ...(data.pctComplete !== undefined ? { pctFrom: existing.pctComplete ?? 0, pctTo: data.pctComplete } : {}),
        } as Prisma.InputJsonValue,
      },
    });
    broadcast("task:changed", { taskId: task.id });
    res.json(task);
  })
);

// The thread on a work item (remarks, directions, progress updates, replies,
// per-post attachments) lives in discussion.routes.ts:
//   GET  /api/tasks/:id/discussion
//   POST /api/tasks/:id/discussion
//   POST /api/tasks/:id/progress
// POST /api/tasks/:id/comments still works and is handled there too, so
// anything written against the older endpoint keeps running.

// ===================== ASSIGNMENT & APPROVAL WORKFLOW =====================
// Assigning within your own department takes effect immediately (the assignee
// then accepts or declines). Assigning into a DIFFERENT department first
// requires that department's head to approve before it activates. Every step
// is written to the activity log so the movement history is permanent.

const assignInclude = {
  from: { select: { id: true, fullName: true } },
  to: { select: { id: true, fullName: true } },
  toDepartment: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, fullName: true } },
} as const;

const assignSchema = z.object({ toUserId: z.string(), message: z.string().optional() });

// POST /api/tasks/:id/assign  -  assign this work item to a user
taskRouter.post(
  "/:id/assign",
  asyncHandler(async (req, res) => {
    const task = await prisma.task.findUnique({ where: { id: req.params.id } });
    if (!task) throw new HttpError(404, "Task not found");
    if (!canEdit(req.user!, task)) throw new HttpError(403, "You cannot assign this work item");

    const { toUserId, message } = assignSchema.parse(req.body);
    if (toUserId === task.currentlyWithId) throw new HttpError(400, "That person already holds this work item");

    const target = await prisma.user.findUnique({
      where: { id: toUserId },
      select: { id: true, fullName: true, departmentId: true },
    });
    if (!target) throw new HttpError(404, "Target user not found");

    // Cross-department only when both sides have a department and they differ.
    const crossDept = !!task.departmentId && !!target.departmentId && task.departmentId !== target.departmentId;

    const assignment = await prisma.taskRequest.create({
      data: {
        taskId: task.id,
        fromId: req.user!.id,
        toId: target.id,
        message,
        requiresApproval: crossDept,
        toDepartmentId: crossDept ? target.departmentId : null,
        scope: crossDept ? RequestScope.DEPARTMENT : RequestScope.USER,
        state: crossDept ? RequestState.PENDING_APPROVAL : RequestState.PENDING_ACCEPTANCE,
      },
      include: assignInclude,
    });

    // Same-department: the item lands on the assignee's desk right away.
    if (!crossDept) {
      await prisma.task.update({ where: { id: task.id }, data: { currentlyWithId: target.id } });
    }

    await prisma.activityLog.create({
      data: {
        taskId: task.id,
        actorId: req.user!.id,
        action: crossDept ? "assignment_requested" : "assigned",
        detail: { to: target.fullName, crossDepartment: crossDept },
      },
    });

    if (crossDept) {
      const dept = await prisma.department.findUnique({ where: { id: target.departmentId! }, select: { headId: true, name: true } });
      await notify({
        userId: dept?.headId,
        kind: "approval_request",
        title: `Approval needed: ${task.title}`,
        body: `${req.user!.fullName} wants to assign this to ${target.fullName} in ${dept?.name ?? "your department"}.`,
        taskId: task.id,
      });
    } else {
      await notify({
        userId: target.id,
        kind: "assigned",
        title: `New work assigned: ${task.title}`,
        body: `${req.user!.fullName} assigned this work item to you.`,
        taskId: task.id,
      });
    }

    broadcast("task:changed", { taskId: task.id });
    res.status(201).json(assignment);
  })
);

// ===================== CROSS-OFFICE WORK REQUESTS =====================
// An office head who needs another CAG office to take on a piece of work sends
// a request rather than an assignment. The receiving office's head (DG / PAG /
// DAG or any IAAS-rank officer) approves or rejects it, and on approval
// nominates one of their own staff. Until then nothing moves.

const officeRequestSchema = z.object({
  toOfficeId: z.string(),
  message: z.string().max(2000).optional(),
  dueDate: z.coerce.date().optional(),
});

// POST /api/tasks/:id/request-office  -  ask another office to take this on
taskRouter.post(
  "/:id/request-office",
  asyncHandler(async (req, res) => {
    const task = await prisma.task.findUnique({ where: { id: req.params.id } });
    if (!task) throw new HttpError(404, "Task not found");

    const user = req.user!;
    const mayRequest =
      user.permissions.includes("office.request") || headsOffice(user, task.executingOfficeId) || isGlobalAdmin(user);
    if (!mayRequest) throw new HttpError(403, "Only an office head can send work to another office");
    if (!canEdit(user, task)) throw new HttpError(403, "You cannot route this work item");

    const { toOfficeId, message, dueDate } = officeRequestSchema.parse(req.body);
    if (toOfficeId === task.executingOfficeId) throw new HttpError(400, "That work item already sits with this office");

    const office = await prisma.office.findUnique({
      where: { id: toOfficeId },
      select: { id: true, name: true, headId: true, isActive: true },
    });
    if (!office) throw new HttpError(404, "Office not found");
    if (!office.isActive) throw new HttpError(400, "That office is not active");

    const duplicate = await prisma.taskRequest.findFirst({
      where: { taskId: task.id, toOfficeId, state: RequestState.PENDING_APPROVAL },
      select: { id: true },
    });
    if (duplicate) throw new HttpError(409, "A request to that office is already pending for this work item");

    const request = await prisma.taskRequest.create({
      data: {
        taskId: task.id,
        fromId: user.id,
        toOfficeId,
        scope: RequestScope.OFFICE,
        requiresApproval: true,
        state: RequestState.PENDING_APPROVAL,
        message,
      },
      include: assignInclude,
    });

    if (dueDate) await prisma.task.update({ where: { id: task.id }, data: { dueDate } });

    await prisma.activityLog.create({
      data: {
        taskId: task.id,
        actorId: user.id,
        action: "office_request_sent",
        detail: { toOffice: office.name, message: message ?? null },
      },
    });

    // Normally the head of the receiving office decides. If that office has no
    // head appointed yet, tell its admin instead, so the request is never
    // raised into an empty queue.
    let decider: string | null = office.headId;
    if (!decider) {
      const admin = await prisma.user.findFirst({
        where: {
          officeId: office.id,
          deletedAt: null,
          isActive: true,
          role: OFFICE_ADMIN_ROLE_FILTER,
        },
        orderBy: { role: { level: "desc" } },
        select: { id: true },
      });
      decider = admin?.id ?? null;
    }

    await notify({
      userId: decider,
      kind: "office_request",
      title: `Work request from ${user.officeName ?? "another office"}: ${task.title}`,
      body: `${user.fullName} has asked ${office.name} to take on this work. Approve or reject it, and nominate a staff member if you accept.`,
      taskId: task.id,
    });

    broadcast("task:changed", { taskId: task.id });
    res.status(201).json(request);
  })
);

// ===================== PROJECT TEAM & LEADS =====================
// A work item is also a project: it carries a team, a primary lead and a
// secondary lead, all of which stay editable for as long as the work is open.

const leadsSchema = z.object({
  primaryLeadId: z.string().nullable().optional(),
  secondaryLeadId: z.string().nullable().optional(),
});

// PATCH /api/tasks/:id/leads  -  set or change the primary/secondary lead
taskRouter.patch(
  "/:id/leads",
  asyncHandler(async (req, res) => {
    const task = await prisma.task.findUnique({ where: { id: req.params.id } });
    if (!task) throw new HttpError(404, "Task not found");
    if (!canEdit(req.user!, task)) throw new HttpError(403, "You cannot edit this work item");

    const data = leadsSchema.parse(req.body);
    if (data.primaryLeadId && data.primaryLeadId === data.secondaryLeadId) {
      throw new HttpError(400, "The primary and secondary lead must be different people");
    }

    // Leads must be real, active accounts. Where the task belongs to an office,
    // they must belong to that office too.
    for (const id of [data.primaryLeadId, data.secondaryLeadId].filter(Boolean) as string[]) {
      const person = await prisma.user.findUnique({ where: { id }, select: { id: true, officeId: true, isActive: true } });
      if (!person) throw new HttpError(404, "That person does not exist");
      if (!person.isActive) throw new HttpError(400, "That account is deactivated");
      if (task.executingOfficeId && person.officeId !== task.executingOfficeId && !isGlobalAdmin(req.user!)) {
        throw new HttpError(400, "A lead must belong to the office that owns this work item");
      }
    }

    const updated = await prisma.task.update({
      where: { id: task.id },
      data: {
        primaryLeadId: data.primaryLeadId === undefined ? undefined : data.primaryLeadId,
        secondaryLeadId: data.secondaryLeadId === undefined ? undefined : data.secondaryLeadId,
      },
      include: leadInclude,
    });

    await prisma.activityLog.create({
      data: {
        taskId: task.id,
        actorId: req.user!.id,
        action: "leads_changed",
        detail: { primaryLead: updated.primaryLead?.fullName ?? null, secondaryLead: updated.secondaryLead?.fullName ?? null },
      },
    });
    broadcast("task:changed", { taskId: task.id });
    res.json(updated);
  })
);

// GET /api/tasks/:id/assignable-people  -  who this work item can be handed to
taskRouter.get(
  "/:id/assignable-people",
  asyncHandler(async (req, res) => {
    const task = await prisma.task.findFirst({
      where: { AND: [{ id: req.params.id }, taskVisibility(req.user!)] },
      // Task has no `officeId`: it carries an owning office AND an executing
      // office. Selecting a column that does not exist threw "Unknown field"
      // the moment anybody opened the assign picker.
      select: { id: true, owningOfficeId: true, executingOfficeId: true },
    });
    if (!task) throw new HttpError(404, "Task not found or not visible to you");
    const people = await prisma.user.findMany({
      where: {
        ...VISIBLE,
        isActive: true,
        ...(isGlobalAdmin(req.user!) ? {} : { officeId: task.executingOfficeId ?? req.user!.officeId ?? undefined }),
      },
      orderBy: [{ role: { level: "desc" } }, { fullName: "asc" }],
      take: 500,
      select: {
        id: true,
        fullName: true,
        designation: { select: { id: true, name: true, code: true, rank: true } },
        email: true,
        role: { select: { id: true, name: true, level: true } },
        department: { select: { id: true, name: true } },
      },
    });
    res.json(people);
  })
);

// GET /api/tasks/:id/assignments  -  full movement history for a work item
taskRouter.get(
  "/:id/assignments",
  asyncHandler(async (req, res) => {
    const task = await prisma.task.findFirst({ where: { AND: [{ id: req.params.id }, taskVisibility(req.user!)] }, select: { id: true } });
    if (!task) throw new HttpError(404, "Task not found or not visible to you");
    const assignments = await prisma.taskRequest.findMany({
      where: { taskId: task.id },
      include: assignInclude,
      orderBy: { createdAt: "desc" },
    });
    res.json(assignments);
  })
);

// GET /api/tasks/:id/dashboard  -  the work-wise dashboard for one item
//
// Everything a review meeting asks about a single piece of work: how old it is,
// how long it sat in each state, who has actually touched it, what is attached,
// what is blocking it, and whether anybody has said anything lately.
taskRouter.get(
  "/:id/dashboard",
  asyncHandler(async (req, res) => {
    const task = await prisma.task.findFirst({
      where: { AND: [{ id: req.params.id }, taskVisibility(req.user!)] },
      include: {
        ...leadInclude,
        createdBy: { select: { id: true, fullName: true } },
        department: { select: { id: true, name: true } },
        owningOffice: { select: { id: true, name: true, code: true } },
        executingOffice: { select: { id: true, name: true, code: true } },
        _count: { select: { comments: true, attachments: true, meetings: true, requests: true } },
      },
    });
    if (!task) throw new HttpError(404, "Task not found or not visible to you");

    const [activity, posts, files, meetings] = await Promise.all([
      prisma.activityLog.findMany({
        where: { taskId: task.id },
        select: { id: true, action: true, detail: true, createdAt: true, actor: { select: { id: true, fullName: true } } },
        orderBy: { createdAt: "asc" },
      }),
      prisma.taskComment.findMany({
        where: { taskId: task.id, deletedAt: null },
        select: {
          id: true,
          kind: true,
          body: true,
          meta: true,
          isPinned: true,
          createdAt: true,
          author: { select: { id: true, fullName: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.attachment.findMany({
        where: { taskId: task.id },
        select: { id: true, fileName: true, size: true, mimeType: true, createdAt: true, uploadedBy: { select: { id: true, fullName: true } } },
        orderBy: { createdAt: "desc" },
      }),
      // platform-scope: keyed to one work item already filtered through
      // taskVisibilityWhere at the top of this handler.
      prisma.meeting.findMany({
        where: { taskId: task.id },
        select: { id: true, title: true, startsAt: true, endsAt: true, mode: true, location: true, _count: { select: { participants: true } } },
        orderBy: { startsAt: "asc" },
      }),
    ]);

    // How long the item has spent in each state, reconstructed from the audit
    // trail. The trail is the only honest source for this: a status column only
    // ever knows where the work is now.
    const transitions = activity
      .filter((a) => {
        const d = a.detail as { statusTo?: string } | null;
        return !!d?.statusTo;
      })
      .map((a) => ({ at: a.createdAt, status: (a.detail as { statusTo: string }).statusTo }));

    const timeline = [{ at: task.createdAt, status: TaskStatus.INITIATED as string }, ...transitions];
    const timeInStatus = new Map<string, number>();
    for (let i = 0; i < timeline.length; i++) {
      const until = i + 1 < timeline.length ? timeline[i + 1].at.getTime() : Date.now();
      const days = Math.max(0, (until - timeline[i].at.getTime()) / (24 * 60 * 60 * 1000));
      timeInStatus.set(timeline[i].status, (timeInStatus.get(timeline[i].status) ?? 0) + days);
    }

    // Who has actually contributed, as opposed to who is named on it.
    const contributors = new Map<string, { id: string; name: string; posts: number; lastAt: Date }>();
    for (const p of posts) {
      if (!p.author) continue;
      const row = contributors.get(p.author.id) ?? { id: p.author.id, name: p.author.fullName, posts: 0, lastAt: p.createdAt };
      row.posts++;
      if (p.createdAt > row.lastAt) row.lastAt = p.createdAt;
      contributors.set(p.author.id, row);
    }

    const lastUpdate = posts.find((p) => p.kind === "STATUS_UPDATE") ?? null;
    const ageDays = Math.floor((Date.now() - task.createdAt.getTime()) / (24 * 60 * 60 * 1000));
    const sinceUpdate = Math.floor(
      (Date.now() - (task.lastUpdateAt ?? task.updatedAt).getTime()) / (24 * 60 * 60 * 1000)
    );

    res.json({
      task,
      canEdit: canEdit(req.user!, task),
      canReportProgress: await canReportProgress(req.user!, task),
      health: {
        rag: ragOf(task),
        overdue: isOverdue(task),
        urgent: isUrgent(task),
        stale: isStale(task),
        daysToDue: daysUntil(task.dueDate),
        ageDays,
        daysSinceUpdate: sinceUpdate,
        staleAfterDays: STALE_DAYS,
      },
      counts: {
        posts: posts.length,
        updates: posts.filter((p) => p.kind === "STATUS_UPDATE").length,
        blockers: posts.filter((p) => p.kind === "BLOCKER" && p.isPinned).length,
        directions: posts.filter((p) => p.kind === "DIRECTION").length,
        files: files.length,
        meetings: meetings.length,
        handovers: task._count.requests,
        activity: activity.length,
      },
      timeInStatus: [...timeInStatus.entries()].map(([status, days]) => ({ status, days: Math.round(days * 10) / 10 })),
      statusHistory: transitions.slice(-20),
      contributors: [...contributors.values()].sort((a, b) => b.posts - a.posts),
      lastUpdate,
      openBlockers: posts.filter((p) => p.kind === "BLOCKER" && p.isPinned),
      pinned: posts.filter((p) => p.isPinned),
      recentUpdates: posts.filter((p) => p.kind === "STATUS_UPDATE").slice(0, 8),
      files,
      meetings: {
        past: meetings.filter((m) => m.startsAt < new Date()),
        upcoming: meetings.filter((m) => m.startsAt >= new Date()),
      },
      activity: [...activity].reverse().slice(0, 40),
    });
  })
);

// GET /api/tasks/:id/activity  -  the permanent audit timeline for a work item
taskRouter.get(
  "/:id/activity",
  asyncHandler(async (req, res) => {
    const task = await prisma.task.findFirst({ where: { AND: [{ id: req.params.id }, taskVisibility(req.user!)] }, select: { id: true } });
    if (!task) throw new HttpError(404, "Task not found or not visible to you");
    const entries = await prisma.activityLog.findMany({
      where: { taskId: task.id },
      include: { actor: { select: { id: true, fullName: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json(entries);
  })
);


// ===================== DELETE / RESTORE =====================
// Deleting a work item archives it. Nothing is destroyed, because the audit
// trail is the point of the system.

/** Only the creator, a lead, an office head or an admin may delete. */
function canDelete(
  user: NonNullable<import("express").Request["user"]>,
  // The signature said `officeId`, which Task does not have, while the body
  // read `executingOfficeId`. It compiled only because the two never met.
  task: { createdById: string | null; primaryLeadId: string | null; executingOfficeId: string | null }
): boolean {
  if (user.permissions.includes("task.edit_any")) return true;
  if (task.executingOfficeId && user.headsOfficeIds.includes(task.executingOfficeId)) return true;
  if (user.permissions.includes("task.edit_office") && task.executingOfficeId === user.officeId) return true;
  return task.createdById === user.id || task.primaryLeadId === user.id;
}

// DELETE /api/tasks/:id
taskRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const task = await prisma.task.findUnique({ where: { id: req.params.id } });
    if (!task) throw new HttpError(404, "Task not found");
    if (!canDelete(req.user!, task)) throw new HttpError(403, "You cannot delete this work item");

    await prisma.task.update({
      where: { id: task.id },
      data: { archivedAt: new Date(), archivedById: req.user!.id },
    });
    await prisma.activityLog.create({
      data: { taskId: task.id, actorId: req.user!.id, action: "task_deleted", detail: { title: task.title } },
    });

    // Whoever was holding it should know it went away.
    if (task.currentlyWithId && task.currentlyWithId !== req.user!.id) {
      await notify({
        userId: task.currentlyWithId,
        kind: "task_deleted",
        title: `Work item deleted: ${task.title}`,
        body: `${req.user!.fullName} deleted this work item.`,
      });
    }

    broadcast("task:changed", { taskId: task.id });
    res.status(204).end();
  })
);

// POST /api/tasks/:id/restore
taskRouter.post(
  "/:id/restore",
  asyncHandler(async (req, res) => {
    const task = await prisma.task.findUnique({ where: { id: req.params.id } });
    if (!task) throw new HttpError(404, "Task not found");
    if (!canDelete(req.user!, task)) throw new HttpError(403, "You cannot restore this work item");

    const restored = await prisma.task.update({
      where: { id: task.id },
      data: { archivedAt: null, archivedById: null },
      include: leadInclude,
    });
    await prisma.activityLog.create({
      data: { taskId: task.id, actorId: req.user!.id, action: "task_restored" },
    });
    broadcast("task:changed", { taskId: task.id });
    res.json(restored);
  })
);

// PATCH /api/tasks/:id/project  -  move a work item into or out of a project
taskRouter.patch(
  "/:id/project",
  asyncHandler(async (req, res) => {
    const task = await prisma.task.findUnique({ where: { id: req.params.id } });
    if (!task) throw new HttpError(404, "Task not found");
    if (!canEdit(req.user!, task)) throw new HttpError(403, "You cannot edit this work item");

    const { projectId } = z.object({ projectId: z.string().nullable() }).parse(req.body);
    if (projectId) {
      const project = await prisma.project.findUnique({ where: { id: projectId }, select: { officeId: true, archivedAt: true } });
      if (!project) throw new HttpError(404, "Project not found");
      if (project.archivedAt) throw new HttpError(400, "That project is archived");
      if (task.executingOfficeId && project.officeId !== task.executingOfficeId) {
        throw new HttpError(400, "That project belongs to a different office");
      }
    }

    const updated = await prisma.task.update({ where: { id: task.id }, data: { projectId }, include: leadInclude });
    broadcast("task:changed", { taskId: task.id });
    res.json(updated);
  })
);
