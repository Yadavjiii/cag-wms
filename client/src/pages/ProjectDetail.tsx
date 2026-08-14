import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  AlertOctagon,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  Layers,
  MapPin,
  Users,
  Video,
} from "lucide-react";
import { api } from "../api/client";
import {
  Person,
  Project,
  ProjectDashboard,
  ProjectRoleKind,
  ProjectStatus,
  TaskPriority,
} from "../types";
import { Button, Card, EmptyState, ErrorText, Field, PageHeader, Skeleton, Tabs, TextInput } from "../components/ui";
import { BarList, Donut, Kpi, PlanVsProgress, Ring, SplitBar, TrendChart, priorityColour, statusColour } from "../components/charts";
import { WorkListPanel } from "../components/WorkList";
import Discussion from "../components/Discussion";
import Attachments from "../components/Attachments";
import { describeAction, fmtDate, fmtDateTime, priorityChip, priorityLabel, timeAgo } from "../lib/format";
import { useRealtime } from "../realtime";

/**
 * A project, in six views.
 *
 * The dashboard is the default, because the first question anybody opening a
 * project asks is "how is it going", and the previous version of this page made
 * them count work items to find out.
 */

const ROLE_LABEL: Record<ProjectRoleKind, string> = {
  PRIMARY_LEAD: "Primary lead",
  SECONDARY_LEAD: "Secondary lead",
  MEMBER: "Member",
  OBSERVER: "Observer",
};
const ROLE_ORDER: ProjectRoleKind[] = ["PRIMARY_LEAD", "SECONDARY_LEAD", "MEMBER", "OBSERVER"];

const STATUS_LABEL: Record<ProjectStatus, string> = {
  PLANNING: "Planning",
  ACTIVE: "Active",
  ON_HOLD: "On hold",
  COMPLETED: "Completed",
};

const PRIORITIES: TaskPriority[] = ["LOW", "NORMAL", "HIGH", "URGENT"];

type Tab = "dashboard" | "work" | "team" | "discussion" | "files" | "activity";

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("dashboard");
  const [d, setD] = useState<ProjectDashboard | null>(null);
  const [available, setAvailable] = useState<Person[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  const [addUserId, setAddUserId] = useState("");
  const [addRole, setAddRole] = useState<ProjectRoleKind>("MEMBER");
  const [form, setForm] = useState({
    name: "",
    code: "",
    description: "",
    status: "ACTIVE" as ProjectStatus,
    priority: "NORMAL" as TaskPriority,
    startDate: "",
    dueDate: "",
  });

  async function load() {
    try {
      const dash = await api<ProjectDashboard>(`/projects/${id}/dashboard`);
      setD(dash);
      const p = dash.project;
      setForm({
        name: p.name,
        code: p.code ?? "",
        description: p.description ?? "",
        status: p.status,
        priority: p.priority ?? "NORMAL",
        startDate: p.startDate ? p.startDate.slice(0, 10) : "",
        dueDate: p.dueDate ? p.dueDate.slice(0, 10) : "",
      });
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load the project");
    }
  }

  useEffect(() => {
    load();
    api<Person[]>(`/projects/${id}/available-people`)
      .then(setAvailable)
      .catch(() => setAvailable([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useRealtime("project:changed", (p) => {
    const payload = p as { projectId?: string } | undefined;
    if (!payload || payload.projectId === id) load();
  });
  useRealtime("task:changed", () => load());

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await load();
      api<Person[]>(`/projects/${id}/available-people`)
        .then(setAvailable)
        .catch(() => {});
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    run(async () => {
      await api(`/projects/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: form.name,
          code: form.code || undefined,
          description: form.description || undefined,
          status: form.status,
          priority: form.priority,
          startDate: form.startDate || null,
          dueDate: form.dueDate || null,
        }),
      });
      setEditing(false);
    });

  const addMember = () =>
    run(async () => {
      await api(`/projects/${id}/members`, { method: "POST", body: JSON.stringify({ userId: addUserId, role: addRole }) });
      setAddUserId("");
      setAddRole("MEMBER");
    });

  const changeRole = (userId: string, role: ProjectRoleKind) =>
    run(() => api(`/projects/${id}/members/${userId}`, { method: "PATCH", body: JSON.stringify({ role }) }).then(() => undefined));

  const removeMember = (userId: string, name: string) => {
    if (!confirm(`Remove ${name} from this project?`)) return;
    run(() => api(`/projects/${id}/members/${userId}`, { method: "DELETE" }).then(() => undefined));
  };

  async function deleteProject() {
    if (!d) return;
    if (!confirm(`Delete "${d.project.name}"? It is archived, not destroyed, and its work items are kept.`)) return;
    setBusy(true);
    try {
      await api(`/projects/${id}`, { method: "DELETE" });
      navigate("/projects");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not delete the project");
      setBusy(false);
    }
  }

  const sortedTeam = useMemo(
    () =>
      [...(d?.team ?? [])].sort(
        (a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.user.fullName.localeCompare(b.user.fullName)
      ),
    [d]
  );

  if (!d) {
    return (
      <div className="space-y-4">
        <ErrorText>{err}</ErrorText>
        {!err && (
          <>
            <Skeleton className="h-10 w-72" />
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-20" />
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  const p: Project = d.project;
  const canManage = p.canManage !== false;
  const canContribute = p.canContribute !== false;
  const stale = d.thresholds.staleDays;
  const health = d.health;

  const healthTone =
    health.label === "At risk"
      ? { text: "text-red-700", bg: "bg-red-50 border-red-200", bar: "#C0392B" }
      : health.label === "Needs attention"
        ? { text: "text-amber-700", bg: "bg-amber-50 border-amber-200", bar: "#B4560A" }
        : health.label === "Not started"
          ? { text: "text-slate-600", bg: "bg-slate-50 border-slate-200", bar: "#94A3B8" }
          : { text: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200", bar: "#1B6B4A" };

  return (
    <div className="space-y-4">
      <PageHeader
        title={p.name}
        subtitle={[p.code, p.department?.name, STATUS_LABEL[p.status], p.office?.name].filter(Boolean).join(" \u00b7 ")}
        actions={
          <div className="flex gap-2">
            {p.priority && p.priority !== "NORMAL" && (
              <span className={`self-center text-[10px] px-2 py-1 rounded-full border font-bold uppercase ${priorityChip[p.priority]}`}>
                {priorityLabel[p.priority]}
              </span>
            )}
            {canManage && (
              <>
                <Button onClick={() => setEditing((v) => !v)}>{editing ? "Cancel" : "Edit"}</Button>
                <button className="btn btn-sm btn-danger" onClick={deleteProject} disabled={busy}>
                  Delete
                </button>
              </>
            )}
          </div>
        }
      />
      <ErrorText>{err}</ErrorText>

      {p.archivedAt && (
        <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
          This project is archived. It is kept for the record and can be restored from the projects list.
        </div>
      )}

      {editing && (
        <Card title="Edit project">
          <div className="space-y-3">
            <div className="grid md:grid-cols-2 gap-3">
              <Field label="Name">
                <TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label="Code">
                <TextInput value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
              </Field>
            </div>
            <Field label="Description">
              <textarea
                className="input"
                rows={3}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </Field>
            <div className="grid md:grid-cols-4 gap-3">
              <Field label="Status">
                <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ProjectStatus })}>
                  {(Object.keys(STATUS_LABEL) as ProjectStatus[]).map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Priority">
                <select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as TaskPriority })}>
                  {PRIORITIES.map((s) => (
                    <option key={s} value={s}>
                      {priorityLabel[s]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Start date">
                <TextInput type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
              </Field>
              <Field label="Due date">
                <TextInput type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
              </Field>
            </div>
            <Button onClick={save} disabled={busy}>
              Save changes
            </Button>
          </div>
        </Card>
      )}

      <Tabs<Tab>
        tabs={[
          { key: "dashboard", label: "Dashboard" },
          { key: "work", label: "Work", count: d.counts.tasks },
          { key: "team", label: "Team", count: d.counts.members },
          { key: "discussion", label: "Discussion", count: d.counts.posts },
          { key: "files", label: "Files", count: d.counts.files },
          { key: "activity", label: "Activity" },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div className="pt-1">
        {/* ---------------- DASHBOARD ---------------- */}
        {tab === "dashboard" && (
          <div className="space-y-4">
            <div className={`border rounded-lg px-4 py-3 ${healthTone.bg}`}>
              <div className="flex items-start gap-4 flex-wrap">
                <Ring value={health.score} size={78} colour={healthTone.bar} />
                <div className="min-w-0 flex-1">
                  <div className={`text-sm font-bold uppercase tracking-wide ${healthTone.text}`}>{health.label}</div>
                  <ul className="text-xs text-slate-600 mt-1 space-y-0.5">
                    {health.reasons.map((r) => (
                      <li key={r}>&middot; {r}</li>
                    ))}
                  </ul>
                </div>
                <div className="text-[11px] text-slate-500 shrink-0">
                  as of {fmtDateTime(d.generatedAt)}
                  <br />
                  last posted {p.lastUpdateAt ? timeAgo(p.lastUpdateAt) : "never"}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <Kpi label="Work items" value={d.totals.total} tone="navy" hint={`${d.totals.open} open`} Icon={Layers} />
              <Kpi label="Overdue" value={d.totals.overdue} tone={d.totals.overdue ? "red" : "green"} Icon={AlertTriangle} />
              <Kpi label="Due soon" value={d.totals.dueSoon} tone={d.totals.dueSoon ? "amber" : "plain"} hint={`within ${d.thresholds.dueSoonDays} days`} Icon={Clock} />
              <Kpi label="Blocked" value={d.counts.blockers} tone={d.counts.blockers ? "red" : "plain"} Icon={AlertOctagon} />
              <Kpi label="Silent" value={d.totals.stale} tone={d.totals.stale ? "amber" : "plain"} hint={`over ${stale} days`} Icon={Clock} />
              <Kpi label="Finished" value={d.totals.finished} tone="green" hint={`${d.completion}% overall`} Icon={CheckCircle2} />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Card title="Plan against progress">
                <PlanVsProgress elapsedPct={d.schedule.elapsedPct} completionPct={d.completion} />
                <div className="grid grid-cols-3 gap-2 mt-3 text-[11px]">
                  <div>
                    <div className="text-slate-400 uppercase tracking-wide font-bold">Start</div>
                    <div className="text-slate-700">{fmtDate(d.schedule.startDate)}</div>
                  </div>
                  <div>
                    <div className="text-slate-400 uppercase tracking-wide font-bold">Due</div>
                    <div className="text-slate-700">{fmtDate(d.schedule.dueDate)}</div>
                  </div>
                  <div>
                    <div className="text-slate-400 uppercase tracking-wide font-bold">Days left</div>
                    <div className={d.schedule.daysToDue !== null && d.schedule.daysToDue < 0 ? "text-red-600 font-semibold" : "text-slate-700"}>
                      {d.schedule.daysToDue === null
                        ? "-"
                        : d.schedule.daysToDue < 0
                          ? `${Math.abs(d.schedule.daysToDue)} overdue`
                          : d.schedule.daysToDue}
                    </div>
                  </div>
                </div>
              </Card>

              <Card title="By status">
                <Donut
                  data={d.statusMix.map((b) => ({ label: b.label, count: b.count, colour: statusColour[b.key] }))}
                  centreLabel="items"
                />
              </Card>

              <Card title="Open work by priority">
                <Donut
                  data={d.priorityMix.map((b) => ({ label: b.label, count: b.count, colour: priorityColour[b.key] }))}
                  centreLabel="open"
                />
              </Card>

              <Card title="Load across the team">
                <BarList
                  rows={sortedTeam
                    .filter((m) => m.open > 0 || m.finished > 0)
                    .map((m) => ({
                      label: m.user.fullName,
                      value: m.open,
                      note: m.overdue ? `${m.overdue} late` : undefined,
                      colour: m.overdue ? "#C0392B" : undefined,
                    }))}
                  emptyText="Nobody on the team is carrying open work."
                />
              </Card>
            </div>

            {d.blockers.length > 0 && (
              <Card title={`Blocked (${d.blockers.length})`}>
                <div className="space-y-1.5">
                  {d.blockers.map((b) => (
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
              </Card>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <Card title={`Overdue (${d.lists.overdue.length})`}>
                <WorkListPanel tasks={d.lists.overdue} emptyText="Nothing on this project is late." staleDays={stale} />
              </Card>
              <Card title={`Urgent (${d.lists.urgent.length})`}>
                <WorkListPanel tasks={d.lists.urgent} emptyText="Nothing needs attention today." staleDays={stale} />
              </Card>
            </div>

            <Card title="Raised, finished and open backlog" right={<span className="text-[11px] text-slate-400">last 21 days</span>}>
              <TrendChart points={d.trend} height={150} />
            </Card>

            <div className="grid gap-4 md:grid-cols-2">
              <Card title="Latest progress reports">
                {d.updates.length === 0 ? (
                  <EmptyState>
                    Nothing has been reported at project level yet.{" "}
                    <button className="link" onClick={() => setTab("discussion")}>
                      Post an update
                    </button>
                    .
                  </EmptyState>
                ) : (
                  <div className="space-y-2">
                    {d.updates.map((u) => (
                      <div key={u.id} className="border-l-2 border-indigo-300 pl-3 py-0.5">
                        <div className="text-sm text-slate-700 whitespace-pre-wrap line-clamp-3">{u.body}</div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          {u.author?.fullName ?? "Someone"} &middot; {timeAgo(u.createdAt)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <Card title="Meetings">
                {d.meetings.upcoming.length === 0 && d.meetings.past.length === 0 ? (
                  <EmptyState>No meetings against this project.</EmptyState>
                ) : (
                  <div className="space-y-1.5">
                    {d.meetings.upcoming.map((m) => (
                      <div key={m.id} className="flex items-center gap-2 border border-slate-200 rounded-md px-2.5 py-1.5">
                        {m.mode === "ONLINE" ? (
                          <Video className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        ) : (
                          <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{m.title}</div>
                          <div className="text-[11px] text-slate-500">
                            {fmtDateTime(m.startsAt)}
                            {m.task ? ` \u00b7 ${m.task.title}` : ""}
                          </div>
                        </div>
                        <CalendarClock className="w-3.5 h-3.5 text-slate-300 ml-auto shrink-0" />
                      </div>
                    ))}
                    {d.meetings.past.length > 0 && (
                      <div className="text-[11px] text-slate-400 pt-1">{d.meetings.past.length} past meeting(s)</div>
                    )}
                  </div>
                )}
              </Card>
            </div>
          </div>
        )}

        {/* ---------------- WORK ---------------- */}
        {tab === "work" && (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Card title={`Needs attention (${d.lists.overdue.length + d.lists.urgent.length + d.lists.unassigned.length})`}>
                <div className="space-y-3">
                  <Section title="Overdue" tasks={d.lists.overdue} stale={stale} />
                  <Section title="Urgent" tasks={d.lists.urgent} stale={stale} />
                  <Section title="No lead named" tasks={d.lists.unassigned} stale={stale} />
                  <Section title={`No progress in ${stale} days`} tasks={d.lists.stale} stale={stale} />
                </div>
              </Card>
              <Card title={`Everything on this project (${d.lists.all.length})`}>
                <WorkListPanel tasks={d.lists.all} emptyText="No work items yet." limit={40} staleDays={stale} />
              </Card>
            </div>
            <Card title="By department">
              <BarList
                rows={d.byDepartment.map((x) => ({
                  label: x.name,
                  value: x.open,
                  note: x.overdue ? `${x.overdue} late` : undefined,
                  colour: x.overdue ? "#C0392B" : undefined,
                }))}
                emptyText="No departmental split to show."
              />
            </Card>
          </div>
        )}

        {/* ---------------- TEAM ---------------- */}
        {tab === "team" && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <Card title={`Team (${sortedTeam.length})`} right={<Users className="w-3.5 h-3.5 text-slate-300" />}>
              <div className="space-y-2">
                {sortedTeam.map((m) => (
                  <div key={m.userId} className="flex items-center gap-2 border-b border-slate-100 pb-2 last:border-0">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{m.user.fullName}</div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {m.user.designation?.name ?? m.user.email}
                        {m.user.department ? ` \u00b7 ${m.user.department.name}` : ""}
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500">
                        <span className="tabular-nums">{m.open} open</span>
                        {m.overdue > 0 && <span className="text-red-600 font-semibold tabular-nums">{m.overdue} late</span>}
                        <span className="tabular-nums text-slate-400">{m.finished} done</span>
                        <span className="w-20">
                          <SplitBar
                            segments={[
                              { label: "Late", value: m.overdue, colour: "#C0392B" },
                              { label: "On track", value: Math.max(0, m.open - m.overdue), colour: "#14406E" },
                            ]}
                            height={5}
                          />
                        </span>
                      </div>
                    </div>
                    {canManage ? (
                      <div className="ml-auto flex items-center gap-1.5 shrink-0">
                        <select
                          className="input btn-sm w-36"
                          value={m.role}
                          onChange={(e) => changeRole(m.userId, e.target.value as ProjectRoleKind)}
                          disabled={busy}
                        >
                          {ROLE_ORDER.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABEL[r]}
                            </option>
                          ))}
                        </select>
                        <button className="btn btn-sm btn-danger" onClick={() => removeMember(m.userId, m.user.fullName)} disabled={busy}>
                          Remove
                        </button>
                      </div>
                    ) : (
                      <span className="ml-auto text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 shrink-0">
                        {ROLE_LABEL[m.role]}
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {canManage && (
                <div className="mt-4 pt-3 border-t border-slate-200 flex gap-2 items-end flex-wrap">
                  <div className="grow min-w-[12rem]">
                    <Field label="Add someone from your office">
                      <select className="input" value={addUserId} onChange={(e) => setAddUserId(e.target.value)}>
                        <option value="">Select a person</option>
                        {available.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.fullName}
                            {x.designation ? ` \u2013 ${x.designation.name}` : ""}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <div className="w-40">
                    <Field label="As">
                      <select className="input" value={addRole} onChange={(e) => setAddRole(e.target.value as ProjectRoleKind)}>
                        {ROLE_ORDER.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <Button onClick={addMember} disabled={busy || !addUserId}>
                    Add
                  </Button>
                </div>
              )}
              <p className="text-[11px] text-slate-500 mt-2">
                One primary and one secondary lead at a time; promoting somebody moves the previous holder to Member.
                Observers can read the project and its discussion but cannot post to it.
              </p>
            </Card>

            <Card title="Who is carrying what">
              <BarList
                rows={sortedTeam.map((m) => ({
                  label: m.user.fullName,
                  value: m.open,
                  note: `${ROLE_LABEL[m.role].toLowerCase()}${m.overdue ? `, ${m.overdue} late` : ""}`,
                  colour: m.overdue ? "#C0392B" : undefined,
                }))}
                emptyText="Nobody on the team yet."
              />
            </Card>
          </div>
        )}

        {/* ---------------- DISCUSSION ---------------- */}
        {tab === "discussion" && (
          <Card
            title="Project discussion"
            right={
              <span className="text-[11px] text-slate-400">
                {canContribute ? "Everyone on the project can post here" : "You are an observer: read only"}
              </span>
            }
          >
            <Discussion scope="project" id={id!} onChanged={load} />
          </Card>
        )}

        {/* ---------------- FILES ---------------- */}
        {tab === "files" && (
          <Card title="Project files">
            <Attachments scope="project" id={id!} canUpload={canContribute} offerRollup />
          </Card>
        )}

        {/* ---------------- ACTIVITY ---------------- */}
        {tab === "activity" && (
          <Card title="Everything that has happened on this project">
            {d.activity.length === 0 ? (
              <EmptyState>Nothing recorded yet.</EmptyState>
            ) : (
              <div className="space-y-1.5">
                {d.activity.map((a) => (
                  <div key={a.id} className="flex items-center gap-2 text-sm border-b border-slate-50 pb-1.5 last:border-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0" />
                    <span className="text-slate-700 shrink-0">{a.actor?.fullName ?? "Someone"}</span>
                    <span className="text-slate-500 shrink-0">{describeAction(a.action)}</span>
                    {a.task && (
                      <Link to={`/tasks/${a.task.id}`} className="text-indigo-700 hover:underline truncate">
                        {a.task.title}
                      </Link>
                    )}
                    <span className="ml-auto text-[11px] text-slate-400 shrink-0" title={fmtDateTime(a.createdAt)}>
                      {timeAgo(a.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

function Section({ title, tasks, stale }: { title: string; tasks: ProjectDashboard["lists"]["all"]; stale: number }) {
  if (!tasks.length) return null;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-1.5">
        {title} ({tasks.length})
      </div>
      <WorkListPanel tasks={tasks} emptyText="" limit={8} staleDays={stale} />
    </div>
  );
}
