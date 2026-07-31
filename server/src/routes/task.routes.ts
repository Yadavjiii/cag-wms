import { Router, Request } from "express";
import { z } from "zod";
import { Prisma, TaskStatus, TaskPriority, RequestState } from "@prisma/client";
import { prisma } from "../prisma";
import { asyncHandler, HttpError } from "../utils/http";
import { authenticate } from "../middleware/auth";
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
  team: { select: { id: true, name: true } },
} as const;

// GET /api/tasks?status=&teamId=&mine=true
taskRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const filters: Prisma.TaskWhereInput[] = [taskVisibility(req.user!)];

    const status = req.query.status as string | undefined;
    if (status && status in TaskStatus) filters.push({ status: status as TaskStatus });

    const teamId = req.query.teamId as string | undefined;
    if (teamId) filters.push({ teamId });

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
  teamId: z.string().optional(),
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
        officeId: req.user!.officeId,
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
