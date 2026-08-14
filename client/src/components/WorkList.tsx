import { Link } from "react-router-dom";
import { AlertOctagon, AlertTriangle, Bell, CalendarClock, Clock, MessageSquare, Paperclip, UserX } from "lucide-react";
import { Alert, Task } from "../types";
import { EmptyState } from "./ui";
import {
  daysSince,
  fmtDate,
  priorityChip,
  priorityLabel,
  rag,
  ragBorder,
  ragText,
  severityStyle,
  statusChip,
  statusLabel,
  timeAgo,
} from "../lib/format";

/**
 * The two lists that appear on every dashboard: what needs attention, and the
 * work behind it. Both are pure presentation over what the server already
 * decided, so a row can never be styled as urgent while the count above it says
 * otherwise.
 */

const ICONS: Record<string, React.ElementType> = {
  overdue: AlertTriangle,
  due_today: Clock,
  urgent: AlertTriangle,
  blocker: AlertOctagon,
  awaiting_acceptance: Bell,
  awaiting_approval: Bell,
  meeting: CalendarClock,
  stale: Clock,
  unassigned: UserX,
  project_at_risk: AlertTriangle,
};

export function AlertsPanel({ alerts }: { alerts: Alert[] }) {
  if (!alerts.length) {
    return (
      <EmptyState>
        Nothing needs your attention. No overdue work, no blockers, and no decisions waiting on you.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-1.5">
      {alerts.map((a) => {
        const s = severityStyle[a.severity];
        const Icon = ICONS[a.kind] ?? Bell;
        return (
          <Link
            key={a.id}
            to={a.url}
            className={`flex items-start gap-2.5 border rounded-md px-3 py-2 hover:brightness-[.98] ${s.row}`}
          >
            <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${s.text}`} />
            <div className="min-w-0">
              <div className={`text-sm font-semibold ${s.text}`}>{a.title}</div>
              {a.detail && <div className="text-xs text-slate-600 mt-0.5 line-clamp-2">{a.detail}</div>}
            </div>
            {a.at && <span className="ml-auto text-[11px] text-slate-500 shrink-0">{timeAgo(a.at)}</span>}
          </Link>
        );
      })}
    </div>
  );
}

/** One work item as a row. Used on the dashboard, the project screen and search. */
export function WorkRow({ task, staleDays = 10 }: { task: Task; staleDays?: number }) {
  const r = rag(task.status, task.dueDate);
  const quiet = daysSince(task.lastUpdateAt ?? task.updatedAt);
  const isStale = task.status !== "FINISHED" && quiet >= staleDays;

  return (
    <Link
      to={`/tasks/${task.id}`}
      className={`block bg-white border border-slate-200 border-l-[3px] ${ragBorder[r.key]} rounded-md px-3 py-2 hover:border-slate-300 hover:shadow-sm`}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-slate-800 truncate">{task.title}</span>
        {task.priority && task.priority !== "NORMAL" && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-semibold shrink-0 ${priorityChip[task.priority]}`}>
            {priorityLabel[task.priority]}
          </span>
        )}
        <span className={`ml-auto text-[11px] font-semibold shrink-0 ${ragText[r.key]}`}>{r.label}</span>
      </div>

      <div className="flex items-center gap-2.5 mt-1 text-[11px] text-slate-500 flex-wrap">
        <span className={`px-1.5 py-0.5 rounded border ${statusChip[task.status]}`}>{statusLabel[task.status]}</span>
        <span>{task.currentlyWith?.fullName ?? task.primaryLead?.fullName ?? "Nobody assigned"}</span>
        {task.dueDate && <span>due {fmtDate(task.dueDate)}</span>}
        {task.project && <span className="truncate max-w-[10rem]">{task.project.name}</span>}
        {typeof task.pctComplete === "number" && (
          <span className="inline-flex items-center gap-1.5">
            <span className="w-14 h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <span className="block h-full bg-[color:var(--brand-mid)]" style={{ width: `${task.pctComplete}%` }} />
            </span>
            {task.pctComplete}%
          </span>
        )}
        {!!task._count?.comments && (
          <span className="inline-flex items-center gap-1">
            <MessageSquare className="w-3 h-3" />
            {task._count.comments}
          </span>
        )}
        {!!task._count?.attachments && (
          <span className="inline-flex items-center gap-1">
            <Paperclip className="w-3 h-3" />
            {task._count.attachments}
          </span>
        )}
        {isStale && <span className="text-amber-700 font-semibold">silent {quiet}d</span>}
      </div>
    </Link>
  );
}

/** A capped list of work rows with an honest "and N more" link. */
export function WorkListPanel({
  tasks,
  emptyText,
  limit = 6,
  moreHref,
  staleDays,
}: {
  tasks: Task[];
  emptyText: string;
  limit?: number;
  moreHref?: string;
  staleDays?: number;
}) {
  if (!tasks.length) return <div className="text-sm text-slate-400 py-5 text-center">{emptyText}</div>;
  return (
    <div className="space-y-1.5">
      {tasks.slice(0, limit).map((t) => (
        <WorkRow key={t.id} task={t} staleDays={staleDays} />
      ))}
      {tasks.length > limit && moreHref && (
        <Link to={moreHref} className="block text-xs text-indigo-700 hover:underline pt-1">
          View all {tasks.length}
        </Link>
      )}
    </div>
  );
}
