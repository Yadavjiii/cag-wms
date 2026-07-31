import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Clock, CheckCircle2 } from "lucide-react";
import { api } from "../api/client";
import { Task } from "../types";
import { Card } from "../components/ui";
import { rag, ragText, ragBorder, statusLabel, fmtDate } from "../lib/format";
import { useRealtime } from "../realtime";

export default function Dashboard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  function load() {
    api<Task[]>("/tasks")
      .then(setTasks)
      .catch((e) => setErr(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  useRealtime("task:changed", () => load());

  const kpi = useMemo(() => {
    const active = tasks.filter((t) => t.status !== "FINISHED");
    const overdue = active.filter((t) => rag(t.status, t.dueDate).key === "red");
    const soon = active.filter((t) => rag(t.status, t.dueDate).key === "amber");
    const pcts = tasks.filter((t) => t.pctComplete != null).map((t) => t.pctComplete as number);
    const avg = pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : 0;
    return { total: tasks.length, active: active.length, overdue: overdue.length, soon: soon.length, avg };
  }, [tasks]);

  const byStatus = useMemo(() => {
    const m: Record<string, number> = {};
    tasks.forEach((t) => (m[t.status] = (m[t.status] || 0) + 1));
    return m;
  }, [tasks]);

  const atRisk = useMemo(
    () =>
      tasks
        .filter((t) => t.status !== "FINISHED" && ["red", "amber"].includes(rag(t.status, t.dueDate).key))
        .sort((a, b) => (rag(a.status, a.dueDate).days ?? 999) - (rag(b.status, b.dueDate).days ?? 999)),
    [tasks]
  );

  if (loading) return <div className="text-slate-500">Loading dashboard...</div>;
  if (err) return <div className="text-red-600">{err}</div>;

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-serif text-slate-800">Dashboard</h1>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi label="Total tasks" value={kpi.total} tone="text-slate-700" />
        <Kpi label="Active" value={kpi.active} tone="text-indigo-700" />
        <Kpi label="Overdue" value={kpi.overdue} tone="text-red-600" Icon={AlertTriangle} />
        <Kpi label="Due within 3 days" value={kpi.soon} tone="text-amber-600" Icon={Clock} />
        <Kpi label="Avg completion" value={`${kpi.avg}%`} tone="text-emerald-600" Icon={CheckCircle2} />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card title="Status mix">
          <div className="space-y-2">
            {Object.keys(statusLabel).map((k) => {
              const count = byStatus[k] || 0;
              const pct = kpi.total ? Math.round((count / kpi.total) * 100) : 0;
              return (
                <div key={k}>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">{statusLabel[k as keyof typeof statusLabel]}</span>
                    <span className="font-semibold tabular-nums">{count}</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden mt-0.5">
                    <div className="h-full bg-indigo-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card title="At risk">
          <div className="space-y-2 max-h-72 overflow-auto pr-1">
            {atRisk.length === 0 && <div className="text-sm text-slate-400 py-6 text-center">Nothing overdue or due soon.</div>}
            {atRisk.map((t) => {
              const r = rag(t.status, t.dueDate);
              return (
                <Link
                  key={t.id}
                  to={`/tasks/${t.id}`}
                  className={`flex items-center gap-2 bg-white border border-slate-200 border-l-4 ${ragBorder[r.key]} rounded-md px-3 py-2 hover:bg-slate-50`}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{t.title}</div>
                    <div className="text-xs text-slate-500">
                      PL {t.primaryLead?.fullName ?? "-"} - due {fmtDate(t.dueDate)}
                    </div>
                  </div>
                  <span className={`ml-auto text-xs font-semibold ${ragText[r.key]}`}>{r.label}</span>
                </Link>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Kpi({ label, value, tone, Icon }: { label: string; value: string | number; tone: string; Icon?: React.ElementType }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg px-3 py-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-slate-400">
        {Icon && <Icon className="w-3.5 h-3.5" />}
        {label}
      </div>
      <div className={`text-2xl font-semibold mt-1 tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}
