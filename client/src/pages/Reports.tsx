import { useEffect, useState } from "react";
import { Navigate, Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Card, ErrorText } from "../components/ui";
import { ReportSummary, ActivityEntry } from "../types";
import { describeAction, fmtDateTime, statusLabel } from "../lib/format";
import { TaskStatus } from "../types";

function Bar({ label, value, max, tone = "bg-indigo-500", sub }: { label: string; value: number; max: number; tone?: string; sub?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2 text-sm">
      <div className="w-40 truncate text-slate-600">{label}</div>
      <div className="grow bg-slate-100 rounded h-4 overflow-hidden">
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="w-20 text-right tabular-nums text-slate-500">
        {value}
        {sub ? ` ${sub}` : ""}
      </div>
    </div>
  );
}

export default function Reports() {
  const { user } = useAuth();
  const [data, setData] = useState<ReportSummary | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const canView = !!user?.permissions?.includes("report.view");
  if (user && !canView) return <Navigate to="/" replace />;

  useEffect(() => {
    api<ReportSummary>("/reports/summary").then(setData).catch((e) => setErr(e instanceof Error ? e.message : "Failed to load"));
    api<ActivityEntry[]>("/reports/activity").then(setActivity).catch(() => {});
  }, []);

  const maxLead = Math.max(1, ...(data?.byLead.map((l) => l.active) ?? [1]));
  const maxDept = Math.max(1, ...(data?.byDepartment.map((d) => d.active) ?? [1]));
  const maxStatus = Math.max(1, ...(data?.byStatus.map((s) => s.count) ?? [1]));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-serif text-2xl text-indigo-950">Reports & analytics</h1>
        <p className="text-sm text-slate-500">Metrics across the work you can see.</p>
      </div>
      <ErrorText>{err}</ErrorText>

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              ["Total", data.totals.total, "text-slate-700"],
              ["Active", data.totals.active, "text-indigo-700"],
              ["Overdue", data.totals.overdue, "text-red-600"],
              ["Due <= 3d", data.totals.dueSoon, "text-amber-600"],
              ["Finished", data.totals.finished, "text-emerald-600"],
            ].map(([label, value, tone]) => (
              <div key={label as string} className="bg-white border border-slate-200 rounded-lg px-3 py-3">
                <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
                <div className={`text-2xl font-semibold mt-1 tabular-nums ${tone}`}>{value as number}</div>
              </div>
            ))}
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Card title="By status">
              <div className="space-y-2">
                {data.byStatus.map((s) => (
                  <Bar key={s.status} label={statusLabel[s.status as TaskStatus] ?? s.status} value={s.count} max={maxStatus} />
                ))}
              </div>
            </Card>
            <Card title="Active work by department">
              <div className="space-y-2">
                {data.byDepartment.length === 0 && <div className="text-sm text-slate-400">No data.</div>}
                {data.byDepartment.map((d) => (
                  <Bar key={d.name} label={d.name} value={d.active} max={maxDept} tone="bg-emerald-500" />
                ))}
              </div>
            </Card>
          </div>

          <Card title="Workload by primary lead">
            <div className="space-y-2">
              {data.byLead.length === 0 && <div className="text-sm text-slate-400">No data.</div>}
              {data.byLead.map((l) => (
                <Bar key={l.name} label={l.name} value={l.active} max={maxLead} sub={l.overdue ? `(${l.overdue} overdue)` : ""} tone={l.overdue ? "bg-red-400" : "bg-indigo-500"} />
              ))}
            </div>
          </Card>
        </>
      )}

      <Card title="Recent activity">
        <div className="space-y-1.5">
          {activity.length === 0 && <div className="text-sm text-slate-400">No activity yet.</div>}
          {activity.map((a) => (
            <div key={a.id} className="text-sm flex items-center gap-2">
              <span className="text-slate-700">{a.actor?.fullName ?? "Someone"}</span>
              <span className="text-slate-500">{describeAction(a.action)}</span>
              {a.task && (
                <Link to={`/tasks/${a.task.id}`} className="text-indigo-700 hover:underline truncate">
                  {a.task.title}
                </Link>
              )}
              <span className="ml-auto text-xs text-slate-400 shrink-0">{fmtDateTime(a.createdAt)}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
