import { Router, Request } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { asyncHandler } from "../utils/http";
import { authenticate } from "../middleware/auth";
import { taskVisibilityWhere } from "../services/taskAccess";

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

    const [tasks, people, teams, meetings] = await Promise.all([
      prisma.task.findMany({
        where: { AND: [taskVisibilityWhere(req.user!), { OR: [{ title: { contains: q } }, { description: { contains: q } }] }] },
        select: { id: true, title: true, status: true },
        take: 8,
      }),
      prisma.user.findMany({
        where: { OR: [{ fullName: { contains: q } }, { email: { contains: q } }, { designation: { contains: q } }] },
        select: { id: true, fullName: true, designation: true, email: true },
        take: 8,
      }),
      prisma.team.findMany({ where: { name: { contains: q } }, select: { id: true, name: true }, take: 6 }),
      prisma.meeting.findMany({
        where: { AND: [meetingVisibility(req.user!), { title: { contains: q } }] },
        select: { id: true, title: true, startsAt: true },
        take: 6,
      }),
    ]);

    res.json({ tasks, people, teams, meetings });
  })
);
