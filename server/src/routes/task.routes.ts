import { Router, Request } from "express";
import { z } from "zod";
import { Prisma, TaskStatus, TaskPriority, RequestState, RequestScope } from "@prisma/client";
import { prisma } from "../prisma";
import { asyncHandler, HttpError } from "../utils/http";
import { authenticate, isGlobalAdmin, headsOffice } from "../middleware/auth";
import { notify } from "../services/notify";
import { taskVisibilityWhere as taskVisibility, canEditTask as canEdit } from "../services/taskAccess";
import { broadcast } from "../realtime";

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

    if (req.query.mine === "true") {
      filters.push({
        OR: [
          { primaryLeadId: req.user!.id },
          { secondaryLeadId: req.user!.id },
          { currentlyWithId: req.user!.id },
        ],
      });
    }

    const tasks = await prisma.task.findMany({
      where: { AND: filters },
      include: leadInclude,
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
    });
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
        comments: { include: { author: { select: { id: true, fullName: true } } }, orderBy: { createdAt: "asc" } },
        attachments: true,
        createdBy: { select: { id: true, fullName: true } },
      },
    });
    if (!task) throw new HttpError(404, "Task not found or not visible to you");
    broadcast("task:changed", { taskId: task.id });
    res.json(task);
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

    const task = await prisma.task.update({ where: { id: existing.id }, data, include: leadInclude });
    await prisma.activityLog.create({
      data: { taskId: task.id, actorId: req.user!.id, action: "updated", detail: JSON.parse(JSON.stringify(data)) as Prisma.InputJsonValue },
    });
    res.json(task);
  })
);

// POST /api/tasks/:id/comments  -  add a remark (Director direction, lead note, etc.)
const commentSchema = z.object({ body: z.string().min(1), authorRole: z.string().optional() });
taskRouter.post(
  "/:id/comments",
  asyncHandler(async (req, res) => {
    const task = await prisma.task.findFirst({ where: { AND: [{ id: req.params.id }, taskVisibility(req.user!)] } });
    if (!task) throw new HttpError(404, "Task not found or not visible to you");
    const { body, authorRole } = commentSchema.parse(req.body);
    const comment = await prisma.taskComment.create({
      data: { taskId: task.id, authorId: req.user!.id, authorRole, body },
      include: { author: { select: { id: true, fullName: true } } },
    });
    res.status(201).json(comment);
  })
);

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

    await notify({
      userId: office.headId,
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
      select: { id: true, officeId: true },
    });
    if (!task) throw new HttpError(404, "Task not found or not visible to you");
    const people = await prisma.user.findMany({
      where: {
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
function canDelete(user: NonNullable<import("express").Request["user"]>, task: { createdById: string | null; primaryLeadId: string | null; officeId: string | null }): boolean {
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
