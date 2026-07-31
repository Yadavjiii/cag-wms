import { Router } from "express";
import { prisma } from "../prisma";
import { asyncHandler } from "../utils/http";
import { authenticate, requirePermission } from "../middleware/auth";
import { taskVisibilityWhere } from "../services/taskAccess";

export const reportRouter = Router();
reportRouter.use(authenticate);

const DAY = 24 * 60 * 60 * 1000;

// GET /api/reports/summary  -  metrics over the tasks this user may see
reportRouter.get(
  "/summary",
  requirePermission("report.view"),
  asyncHandler(async (req, res) => {
    const tasks = await prisma.task.findMany({
      where: taskVisibilityWhere(req.user!),
      select: {
        status: true,
        dueDate: true,
        primaryLead: { select: { fullName: true } },
        department: { select: { name: true } },
      },
    });

    const now = Date.now();
    const byStatus: Record<string, number> = {};
    const byLead: Record<string, { active: number; overdue: number }> = {};
    const byDepartment: Record<string, number> = {};
    let finished = 0;
    let overdue = 0;
    let dueSoon = 0;

    for (const t of tasks) {
      byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
      const isFinished = t.status === "FINISHED";
      if (isFinished) finished++;

      if (!isFinished) {
        const lead = t.primaryLead?.fullName ?? "Unassigned";
        byLead[lead] = byLead[lead] ?? { active: 0, overdue: 0 };
        byLead[lead].active++;

        const dept = t.department?.name ?? "No department";
        byDepartment[dept] = (byDepartment[dept] ?? 0) + 1;

        if (t.dueDate) {
          const diff = t.dueDate.getTime() - now;
          if (diff < 0) {
            overdue++;
            byLead[lead].overdue++;
          } else if (diff <= 3 * DAY) {
            dueSoon++;
          }
        }
      }
    }

    res.json({
      totals: { total: tasks.length, active: tasks.length - finished, finished, overdue, dueSoon },
      byStatus: Object.entries(byStatus).map(([status, count]) => ({ status, count })),
      byLead: Object.entries(byLead)
        .map(([name, v]) => ({ name, ...v }))
        .sort((a, b) => b.active - a.active)
        .slice(0, 15),
      byDepartment: Object.entries(byDepartment)
        .map(([name, active]) => ({ name, active }))
        .sort((a, b) => b.active - a.active),
    });
  })
);

// GET /api/reports/activity  -  recent audit-log entries across visible tasks
reportRouter.get(
  "/activity",
  asyncHandler(async (req, res) => {
    const entries = await prisma.activityLog.findMany({
      where: { task: taskVisibilityWhere(req.user!) },
      include: { actor: { select: { id: true, fullName: true } }, task: { select: { id: true, title: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    res.json(entries);
  })
);
