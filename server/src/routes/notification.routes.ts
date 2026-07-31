import { Router } from "express";
import { prisma } from "../prisma";
import { asyncHandler } from "../utils/http";
import { authenticate } from "../middleware/auth";

export const notificationRouter = Router();
notificationRouter.use(authenticate);

// GET /api/notifications  -  my recent notifications (unread first)
notificationRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const items = await prisma.notification.findMany({
      where: { userId: req.user!.id },
      orderBy: [{ isRead: "asc" }, { createdAt: "desc" }],
      take: 50,
    });
    res.json(items);
  })
);

// GET /api/notifications/unread-count
notificationRouter.get(
  "/unread-count",
  asyncHandler(async (req, res) => {
    const count = await prisma.notification.count({ where: { userId: req.user!.id, isRead: false } });
    res.json({ count });
  })
);

// PATCH /api/notifications/:id/read
notificationRouter.patch(
  "/:id/read",
  asyncHandler(async (req, res) => {
    await prisma.notification.updateMany({
      where: { id: req.params.id, userId: req.user!.id },
      data: { isRead: true },
    });
    res.status(204).end();
  })
);

// POST /api/notifications/read-all
notificationRouter.post(
  "/read-all",
  asyncHandler(async (req, res) => {
    await prisma.notification.updateMany({ where: { userId: req.user!.id, isRead: false }, data: { isRead: true } });
    res.status(204).end();
  })
);
