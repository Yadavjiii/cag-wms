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
  return actionLabel[action] ?? action.replace(/_/g, " ");
}

export function fmtDateTime(s?: string | null): string {
  if (!s) return "-";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "-";
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
