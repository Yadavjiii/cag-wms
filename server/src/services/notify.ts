import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { config } from "../config";
import { sendMail } from "../email/mailer";
import { renderEmail } from "../email/templates";
import { emitToUser } from "../realtime";

interface NotifyInput {
  userId?: string | null;
  kind: string;         // assigned | approval_request | approved | rejected | accepted | declined | cancelled | due_soon | overdue
  title: string;
  body?: string;
  taskId?: string | null;
  sendEmail?: boolean;  // overrides the EMAIL_ON_NOTIFY default
}

/**
 * Creates an in-app notification and, when email is enabled, sends a matching
 * email. Never throws into the caller: notifications are best-effort so a mail
 * hiccup can't break a workflow action.
 */
export async function notify(input: NotifyInput): Promise<void> {
  if (!input.userId) return;
  try {
    const created = await prisma.notification.create({
      data: {
        userId: input.userId,
        kind: input.kind,
        payload: {
          title: input.title,
          body: input.body ?? null,
          taskId: input.taskId ?? null,
        } as Prisma.InputJsonValue,
      },
    });

    emitToUser(input.userId, "notification", {
      id: created.id,
      kind: created.kind,
      isRead: false,
      createdAt: created.createdAt,
      payload: { title: input.title, body: input.body ?? null, taskId: input.taskId ?? null },
    });

    if (input.sendEmail ?? config.emailOnNotify) {
      const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { email: true, fullName: true } });
      if (user?.email) {
        const url = input.taskId ? `${config.clientOrigin}/tasks/${input.taskId}` : config.clientOrigin;
        const { subject, html } = renderEmail({
          title: input.title,
          body: input.body,
          name: user.fullName,
          ctaUrl: url,
          ctaLabel: input.taskId ? "Open work item" : undefined,
        });
        await sendMail(user.email, subject, html);
      }
    }
  } catch (e) {
    console.error("[notify] failed:", (e as Error).message);
  }
}
