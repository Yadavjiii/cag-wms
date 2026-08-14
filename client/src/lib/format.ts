import { TaskStatus } from "../types";

export function fmtDate(s?: string | null): string {
  if (!s) return "-";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export const statusLabel: Record<TaskStatus, string> = {
  YET_TO_BE_ASSIGNED: "Unassigned",
  INITIATED: "Initiated",
  IN_PROGRESS: "In progress",
  FINISHED: "Finished",
  ON_HOLD: "On hold",
};

export const statusChip: Record<TaskStatus, string> = {
  YET_TO_BE_ASSIGNED: "bg-amber-50 text-amber-700 border-amber-200",
  INITIATED: "bg-slate-100 text-slate-600 border-slate-200",
  IN_PROGRESS: "bg-indigo-50 text-indigo-700 border-indigo-200",
  FINISHED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  ON_HOLD: "bg-orange-50 text-orange-700 border-orange-200",
};

export interface Rag {
  key: "done" | "red" | "amber" | "green" | "none";
  label: string;
  days: number | null;
}

export function rag(status: string, dueDate?: string | null): Rag {
  if (status === "FINISHED") return { key: "done", label: "Done", days: null };
  if (!dueDate) return { key: "none", label: "No due date", days: null };
  const due = new Date(dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (days < 0) return { key: "red", label: `${Math.abs(days)}d overdue`, days };
  if (days <= 3) return { key: "amber", label: `Due in ${days}d`, days };
  return { key: "green", label: `Due in ${days}d`, days };
}

export const ragText: Record<string, string> = {
  done: "text-emerald-600",
  red: "text-red-600",
  amber: "text-amber-600",
  green: "text-emerald-600",
  none: "text-slate-400",
};

export const ragBorder: Record<string, string> = {
  done: "border-l-emerald-500",
  red: "border-l-red-500",
  amber: "border-l-amber-500",
  green: "border-l-emerald-400",
  none: "border-l-slate-300",
};

export const actionLabel: Record<string, string> = {
  created: "created the work item",
  updated: "updated the work item",
  assigned: "assigned the work",
  assignment_requested: "requested a cross-department assignment",
  assignment_approved: "approved the assignment",
  assignment_rejected: "rejected the assignment",
  assignment_accepted: "accepted the assignment",
  assignment_declined: "declined the assignment",
  assignment_cancelled: "cancelled the assignment",
  attachment_added: "added a document",
  attachment_removed: "removed a document",
};

export function describeAction(action: string): string {
  return actionLabel[action] ?? extraActionLabel[action] ?? action.replace(/_/g, " ");
}

export function fmtDateTime(s?: string | null): string {
  if (!s) return "-";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "-";
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

// ---------------------------------------------------------------------------
// Priority, urgency and freshness
// ---------------------------------------------------------------------------

import type { CommentKind, TaskPriority, Severity } from "../types";

export const priorityLabel: Record<TaskPriority, string> = {
  LOW: "Low",
  NORMAL: "Normal",
  HIGH: "High",
  URGENT: "Urgent",
};

export const priorityChip: Record<TaskPriority, string> = {
  LOW: "bg-slate-50 text-slate-500 border-slate-200",
  NORMAL: "bg-slate-100 text-slate-600 border-slate-200",
  HIGH: "bg-amber-50 text-amber-700 border-amber-300",
  URGENT: "bg-red-50 text-red-700 border-red-300",
};

/**
 * The same three-part definition of urgent the server uses: flagged urgent, or
 * already late, or high priority and nearly due. Duplicated here only so a list
 * can be re-sorted without a round trip; the server stays the authority.
 */
export function isUrgentTask(t: { status: string; priority?: TaskPriority; dueDate?: string | null }): boolean {
  if (t.status === "FINISHED") return false;
  if (t.priority === "URGENT") return true;
  const r = rag(t.status, t.dueDate);
  if (r.key === "red") return true;
  return t.priority === "HIGH" && r.key === "amber";
}

/** How long ago, in words. "3 days ago" beats a date nobody subtracts. */
export function timeAgo(s?: string | null): string {
  if (!s) return "never";
  const then = new Date(s).getTime();
  if (isNaN(then)) return "never";
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  return `${Math.round(months / 12)} year(s) ago`;
}

/** Whole days since a timestamp. Negative is impossible; absent is Infinity. */
export function daysSince(s?: string | null): number {
  if (!s) return Infinity;
  const then = new Date(s).getTime();
  if (isNaN(then)) return Infinity;
  return Math.max(0, Math.floor((Date.now() - then) / 86400000));
}

export const severityStyle: Record<Severity, { row: string; dot: string; text: string }> = {
  critical: { row: "border-red-200 bg-red-50", dot: "bg-red-500", text: "text-red-800" },
  warning: { row: "border-amber-200 bg-amber-50", dot: "bg-amber-500", text: "text-amber-800" },
  info: { row: "border-slate-200 bg-slate-50", dot: "bg-slate-400", text: "text-slate-700" },
};

// ---------------------------------------------------------------------------
// Discussion
// ---------------------------------------------------------------------------

export const kindLabel: Record<CommentKind, string> = {
  REMARK: "Remark",
  STATUS_UPDATE: "Progress update",
  DIRECTION: "Direction",
  DECISION: "Decision",
  BLOCKER: "Blocker",
};

export const kindChip: Record<CommentKind, string> = {
  REMARK: "bg-slate-100 text-slate-600 border-slate-200",
  STATUS_UPDATE: "bg-indigo-50 text-indigo-700 border-indigo-200",
  DIRECTION: "bg-violet-50 text-violet-700 border-violet-200",
  DECISION: "bg-emerald-50 text-emerald-700 border-emerald-200",
  BLOCKER: "bg-red-50 text-red-700 border-red-300",
};

/** The accent stripe down the left of a post. */
export const kindAccent: Record<CommentKind, string> = {
  REMARK: "border-l-slate-200",
  STATUS_UPDATE: "border-l-indigo-400",
  DIRECTION: "border-l-violet-400",
  DECISION: "border-l-emerald-400",
  BLOCKER: "border-l-red-500",
};

/** Bytes as something a person can read. */
export function fmtSize(bytes?: number | null): string {
  if (bytes === null || bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A crude file-type label from the MIME type, for the icon and the tooltip. */
export function fileKind(mime?: string | null, name?: string): "image" | "pdf" | "sheet" | "doc" | "text" | "archive" | "file" {
  const m = mime ?? "";
  if (m.startsWith("image/")) return "image";
  if (m === "application/pdf") return "pdf";
  if (m.includes("spreadsheet") || m.includes("excel") || /\.(xlsx?|csv)$/i.test(name ?? "")) return "sheet";
  if (m.includes("word") || /\.(docx?)$/i.test(name ?? "")) return "doc";
  if (m.startsWith("text/")) return "text";
  if (m.includes("zip") || m.includes("compressed") || /\.(zip|rar|7z|tar|gz)$/i.test(name ?? "")) return "archive";
  return "file";
}

export function canPreview(mime?: string | null): boolean {
  return /^(image\/|application\/pdf|text\/plain)/.test(mime ?? "");
}

/** Every action the activity feed can show, in plain words. */
export const extraActionLabel: Record<string, string> = {
  progress_reported: "reported progress",
  commented: "posted a remark",
  blocker_raised: "raised a blocker",
  blocker_cleared: "cleared a blocker",
  task_deleted: "deleted the work item",
  task_restored: "restored the work item",
  leads_changed: "changed the leads",
  office_request_sent: "sent the work to another office",
  project_created: "created the project",
  project_updated: "updated the project",
  project_status_changed: "changed the project status",
  project_progress_reported: "reported progress on the project",
  member_added: "added someone to the project",
  member_removed: "took someone off the project",
  member_role_changed: "changed someone's role on the project",
};
