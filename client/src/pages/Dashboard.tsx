import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  FolderKanban,
  Layers,
  MapPin,
  RefreshCw,
  UserX,
  Video,
} from "lucide-react";
import { api } from "../api/client";
import { DashboardSnapshot, ProjectCard } from "../types";
import { Card, PageHeader, SkeletonRows, Tabs, Skeleton } from "../components/ui";
import { BarList, Donut, Kpi, Ring, SplitBar, TrendChart, priorityColour, statusColour } from "../components/charts";
import { AlertsPanel, WorkListPanel } from "../components/WorkList";
import { describeAction, fmtDate, fmtDateTime, timeAgo } from "../lib/format";
import { useAuth } from "../auth/AuthContext";
import { useRealtime } from "../realtime";

/**
 * The landing screen.
 *
 * It answers four questions in this order, because that is the order they get
 * asked in: what needs me today, what is late, where is the work, and is the
 * office keeping up. Everything comes from one endpoint so no two figures on the
 * page can be computed from different moments.
 */

type Lens = "attention" | "work" | "people" | "trend";

export default function Dashboard() {
  const { user } = useAuth();
  const [snap, setSnap] = useState<DashboardSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [lens, setLens] = useState<Lens>("attention");
  const [refreshing, setRefreshing] = useState(false);

  async function load(quiet = false) {
    if (!quiet) setRefreshing(true);
    try {
      setSnap(await api<DashboardSnapshot>("/dashboard"));
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load the dashboard");
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load(true);
  }, []);

  // Anything that moves work, a project, or the thread refreshes the snapshot.
  useRealtime("task:changed", () => load(true));
  useRealtime("project:changed", () => load(true));
  useRealtime("discussion:changed", () => load(true));

  if (err && !snap) return <div className="text-red-600">{err}</div>;

  if (!snap) {
    return (
      <div className="space-y-4">
        <PageHeader title="Dashboard" subtitle="Loading your work..." />
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
        <SkeletonRows count={5} />
      </div>
    );
  }

  const t = snap.totals;
  const stale = snap.thresholds.staleDays;
  const criticals = snap.alerts.filter((a) => a.severity === "critical").length;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Good ${greeting()}, ${(user?.fullName ?? "").split(" ")[0]}`}
        subtitle={
          criticals
            ? `${criticals} thing${criticals === 1 ? "" : "s"} need attention right now.`
            : "Nothing is overdue or blocked. Here is where everything stands."
        }
        actions={
          <button className="btn btn-sm" onClick={() => load()} disabled={refreshing}>
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Refreshing" : "Refresh"}
          </button>
        }
      />

      {/* ---- the numbers ---- */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi label="Open work" value={t.open} tone="navy" hint={`${t.total} in total`} Icon={Layers} />
        <Kpi
          label="Overdue"
          value={t.overdue}
          tone={t.overdue ? "red" : "green"}
          hint={t.overdue ? "past the due date" : "nothing late"}
          Icon={AlertTriangle}
        />
        <Kpi label="Due today" value={t.dueToday} tone={t.dueToday ? "amber" : "plain"} hint={`${t.dueSoon} within ${snap.thresholds.dueSoonDays} days`} Icon={Clock} />
        <Kpi label="Urgent" value={t.urgent} tone={t.urgent ? "red" : "plain"} hint="flagged, late, or nearly due" Icon={AlertOctagon} />
        <Kpi label="Unassigned" value={t.unassigned} tone={t.unassigned ? "amber" : "plain"} hint="no lead named" Icon={UserX} />
        <Kpi
          label="Finished"
          value={t.finished}
          tone="green"
          hint={t.onTimeRate === null ? `${t.completionRate}% of all work` : `${t.onTimeRate}% on time`}
          Icon={CheckCircle2}
        />
      </div>

      {/* ---- attention and my day ---- */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Card
          title="Needs attention"
          right={<span className="text-[11px] text-slate-400">as of {fmtDateTime(snap.generatedAt)}</span>}
        >
          <AlertsPanel alerts={snap.alerts} />
        </Card>

        <div className="space-y-4">
          <Card
            title="My work"
            right={
              <Link to="/tasks?mine=true" className="text-xs text-indigo-700 hover:underline">
                All mine
              </Link>
            }
          >
            <div className="grid grid-cols-4 gap-2 mb-3">
              <MiniStat label="Open" value={snap.mine.totals.open} />
              <MiniStat label="Late" value={snap.mine.totals.overdue} tone="red" />
              <MiniStat label="To accept" value={snap.mine.awaitingMyAcceptance} tone="amber" />
              <MiniStat label="To approve" value={snap.mine.awaitingMyApproval} tone="amber" />
            </div>
            <WorkListPanel
              tasks={snap.myWork}
              emptyText="Nothing assigned to you is open."
              limit={5}
              moreHref="/tasks?mine=true"
              staleDays={stale}
            />
          </Card>

          <Card
            title="Meetings"
            right={
              <Link to="/meetings" className="text-xs text-indigo-700 hover:underline">
                Calendar
              </Link>
            }
          >
            {snap.meetings.upcoming.length === 0 ? (
              <div className="text-sm text-slate-400 py-4 text-center">Nothing in the next seven days.</div>
            ) : (
              <div className="space-y-1.5">
                {snap.meetings.upcoming.slice(0, 5).map((m) => {
                  const today = new Date(m.startsAt).toDateString() === new Date().toDateString();
                  return (
                    <div
                      key={m.id}
                      className={`flex items-center gap-2 border rounded-md px-2.5 py-1.5 ${
                        today ? "border-amber-200 bg-amber-50" : "border-slate-200"
                      }`}
                    >
                      {m.mode === "ONLINE" ? (
                        <Video className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      ) : (
                        <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-800 truncate">{m.title}</div>
                        <div className="text-[11px] text-slate-500 truncate">
                          {new Date(m.startsAt).toLocaleString("en-GB", {
                            weekday: "short",
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          {m.location ? ` \u00b7 ${m.location}` : ""}
                          {m._count?.participants ? ` \u00b7 ${m._count.participants} people` : ""}
                        </div>
                      </div>
                      {today && <CalendarClock className="w-3.5 h-3.5 text-amber-600 ml-auto shrink-0" />}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* ---- lenses ---- */}
      <div>
        <Tabs<Lens>
          tabs={[
            { key: "attention", label: "At risk", count: t.overdue + t.urgent, badge: t.overdue ? "red" : "amber" },
            { key: "work", label: "Work mix" },
            { key: "people", label: "Who has what" },
            { key: "trend", label: "Are we keeping up" },
          ]}
          active={lens}
          onChange={setLens}
        />

        <div className="pt-4">
          {lens === "attention" && (
            <div className="grid gap-4 md:grid-cols-2">
              <Card title={`Overdue (${snap.overdue.length})`}>
                <WorkListPanel tasks={snap.overdue} emptyText="Nothing is past its due date." moreHref="/tasks?filter=overdue" staleDays={stale} />
              </Card>
              <Card title={`Urgent (${snap.urgent.length})`}>
                <WorkListPanel tasks={snap.urgent} emptyText="Nothing is urgent today." moreHref="/tasks?filter=urgent" staleDays={stale} />
              </Card>
              <Card title={`Blocked (${snap.blockers.length})`}>
                {snap.blockers.length === 0 ? (
                  <div className="text-sm text-slate-400 py-5 text-center">Nothing is reported as blocked.</div>
                ) : (
                  <div className="space-y-1.5">
                    {snap.blockers.map((b) => (
                      <Link
                        key={b.id}
                        to={`/tasks/${b.taskId}`}
                        className="block border border-red-200 bg-red-50 rounded-md px-3 py-2 hover:brightness-[.98]"
                      >
                        <div className="text-sm font-semibold text-red-800 truncate">{b.taskTitle}</div>
                        <div className="text-xs text-slate-700 mt-0.5 line-clamp-2">{b.body}</div>
                        <div className="text-[11px] text-slate-500 mt-1">
                          {b.author?.fullName ?? "Someone"} &middot; {timeAgo(b.createdAt)}
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </Card>
              <Card title={`No progress reported in ${stale} days (${snap.stale.length})`}>
                <WorkListPanel
                  tasks={snap.stale}
                  emptyText="Everything open has been reported on recently."
                  moreHref="/tasks?filter=stale"
                  staleDays={stale}
                />
              </Card>
            </div>
          )}

          {lens === "work" && (
            <div className="grid gap-4 md:grid-cols-2">
              <Card title="By status">
                <Donut
                  data={snap.statusMix.map((b) => ({ label: b.label, count: b.count, colour: statusColour[b.key] }))}
                  centreLabel="work items"
                />
              </Card>
              <Card title="Open work by priority">
                <Donut
                  data={snap.priorityMix.map((b) => ({ label: b.label, count: b.count, colour: priorityColour[b.key] }))}
                  centreLabel="open"
                />
              </Card>
              <Card title="By department">
                <BarList
                  rows={snap.byDepartment.map((d) => ({
                    label: d.name,
                    value: d.open,
                    note: d.overdue ? `${d.overdue} late` : undefined,
                    colour: d.overdue ? "#C0392B" : undefined,
                  }))}
                  emptyText="No departmental work to show."
                />
              </Card>
              <Card title="Completion">
                <div className="flex items-center gap-6 flex-wrap">
                  <Ring value={t.avgCompletion} label="Average progress" sublabel="across open work items" />
                  <Ring
                    value={t.completionRate}
                    colour="#1B6B4A"
                    label="Finished"
                    sublabel={`${t.finished} of ${t.total} work items`}
                  />
                </div>
              </Card>
            </div>
          )}

          {lens === "people" && (
            <Card title="Open work by person" right={<span className="text-[11px] text-slate-400">counted against whoever holds it</span>}>
              {snap.workload.length === 0 ? (
                <div className="text-sm text-slate-400 py-5">Nothing to show.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-200">
                        <th className="py-2 font-bold">Person</th>
                        <th className="py-2 font-bold text-right">Open</th>
                        <th className="py-2 font-bold text-right">Late</th>
                        <th className="py-2 font-bold text-right">Urgent</th>
                        <th className="py-2 font-bold text-right">Done</th>
                        <th className="py-2 font-bold w-40">Load</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snap.workload.map((w) => (
                        <tr key={w.userId} className="border-b border-slate-100 last:border-0">
                          <td className="py-2 pr-2 truncate max-w-[14rem]">{w.name}</td>
                          <td className="py-2 text-right tabular-nums font-semibold">{w.open}</td>
                          <td className={`py-2 text-right tabular-nums ${w.overdue ? "text-red-600 font-semibold" : "text-slate-400"}`}>
                            {w.overdue || "-"}
                          </td>
                          <td className={`py-2 text-right tabular-nums ${w.urgent ? "text-amber-600 font-semibold" : "text-slate-400"}`}>
                            {w.urgent || "-"}
                          </td>
                          <td className="py-2 text-right tabular-nums text-slate-500">{w.finished}</td>
                          <td className="py-2 pl-3">
                            <SplitBar
                              segments={[
                                { label: "Late", value: w.overdue, colour: "#C0392B" },
                                { label: "Urgent", value: Math.max(0, w.urgent - w.overdue), colour: "#B4560A" },
                                { label: "On track", value: Math.max(0, w.open - w.urgent), colour: "#14406E" },
                              ]}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          {lens === "trend" && (
            <div className="grid gap-4">
              <Card
                title="Raised, finished and open backlog"
                right={<span className="text-[11px] text-slate-400">last 14 days</span>}
              >
                <TrendChart points={snap.trend} height={150} />
              </Card>
              <Card title="Recent activity" right={<Activity className="w-3.5 h-3.5 text-slate-300" />}>
                <div className="space-y-1.5 max-h-72 overflow-auto pr-1">
                  {snap.recentActivity.length === 0 && <div className="text-sm text-slate-400 py-4">Nothing recorded yet.</div>}
                  {snap.recentActivity.map((a) => (
                    <div key={a.id} className="flex items-center gap-2 text-sm">
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0" />
                      <span className="text-slate-700 shrink-0">{a.actor?.fullName ?? "Someone"}</span>
                      <span className="text-slate-500 shrink-0">{describeAction(a.action)}</span>
                      {a.task && (
                        <Link to={`/tasks/${a.task.id}`} className="text-indigo-700 hover:underline truncate">
                          {a.task.title}
                        </Link>
                      )}
                      {!a.task && a.project && (
                        <Link to={`/projects/${a.project.id}`} className="text-indigo-700 hover:underline truncate">
                          {a.project.name}
                        </Link>
                      )}
                      <span className="ml-auto text-[11px] text-slate-400 shrink-0">{timeAgo(a.createdAt)}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}
        </div>
      </div>

      {/* ---- projects ---- */}
      <Card
        title="Projects, worst health first"
        right={
          <Link to="/projects" className="text-xs text-indigo-700 hover:underline">
            All projects
          </Link>
        }
      >
        {snap.projects.length === 0 ? (
          <div className="text-sm text-slate-400 py-5 text-center">
            No projects yet.{" "}
            <Link to="/projects" className="link">
              Create one
            </Link>
            .
          </div>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {snap.projects.map((p) => (
              <ProjectHealthCard key={p.id} project={p} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}

function MiniStat({ label, value, tone }: { label: string; value: number; tone?: "red" | "amber" }) {
  const cls = value === 0 ? "text-slate-300" : tone === "red" ? "text-red-600" : tone === "amber" ? "text-amber-600" : "text-slate-800";
  return (
    <div className="bg-slate-50 border border-slate-100 rounded-md px-2 py-1.5 text-center">
      <div className={`text-lg font-semibold tabular-nums ${cls}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-slate-400 font-bold">{label}</div>
    </div>
  );
}

function ProjectHealthCard({ project: p }: { project: ProjectCard }) {
  const tone =
    p.health.label === "At risk"
      ? { bar: "#C0392B", text: "text-red-700", bg: "bg-red-50 border-red-200" }
      : p.health.label === "Needs attention"
        ? { bar: "#B4560A", text: "text-amber-700", bg: "bg-amber-50 border-amber-200" }
        : { bar: "#1B6B4A", text: "text-emerald-700", bg: "bg-white border-slate-200" };

  return (
    <Link to={`/projects/${p.id}`} className={`block border rounded-lg px-3 py-2.5 hover:shadow-sm ${tone.bg}`}>
      <div className="flex items-start gap-2">
        <FolderKanban className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-800 truncate">{p.name}</div>
          <div className="text-[11px] text-slate-500 truncate">
            {p.lead ? p.lead.fullName : "No lead"}
            {p.dueDate ? ` \u00b7 due ${fmtDate(p.dueDate)}` : ""}
          </div>
        </div>
        <span className={`ml-auto text-[10px] font-bold uppercase tracking-wide shrink-0 ${tone.text}`}>
          {p.health.label}
        </span>
      </div>

      <div className="mt-2">
        <div className="flex justify-between text-[11px] text-slate-500">
          <span>{p.completion}% complete</span>
          <span className="tabular-nums">
            {p.totals.open} open{p.totals.overdue ? `, ${p.totals.overdue} late` : ""}
          </span>
        </div>
        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mt-1">
          <div className="h-full rounded-full" style={{ width: `${p.completion}%`, background: tone.bar }} />
        </div>
      </div>

      {p.health.reasons[0] && <div className="text-[11px] text-slate-500 mt-1.5 line-clamp-2">{p.health.reasons[0]}</div>}

      <div className="flex items-center gap-3 mt-1.5 text-[10px] text-slate-400">
        <span>{p.counts.tasks} items</span>
        <span>{p.counts.members} people</span>
        <span>{p.counts.posts} posts</span>
        <span>{p.counts.files} files</span>
        <span className="ml-auto">{p.lastUpdateAt ? timeAgo(p.lastUpdateAt) : "no updates"}</span>
      </div>
    </Link>
  );
}
