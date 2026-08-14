import { Router, Request } from "express";
import { z } from "zod";
import { Prisma, RequestState, RequestScope } from "@prisma/client";
import { prisma } from "../prisma";
import { asyncHandler, HttpError } from "../utils/http";
import { authenticate, isGlobalAdmin } from "../middleware/auth";
import { notify } from "../services/notify";
import { broadcast } from "../realtime";

export const assignmentRouter = Router();
assignmentRouter.use(authenticate);

type ReqUser = NonNullable<Request["user"]>;

const include = {
  task: { select: { id: true, title: true, owningOfficeId: true, executingOfficeId: true, dueDate: true, priority: true } },
  from: { select: { id: true, fullName: true, designation: { select: { id: true, name: true, code: true, rank: true } }, office: { select: { id: true, name: true } } } },
  to: { select: { id: true, fullName: true, designation: true } },
  toDepartment: { select: { id: true, name: true, headId: true } },
  toOffice: { select: { id: true, name: true, code: true, headId: true } },
  approvedBy: { select: { id: true, fullName: true } },
} as const;

async function loadAssignment(id: string) {
  const a = await prisma.taskRequest.findUnique({ where: { id }, include });
  if (!a) throw new HttpError(404, "Assignment not found");
  return a;
}

/**
 * Who may decide on an incoming request?
 *   - OFFICE scope: the head of the target office (a DG/PAG/DAG or other IAAS
 *     officer), or anyone in that office holding "office.approve". If the
 *     office has NO head appointed yet, its Office Admin decides instead, so a
 *     request from another office is never left with nobody to answer it.
 *   - DEPARTMENT scope: the head of the target department, or a global approver.
 */
function isApprover(user: ReqUser, a: { scope: RequestScope; toOffice?: { id: string; headId: string | null } | null; toDepartment?: { headId: string | null } | null }): boolean {
  if (isGlobalAdmin(user)) return true;
  if (a.scope === RequestScope.OFFICE) {
    const officeId = a.toOffice?.id;
    if (!officeId) return false;
    if (a.toOffice?.headId === user.id) return true;
    if (user.headsOfficeIds.includes(officeId)) return true;
    if (user.officeId === officeId && user.permissions.includes("office.approve")) return true;
    // Fallback: no head appointed, so the office admin answers for the office.
    return a.toOffice?.headId === null && user.officeId === officeId && user.permissions.includes("staff.manage");
  }
  return user.permissions.includes("task.approve") || (!!a.toDepartment?.headId && a.toDepartment.headId === user.id);
}

async function log(taskId: string, actorId: string, action: string, detail?: Record<string, unknown>) {
  await prisma.activityLog.create({ data: { taskId, actorId, action, detail: (detail ?? {}) as Prisma.InputJsonValue } });
}

// GET /api/assignments/pending-approvals  -  everything awaiting MY decision,
// both cross-department requests and requests from other offices.
assignmentRouter.get(
  "/pending-approvals",
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const clauses: Prisma.TaskRequestWhereInput[] = [];

    if (user.permissions.includes("task.approve")) clauses.push({ scope: RequestScope.DEPARTMENT });
    clauses.push({ scope: RequestScope.DEPARTMENT, toDepartment: { headId: user.id } });

    // Office requests land with the head of the target office.
    if (user.headsOfficeIds.length) clauses.push({ scope: RequestScope.OFFICE, toOfficeId: { in: user.headsOfficeIds } });
    if (user.officeId && user.permissions.includes("office.approve")) {
      clauses.push({ scope: RequestScope.OFFICE, toOfficeId: user.officeId });
    }
    // Same fallback as isApprover: while an office has no head, its admin sees
    // the incoming requests, otherwise they would sit in nobody's queue.
    if (user.officeId && user.permissions.includes("staff.manage")) {
      clauses.push({ scope: RequestScope.OFFICE, toOfficeId: user.officeId, toOffice: { headId: null } });
    }

    const items = await prisma.taskRequest.findMany({
      where: {
        state: RequestState.PENDING_APPROVAL,
        ...(isGlobalAdmin(user) ? {} : { OR: clauses.length ? clauses : [{ id: "__none__" }] }),
      },
      include,
      orderBy: { createdAt: "desc" },
    });
    res.json(items);
  })
);

// GET /api/assignments/office-inbox  -  work other offices have asked MY office to take on
assignmentRouter.get(
  "/office-inbox",
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const officeIds = [...new Set([...user.headsOfficeIds, ...(user.officeId ? [user.officeId] : [])])];
    if (!officeIds.length) return res.json([]);
    const items = await prisma.taskRequest.findMany({
      where: { scope: RequestScope.OFFICE, toOfficeId: { in: officeIds } },
      include,
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    res.json(items);
  })
);

// GET /api/assignments/office-outbox  -  requests MY office has sent to others
assignmentRouter.get(
  "/office-outbox",
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const items = await prisma.taskRequest.findMany({
      where: {
        scope: RequestScope.OFFICE,
        ...(isGlobalAdmin(user) ? {} : { from: { officeId: user.officeId ?? "__none__" } }),
      },
      include,
      orderBy: { createdAt: "desc" },
      take: 200,
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

const approveSchema = z.object({
  /**
   * Required for OFFICE-scope requests: the staff member in the approving
   * office who will actually carry the work out. This is the step where the
   * receiving head nominates one of their own people.
   */
  assigneeId: z.string().optional(),
  departmentId: z.string().optional(),
  note: z.string().optional(),
});

// POST /api/assignments/:id/approve
assignmentRouter.post(
  "/:id/approve",
  asyncHandler(async (req, res) => {
    const a = await loadAssignment(req.params.id);
    if (a.state !== RequestState.PENDING_APPROVAL) throw new HttpError(400, "This assignment is not awaiting approval");
    if (!isApprover(req.user!, a)) throw new HttpError(403, "Only the head of the receiving office or department can decide this");

    const body = approveSchema.parse(req.body ?? {});
    let assigneeId = a.toId;
    let departmentId = a.toDepartmentId;

    if (a.scope === RequestScope.OFFICE) {
      if (!body.assigneeId) throw new HttpError(400, "Nominate a member of your office to carry out this work");
      const assignee = await prisma.user.findUnique({
        where: { id: body.assigneeId },
        select: { id: true, fullName: true, officeId: true, departmentId: true, isActive: true },
      });
      if (!assignee) throw new HttpError(404, "That staff member does not exist");
      if (assignee.officeId !== a.toOfficeId) throw new HttpError(400, "You can only nominate someone from your own office");
      if (!assignee.isActive) throw new HttpError(400, "That account is deactivated");
      assigneeId = assignee.id;
      departmentId = body.departmentId ?? assignee.departmentId;
    }

    const updated = await prisma.taskRequest.update({
      where: { id: a.id },
      data: { state: RequestState.PENDING_ACCEPTANCE, approvedById: req.user!.id, toId: assigneeId, toDepartmentId: departmentId },
      include,
    });

    // The EXECUTING office changes; the owning office does not. Office A stays
    // accountable for work it delegated, so the item never drops out of A's
    // reports just because B is carrying it out.
    await prisma.task.update({
      where: { id: a.taskId },
      data: {
        currentlyWithId: assigneeId,
        departmentId,
        ...(a.scope === RequestScope.OFFICE ? { executingOfficeId: a.toOfficeId } : {}),
      },
    });

    await log(a.taskId, req.user!.id, a.scope === RequestScope.OFFICE ? "office_request_accepted" : "assignment_approved", {
      to: updated.to?.fullName,
      office: a.toOffice?.name,
      note: body.note,
    });

    await notify({
      userId: assigneeId,
      kind: "approved",
      title: `Work assigned to you: ${a.task?.title}`,
      body: `${req.user!.fullName} nominated you for work received from ${a.from?.office?.name ?? "another office"}. Please accept it.`,
      taskId: a.taskId,
    });
    await notify({
      userId: a.fromId,
      kind: "approved",
      title: `Request accepted: ${a.task?.title}`,
      body: `${a.toOffice?.name ?? "The receiving office"} accepted your request and assigned ${updated.to?.fullName ?? "a staff member"}.`,
      taskId: a.taskId,
    });
    broadcast("task:changed", { taskId: a.taskId });
    res.json(updated);
  })
);

const rejectSchema = z.object({ reason: z.string().optional() });

// POST /api/assignments/:id/reject
assignmentRouter.post(
  "/:id/reject",
  asyncHandler(async (req, res) => {
    const a = await loadAssignment(req.params.id);
    if (a.state !== RequestState.PENDING_APPROVAL) throw new HttpError(400, "This assignment is not awaiting approval");
    if (!isApprover(req.user!, a)) throw new HttpError(403, "Only the head of the receiving office or department can decide this");

    const { reason } = rejectSchema.parse(req.body ?? {});
    const updated = await prisma.taskRequest.update({
      where: { id: a.id },
      data: { state: RequestState.REJECTED, approvedById: req.user!.id, resolvedAt: new Date() },
      include,
    });
    await log(a.taskId, req.user!.id, a.scope === RequestScope.OFFICE ? "office_request_rejected" : "assignment_rejected", { reason });
    await notify({
      userId: a.fromId,
      kind: "rejected",
      title: `Request rejected: ${a.task?.title}`,
      body: reason
        ? `${a.toOffice?.name ?? a.toDepartment?.name ?? "The receiving head"} rejected this: ${reason}`
        : `${a.toOffice?.name ?? a.toDepartment?.name ?? "The receiving head"} rejected this request.`,
      taskId: a.taskId,
    });
    broadcast("task:changed", { taskId: a.taskId });
    res.json(updated);
  })
);

// POST /api/assignments/:id/accept  -  the nominated person takes the work
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
    // An office request goes back to that office's head to re-nominate; a
    // direct assignment goes back to whoever assigned it.
    const fallbackHolder = a.scope === RequestScope.OFFICE ? a.toOffice?.headId ?? a.fromId : a.fromId;
    if (fallbackHolder) await prisma.task.update({ where: { id: a.taskId }, data: { currentlyWithId: fallbackHolder } });
    await log(a.taskId, req.user!.id, "assignment_declined");
    await notify({ userId: fallbackHolder, kind: "declined", title: `Assignment declined: ${a.task?.title}`, body: `${a.to?.fullName ?? "The assignee"} declined; the work came back to you.`, taskId: a.taskId });
    broadcast("task:changed", { taskId: a.taskId });
    res.json(updated);
  })
);

// POST /api/assignments/:id/cancel  -  the requester withdraws a pending request
assignmentRouter.post(
  "/:id/cancel",
  asyncHandler(async (req, res) => {
    const a = await loadAssignment(req.params.id);
    const pending = a.state === RequestState.PENDING_APPROVAL || a.state === RequestState.PENDING_ACCEPTANCE;
    if (!pending) throw new HttpError(400, "Only a pending assignment can be cancelled");
    const allowed = a.fromId === req.user!.id || req.user!.permissions.includes("task.approve") || isGlobalAdmin(req.user!);
    if (!allowed) throw new HttpError(403, "Only the requester can cancel this");

    const updated = await prisma.taskRequest.update({
      where: { id: a.id },
      data: { state: RequestState.CANCELLED, resolvedAt: new Date() },
      include,
    });
    if (a.state === RequestState.PENDING_ACCEPTANCE && a.fromId) {
      await prisma.task.update({ where: { id: a.taskId }, data: { currentlyWithId: a.fromId } });
    }
    await log(a.taskId, req.user!.id, "assignment_cancelled");
    await notify({ userId: a.toId ?? a.toOffice?.headId, kind: "cancelled", title: `Assignment cancelled: ${a.task?.title}`, body: `${a.from?.fullName ?? "The requester"} cancelled this assignment.`, taskId: a.taskId });
    broadcast("task:changed", { taskId: a.taskId });
    res.json(updated);
  })
);
