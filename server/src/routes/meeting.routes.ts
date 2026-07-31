import { Router, Request } from "express";
import { z } from "zod";
import { Prisma, MeetingMode } from "@prisma/client";
import { prisma } from "../prisma";
import { asyncHandler, HttpError } from "../utils/http";
import { authenticate } from "../middleware/auth";
import { notify } from "../services/notify";
import { buildICS } from "../utils/ics";

export const meetingRouter = Router();
meetingRouter.use(authenticate);

type ReqUser = NonNullable<Request["user"]>;

/** Meetings are visible to their creator and participants (admins see all). */
function meetingVisibility(user: ReqUser): Prisma.MeetingWhereInput {
  if (user.permissions.includes("task.view_all")) return {};
  return { OR: [{ createdById: user.id }, { participants: { some: { userId: user.id } } }] };
}

const detail = {
  createdBy: { select: { id: true, fullName: true } },
  task: { select: { id: true, title: true } },
  team: { select: { id: true, name: true } },
  participants: { include: { user: { select: { id: true, fullName: true } } } },
} as const;

function canManage(user: ReqUser, meeting: { createdById: string | null }): boolean {
  return meeting.createdById === user.id || user.permissions.includes("task.view_all");
}

// GET /api/meetings?all=true  -  upcoming by default
meetingRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const showAll = req.query.all === "true";
    const meetings = await prisma.meeting.findMany({
      where: {
        AND: [meetingVisibility(req.user!), showAll ? {} : { startsAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } }],
      },
      include: detail,
      orderBy: { startsAt: "asc" },
    });
    res.json(meetings);
  })
);

const createSchema = z.object({
  title: z.string().min(2),
  agenda: z.string().optional(),
  startsAt: z.coerce.date(),
  mode: z.nativeEnum(MeetingMode).optional(),
  location: z.string().optional(),
  taskId: z.string().optional(),
  teamId: z.string().optional(),
  participantIds: z.array(z.string()).optional(),
});

// POST /api/meetings
meetingRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body);
    const ids = Array.from(new Set([...(data.participantIds ?? []), req.user!.id]));

    const meeting = await prisma.meeting.create({
      data: {
        title: data.title,
        agenda: data.agenda,
        startsAt: data.startsAt,
        mode: data.mode ?? MeetingMode.PHYSICAL,
        location: data.location,
        taskId: data.taskId,
        teamId: data.teamId,
        createdById: req.user!.id,
        participants: { create: ids.map((userId) => ({ userId })) },
      },
      include: detail,
    });

    const when = data.startsAt.toLocaleString();
    for (const uid of ids) {
      if (uid === req.user!.id) continue;
      await notify({
        userId: uid,
        kind: "meeting_invite",
        title: `Meeting: ${data.title}`,
        body: `${when} (${(data.mode ?? MeetingMode.PHYSICAL).toLowerCase()})${data.location ? " - " + data.location : ""}`,
        taskId: data.taskId ?? null,
      });
    }
    res.status(201).json(meeting);
  })
);

// GET /api/meetings/:id
meetingRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const meeting = await prisma.meeting.findFirst({
      where: { AND: [{ id: req.params.id }, meetingVisibility(req.user!)] },
      include: detail,
    });
    if (!meeting) throw new HttpError(404, "Meeting not found or not visible to you");
    res.json(meeting);
  })
);

const updateSchema = createSchema.partial().omit({ participantIds: true });

// PATCH /api/meetings/:id  -  creator or admin
meetingRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const meeting = await prisma.meeting.findUnique({ where: { id: req.params.id }, select: { id: true, createdById: true } });
    if (!meeting) throw new HttpError(404, "Meeting not found");
    if (!canManage(req.user!, meeting)) throw new HttpError(403, "Only the organiser can edit this meeting");
    const data = updateSchema.parse(req.body);
    const updated = await prisma.meeting.update({ where: { id: meeting.id }, data, include: detail });
    res.json(updated);
  })
);

// DELETE /api/meetings/:id
meetingRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const meeting = await prisma.meeting.findUnique({ where: { id: req.params.id }, select: { id: true, createdById: true } });
    if (!meeting) throw new HttpError(404, "Meeting not found");
    if (!canManage(req.user!, meeting)) throw new HttpError(403, "Only the organiser can delete this meeting");
    await prisma.meeting.delete({ where: { id: meeting.id } });
    res.status(204).end();
  })
);

const partSchema = z.object({ userId: z.string() });

// POST /api/meetings/:id/participants
meetingRouter.post(
  "/:id/participants",
  asyncHandler(async (req, res) => {
    const meeting = await prisma.meeting.findUnique({ where: { id: req.params.id }, select: { id: true, createdById: true, title: true, startsAt: true, taskId: true } });
    if (!meeting) throw new HttpError(404, "Meeting not found");
    if (!canManage(req.user!, meeting)) throw new HttpError(403, "Only the organiser can add participants");
    const { userId } = partSchema.parse(req.body);
    await prisma.meetingParticipant.upsert({
      where: { meetingId_userId: { meetingId: meeting.id, userId } },
      update: {},
      create: { meetingId: meeting.id, userId },
    });
    await notify({
      userId,
      kind: "meeting_invite",
      title: `Meeting: ${meeting.title}`,
      body: `${meeting.startsAt.toLocaleString()}`,
      taskId: meeting.taskId ?? null,
    });
    res.status(201).json({ ok: true });
  })
);

// DELETE /api/meetings/:id/participants/:userId
meetingRouter.delete(
  "/:id/participants/:userId",
  asyncHandler(async (req, res) => {
    const meeting = await prisma.meeting.findUnique({ where: { id: req.params.id }, select: { id: true, createdById: true } });
    if (!meeting) throw new HttpError(404, "Meeting not found");
    if (!canManage(req.user!, meeting)) throw new HttpError(403, "Only the organiser can remove participants");
    await prisma.meetingParticipant.deleteMany({ where: { meetingId: meeting.id, userId: req.params.userId } });
    res.status(204).end();
  })
);

// GET /api/meetings/:id/ics  -  download a calendar invite
meetingRouter.get(
  "/:id/ics",
  asyncHandler(async (req, res) => {
    const meeting = await prisma.meeting.findFirst({
      where: { AND: [{ id: req.params.id }, meetingVisibility(req.user!)] },
      select: { id: true, title: true, agenda: true, location: true, startsAt: true },
    });
    if (!meeting) throw new HttpError(404, "Meeting not found or not visible to you");
    const ics = buildICS(meeting);
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="meeting.ics"');
    res.send(ics);
  })
);
