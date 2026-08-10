import { Router } from "express";
import { prisma } from "../prisma";
import { asyncHandler } from "../utils/http";
import { authenticate } from "../middleware/auth";
import { taskVisibilityWhere } from "../services/taskAccess";

/**
 * One feed of everything with a date on it, so the calendar does not have to
 * stitch together three separate endpoints. Returns work item due dates,
 * project due dates and meetings, all filtered by what the caller may see.
 */
export const calendarRouter = Router();
calendarRouter.use(authenticate);

export interface CalendarEvent {
  id: string;
  kind: "task" | "project" | "meeting";
  title: string;
  start: Date;
  end?: Date | null;
  status?: string | null;
  priority?: string | null;
  url: string;
  meta?: string | null;
}

// GET /api/calendar?from=ISO&to=ISO
calendarRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const now = new Date();
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to = req.query.to ? new Date(String(req.query.to)) : new Date(now.getFullYear(), now.getMonth() + 2, 0);

    const [tasks, projects, meetings] = await Promise.all([
      prisma.task.findMany({
        where: {
          AND: [taskVisibilityWhere(req.user!), { archivedAt: null }, { dueDate: { gte: from, lte: to } }],
        },
        select: {
          id: true,
          title: true,
          dueDate: true,
          status: true,
          priority: true,
          pctComplete: true,
          currentlyWith: { select: { fullName: true } },
        },
      }),
      prisma.project.findMany({
        where: {
          archivedAt: null,
          dueDate: { gte: from, lte: to },
          OR: [
            { members: { some: { userId: req.user!.id } } },
            ...(req.user!.officeId ? [{ officeId: req.user!.officeId }] : []),
          ],
        },
        select: { id: true, name: true, dueDate: true, status: true },
      }),
      prisma.meeting.findMany({
        where: {
          startsAt: { gte: from, lte: to },
          OR: [{ createdById: req.user!.id }, { participants: { some: { userId: req.user!.id } } }],
        },
        select: { id: true, title: true, startsAt: true, mode: true, location: true },
      }),
    ]);

    const events: CalendarEvent[] = [
      ...tasks.map((t) => ({
        id: t.id,
        kind: "task" as const,
        title: t.title,
        start: t.dueDate!,
        status: t.status,
        priority: t.priority,
        url: `/tasks/${t.id}`,
        meta: t.currentlyWith ? `with ${t.currentlyWith.fullName}` : null,
      })),
      ...projects.map((p) => ({
        id: p.id,
        kind: "project" as const,
        title: p.name,
        start: p.dueDate!,
        status: p.status,
        url: `/projects/${p.id}`,
        meta: "project deadline",
      })),
      ...meetings.map((m) => ({
        id: m.id,
        kind: "meeting" as const,
        title: m.title,
        start: m.startsAt,
        url: `/meetings`,
        meta: m.location ?? (m.mode === "ONLINE" ? "online" : null),
      })),
    ].sort((a, b) => a.start.getTime() - b.start.getTime());

    res.json(events);
  })
);
