import { Router, Request } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { asyncHandler } from "../utils/http";
import { authenticate, isGlobalAdmin } from "../middleware/auth";
import { taskVisibilityWhere } from "../services/taskAccess";
import { VISIBLE } from "../services/accountLifecycle";

export const searchRouter = Router();
searchRouter.use(authenticate);

type ReqUser = NonNullable<Request["user"]>;

function meetingVisibility(user: ReqUser): Prisma.MeetingWhereInput {
  if (user.permissions.includes("task.view_all")) return {};
  return { OR: [{ createdById: user.id }, { participants: { some: { userId: user.id } } }] };
}

// GET /api/search?q=...  -  grouped results, each scoped to what the user may see
searchRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? "").trim();
    if (q.length < 2) {
      return res.json({ tasks: [], people: [], teams: [], meetings: [] });
    }

    // People and teams are office-local. Use the office register if you need to
    // find another office; you still cannot assign to them directly.
    const officeScope = isGlobalAdmin(req.user!) ? {} : { officeId: req.user!.officeId ?? "__none__" };

    const [tasks, people, projects, meetings] = await Promise.all([
      prisma.task.findMany({
        where: { AND: [taskVisibilityWhere(req.user!), { OR: [{ title: { contains: q } }, { description: { contains: q } }] }] },
        select: { id: true, title: true, status: true },
        take: 8,
      }),
      prisma.user.findMany({
        where: {
          ...VISIBLE,
          ...officeScope,
          ...(isGlobalAdmin(req.user!) ? {} : { isActive: true }),
          OR: [{ fullName: { contains: q } }, { email: { contains: q } }, { designation: { name: { contains: q } } }],
        },
        select: {
          id: true,
          fullName: true,
          designation: { select: { id: true, name: true, code: true, rank: true } },
          email: true,
        },
        take: 8,
      }),
      prisma.project.findMany({ where: { ...officeScope, archivedAt: null, name: { contains: q } }, select: { id: true, name: true }, take: 6 }),
      prisma.meeting.findMany({
        where: { AND: [meetingVisibility(req.user!), { title: { contains: q } }] },
        select: { id: true, title: true, startsAt: true },
        take: 6,
      }),
    ]);

    res.json({ tasks, people, projects, meetings });
  })
);
