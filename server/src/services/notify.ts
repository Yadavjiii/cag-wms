import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { config } from "../config";
import { sendMail } from "../email/mailer";
import { renderEmail } from "../email/templates";
import { emitToUser } from "../realtime";

interface NotifyInput {
  userId?: string | null;
  kind: string;         // assigned | approval_request | approved | rejected | accepted | declined | cancelled | due_soon | overdue | comment | status_update | blocker | meeting_invite | meeting_reminder
  title: string;
  body?: string;
  taskId?: string | null;
  /** Set when the thing being talked about is a project rather than a work item. */
  projectId?: string | null;
  /** An explicit in-app path, when neither a task nor a project link is right. */
  url?: string | null;
  sendEmail?: boolean;  // overrides the EMAIL_ON_NOTIFY default
}

/** Where a notification should take you when you click it. */
function targetPath(input: NotifyInput): string | null {
  if (input.url) return input.url;
  if (input.taskId) return `/tasks/${input.taskId}`;
  if (input.projectId) return `/projects/${input.projectId}`;
  return null;
}

/**
 * Creates an in-app notification and, when email is enabled, sends a matching
 * email. Never throws into the caller: notifications are best-effort so a mail
 * hiccup can't break a workflow action.
 */
export async function notify(input: NotifyInput): Promise<void> {
  if (!input.userId) return;
  try {
    const path = targetPath(input);
    const payload = {
      title: input.title,
      body: input.body ?? null,
      taskId: input.taskId ?? null,
      projectId: input.projectId ?? null,
      url: path,
    };

    const created = await prisma.notification.create({
      data: {
        userId: input.userId,
        kind: input.kind,
        payload: payload as Prisma.InputJsonValue,
      },
    });

    emitToUser(input.userId, "notification", {
      id: created.id,
      kind: created.kind,
      isRead: false,
      createdAt: created.createdAt,
      payload,
    });

    if (input.sendEmail ?? config.emailOnNotify) {
      const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { email: true, fullName: true } });
      if (user?.email) {
        const url = path ? `${config.clientOrigin}${path}` : config.clientOrigin;
        const { subject, html } = renderEmail({
          title: input.title,
          body: input.body,
          name: user.fullName,
          ctaUrl: url,
          ctaLabel: input.taskId ? "Open work item" : input.projectId ? "Open project" : undefined,
        });
        await sendMail(user.email, subject, html);
      }
    }
  } catch (e) {
    console.error("[notify] failed:", (e as Error).message);
  }
}
