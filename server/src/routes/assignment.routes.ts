import { Router, Request } from "express";
import { Prisma, RequestState } from "@prisma/client";
import { prisma } from "../prisma";
import { asyncHandler, HttpError } from "../utils/http";
import { authenticate } from "../middleware/auth";
import { notify } from "../services/notify";
import { broadcast } from "../realtime";

export const assignmentRouter = Router();
assignmentRouter.use(authenticate);

type ReqUser = NonNullable<Request["user"]>;

const include = {
  task: { select: { id: true, title: true } },
  from: { select: { id: true, fullName: true } },
  to: { select: { id: true, fullName: true } },
  toDepartment: { select: { id: true, name: true, headId: true } },
} as const;

async function loadAssignment(id: string) {
  const a = await prisma.taskRequest.findUnique({ where: { id }, include });
  if (!a) throw new HttpError(404, "Assignment not found");
  return a;
}

function isApprover(user: ReqUser, headId: string | null | undefined): boolean {
  return user.permissions.includes("task.approve") || (!!headId && headId === user.id);
}

async function log(taskId: string, actorId: string, action: string, detail?: Record<string, unknown>) {
  await prisma.activityLog.create({ data: { taskId, actorId, action, detail: (detail ?? {}) as Prisma.InputJsonValue } });
}

// GET /api/assignments/pending-approvals  -  incoming work awaiting MY approval
assignmentRouter.get(
  "/pending-approvals",
  asyncHandler(async (req, res) => {
    const canApproveAll = req.user!.permissions.includes("task.approve");
    const items = await prisma.taskRequest.findMany({
      where: {
        state: RequestState.PENDING_APPROVAL,
        ...(canApproveAll ? {} : { toDepartment: { headId: req.user!.id } }),
      },
      include,
      orderBy: { createdAt: "desc" },
    });
    res.json(items);
  })
);

// GET /api/assignments/my-inbox  -  work assigned to me awaiting my acceptance
assignmentRouter.get(
  "/my-inbox",
  asyncHandler(async (req, res) => {
    const items = await prisma.taskRequest.findMany({
      where: { toId: req.user!.id, state: RequestState.PENDING_ACCEPTANCE },
      include,
      orderBy: { createdAt: "desc" },
    });
    res.json(items);
  })
);

// POST /api/assignments/:id/approve  -  department head accepts incoming work
assignmentRouter.post(
  "/:id/approve",
  asyncHandler(async (req, res) => {
    const a = await loadAssignment(req.params.id);
    if (a.state !== RequestState.PENDING_APPROVAL) throw new HttpError(400, "This assignment is not awaiting approval");
    if (!isApprover(req.user!, a.toDepartment?.headId)) throw new HttpError(403, "Only the target department head can approve");

    const updated = await prisma.taskRequest.update({
      where: { id: a.id },
      data: { state: RequestState.PENDING_ACCEPTANCE, approvedById: req.user!.id },
      include,
    });
    // The work now moves to the assignee and into the target department.
    await prisma.task.update({
      where: { id: a.taskId },
      data: { currentlyWithId: a.toId, departmentId: a.toDepartmentId },
    });
    await log(a.taskId, req.user!.id, "assignment_approved", { to: a.to?.fullName });
    await notify({ userId: a.toId, kind: "approved", title: `Work approved: ${a.task?.title}`, body: "Incoming work was approved by the department head. Please accept it.", taskId: a.taskId });
    await notify({ userId: a.fromId, kind: "approved", title: `Assignment approved: ${a.task?.title}`, body: `${a.to?.fullName ?? "The assignee"}'s department head approved your assignment.`, taskId: a.taskId });
    broadcast("task:changed", { taskId: a.taskId });
    res.json(updated);
  })
);

// POST /api/assignments/:id/reject  -  department head refuses incoming work
assignmentRouter.post(
  "/:id/reject",
  asyncHandler(async (req, res) => {
    const a = await loadAssignment(req.params.id);
    if (a.state !== RequestState.PENDING_APPROVAL) throw new HttpError(400, "This assignment is not awaiting approval");
    if (!isApprover(req.user!, a.toDepartment?.headId)) throw new HttpError(403, "Only the target department head can reject");

    const updated = await prisma.taskRequest.update({
      where: { id: a.id },
      data: { state: RequestState.REJECTED, approvedById: req.user!.id, resolvedAt: new Date() },
      include,
    });
    await log(a.taskId, req.user!.id, "assignment_rejected", { to: a.to?.fullName });
    await notify({ userId: a.fromId, kind: "rejected", title: `Assignment rejected: ${a.task?.title}`, body: "The target department head rejected this assignment.", taskId: a.taskId });
    broadcast("task:changed", { taskId: a.taskId });
    res.json(updated);
  })
);

// POST /api/assignments/:id/accept  -  the assignee takes the work
assignmentRouter.post(
  "/:id/accept",
  asyncHandler(async (req, res) => {
    const a = await loadAssignment(req.params.id);
    if (a.state !== RequestState.PENDING_ACCEPTANCE) throw new HttpError(400, "This assignment is not awaiting acceptance");
    if (a.toId !== req.user!.id) throw new HttpError(403, "Only the assignee can accept");

    const updated = await prisma.taskRequest.update({
      where: { id: a.id },
      data: { state: RequestState.ACCEPTED, resolvedAt: new Date() },
      include,
    });
    await prisma.task.update({ where: { id: a.taskId }, data: { currentlyWithId: a.toId } });
    await log(a.taskId, req.user!.id, "assignment_accepted");
    await notify({ userId: a.fromId, kind: "accepted", title: `Assignment accepted: ${a.task?.title}`, body: `${a.to?.fullName ?? "The assignee"} accepted the work.`, taskId: a.taskId });
    broadcast("task:changed", { taskId: a.taskId });
    res.json(updated);
  })
);

// POST /api/assignments/:id/decline  -  the assignee sends it back
assignmentRouter.post(
  "/:id/decline",
  asyncHandler(async (req, res) => {
    const a = await loadAssignment(req.params.id);
    if (a.state !== RequestState.PENDING_ACCEPTANCE) throw new HttpError(400, "This assignment is not awaiting acceptance");
    if (a.toId !== req.user!.id) throw new HttpError(403, "Only the assignee can decline");

    const updated = await prisma.taskRequest.update({
      where: { id: a.id },
      data: { state: RequestState.DECLINED, resolvedAt: new Date() },
      include,
    });
    // Send the work item back to whoever assigned it.
    if (a.fromId) await prisma.task.update({ where: { id: a.taskId }, data: { currentlyWithId: a.fromId } });
    await log(a.taskId, req.user!.id, "assignment_declined");
    await notify({ userId: a.fromId, kind: "declined", title: `Assignment declined: ${a.task?.title}`, body: `${a.to?.fullName ?? "The assignee"} declined; the work came back to you.`, taskId: a.taskId });
    broadcast("task:changed", { taskId: a.taskId });
    res.json(updated);
  })
);

// POST /api/assignments/:id/cancel  -  the assigner withdraws a pending assignment
assignmentRouter.post(
  "/:id/cancel",
  asyncHandler(async (req, res) => {
    const a = await loadAssignment(req.params.id);
    const pending = a.state === RequestState.PENDING_APPROVAL || a.state === RequestState.PENDING_ACCEPTANCE;
    if (!pending) throw new HttpError(400, "Only a pending assignment can be cancelled");
    const allowed = a.fromId === req.user!.id || req.user!.permissions.includes("task.approve");
    if (!allowed) throw new HttpError(403, "Only the assigner can cancel this");

    const updated = await prisma.taskRequest.update({
      where: { id: a.id },
      data: { state: RequestState.CANCELLED, resolvedAt: new Date() },
      include,
    });
    // If it had already landed on the assignee's desk, hand it back.
    if (a.state === RequestState.PENDING_ACCEPTANCE && a.fromId) {
      await prisma.task.update({ where: { id: a.taskId }, data: { currentlyWithId: a.fromId } });
    }
    await log(a.taskId, req.user!.id, "assignment_cancelled");
    await notify({ userId: a.toId, kind: "cancelled", title: `Assignment cancelled: ${a.task?.title}`, body: `${a.from?.fullName ?? "The assigner"} cancelled this assignment.`, taskId: a.taskId });
    broadcast("task:changed", { taskId: a.taskId });
    res.json(updated);
  })
);
