import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Clock,
  History,
  MapPin,
  Trash2,
  Users,
  Video,
} from "lucide-react";
import { api } from "../api/client";
import {
  ActivityEntry,
  Assignment,
  Person,
  RequestState,
  Task,
  TaskDashboard,
  TaskPriority,
  TaskStatus,
} from "../types";
import { Button, Card, EmptyState, ErrorText, Field, PageHeader, Skeleton, Tabs } from "../components/ui";
import { BarList, Kpi, Ring, statusColour } from "../components/charts";
import Discussion from "../components/Discussion";
import Attachments from "../components/Attachments";
import ProjectPanel from "../components/ProjectPanel";
import { useAuth } from "../auth/AuthContext";
import {
  describeAction,
  fmtDate,
  fmtDateTime,
  priorityChip,
  priorityLabel,
  rag,
  ragText,
  statusLabel,
  timeAgo,
} from "../lib/format";
import { useRealtime } from "../realtime";

const STATUSES: TaskStatus[] = ["YET_TO_BE_ASSIGNED", "INITIATED", "IN_PROGRESS", "FINISHED", "ON_HOLD"];
const PRIORITIES: TaskPriority[] = ["LOW", "NORMAL", "HIGH", "URGENT"];

const stateLabel: Record<RequestState, string> = {
  PENDING_APPROVAL: "Awaiting dept approval",
  PENDING_ACCEPTANCE: "Awaiting acceptance",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};
const stateCls: Record<RequestState, string> = {
  PENDING_APPROVAL: "border-amber-200 text-amber-700 bg-amber-50",
  PENDING_ACCEPTANCE: "border-indigo-200 text-indigo-700 bg-indigo-50",
  ACCEPTED: "border-emerald-200 text-emerald-700 bg-emerald-50",
  DECLINED: "border-slate-200 text-slate-500 bg-slate-50",
  REJECTED: "border-red-200 text-red-700 bg-red-50",
  CANCELLED: "border-slate-200 text-slate-500 bg-slate-50",
};

type Tab = "overview" | "discussion" | "files" | "assignment" | "activity";

/**
 * One work item, in full.
 *
 * The page used to be a single column of eight stacked cards, which meant the
 * discussion (the part people actually come here for) sat below the fold under
 * three forms. Tabs put the conversation one click from the top and leave the
 * overview free to answer "where is this and is it in trouble" at a glance.
 */
export default function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [tab, setTab] = useState<Tab>("overview");
  const [data, setData] = useState<TaskDashboard | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The edit form, seeded from the item every time it reloads.
  const [form, setForm] = useState({
    status: "INITIATED" as TaskStatus,
    priority: "NORMAL" as TaskPriority,
    pct: 0,
    primaryLeadId: "",
    secondaryLeadId: "",
    currentlyWithId: "",
    dueDate: "",
  });

  // Assignment controls
  const [assignTo, setAssignTo] = useState("");
  const [assignMsg, setAssignMsg] = useState("");

  async function load() {
    const d = await api<TaskDashboard>(`/tasks/${id}/dashboard`);
    setData(d);
    setForm({
      status: d.task.status,
      priority: d.task.priority ?? "NORMAL",
      pct: d.task.pctComplete ?? 0,
      primaryLeadId: d.task.primaryLead?.id ?? "",
      secondaryLeadId: d.task.secondaryLead?.id ?? "",
      currentlyWithId: d.task.currentlyWith?.id ?? "",
      dueDate: d.task.dueDate ? d.task.dueDate.slice(0, 10) : "",
    });
  }

  async function loadAssignments() {
    try {
      setAssignments(await api<Assignment[]>(`/tasks/${id}/assignments`));
    } catch {
      /* the movement history is not worth failing the page over */
    }
  }

  async function loadActivity() {
    try {
      setActivity(await api<ActivityEntry[]>(`/tasks/${id}/activity`));
    } catch {
      /* ditto */
    }
  }

  useEffect(() => {
    setData(null);
    load().catch((e) => setErr(e instanceof Error ? e.message : "Failed to load this work item"));
    api<Person[]>("/profiles").then(setPeople).catch(() => {});
    loadAssignments();
    loadActivity();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useRealtime("task:changed", (p) => {
    if (!p || (p as { taskId?: string }).taskId === id) {
      load().catch(() => {});
      loadAssignments();
      loadActivity();
    }
  });

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    run(async () => {
      await api(`/tasks/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: form.status,
          priority: form.priority,
          pctComplete: form.pct,
          primaryLeadId: form.primaryLeadId || undefined,
          secondaryLeadId: form.secondaryLeadId || undefined,
          currentlyWithId: form.currentlyWithId || undefined,
          dueDate: form.dueDate || undefined,
        }),
      });
      await loadActivity();
    });

  const assign = () =>
    run(async () => {
      await api(`/tasks/${id}/assign`, {
        method: "POST",
        body: JSON.stringify({ toUserId: assignTo, message: assignMsg || undefined }),
      });
      setAssignTo("");
      setAssignMsg("");
      await loadAssignments();
    });

  const act = (assignmentId: string, action: string) =>
    run(async () => {
      await api(`/assignments/${assignmentId}/${action}`, { method: "POST" });
      await loadAssignments();
    });

  async function deleteTask() {
    if (!data) return;
    if (!confirm(`Delete "${data.task.title}"? It is archived rather than destroyed, and can be restored.`)) return;
    try {
      await api(`/tasks/${id}`, { method: "DELETE" });
      navigate("/tasks");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not delete this work item");
    }
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <ErrorText>{err}</ErrorText>
        {!err && (
          <>
            <Skeleton className="h-9 w-72" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-20" />
              ))}
            </div>
            <Skeleton className="h-64" />
          </>
        )}
      </div>
    );
  }

  const { task, health, counts } = data;
  const r = rag(task.status, task.dueDate);
  const peopleOptions = (empty: string) => (
    <>
      <option value="">{empty}</option>
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.fullName}
          {p.designation ? ` (${p.designation.name})` : ""}
        </option>
      ))}
    </>
  );

  return (
    <div className="space-y-4">
      <Link to="/tasks" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft className="w-4 h-4" /> Back to work items
      </Link>

      <PageHeader
        title={task.title}
        subtitle={
          [
            task.project ? `Project: ${task.project.name}` : null,
            statusLabel[task.status],
            `${task.pctComplete ?? 0}% complete`,
            task.dueDate ? `due ${fmtDate(task.dueDate)}` : "no due date",
          ]
            .filter(Boolean)
            .join(" \u00b7 ")
        }
        actions={
          <div className="flex items-center gap-2">
            <span className={`text-sm font-semibold ${ragText[r.key]}`}>{r.label}</span>
            {data.canEdit && (
              <button
                onClick={deleteTask}
                title="Delete this work item"
                className="flex items-center gap-1 text-xs px-2 py-1.5 rounded border border-slate-200 text-slate-500 hover:border-rose-300 hover:text-rose-600 hover:bg-rose-50"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
            )}
          </div>
        }
      />

      {task.archivedAt && (
        <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
          This work item was deleted. It is kept for the audit trail and can be restored from the work list.
        </div>
      )}

      {/* Anything actively blocking the work outranks every other panel. */}
      {data.openBlockers.map((b) => (
        <div key={b.id} className="flex gap-2.5 text-sm bg-rose-50 border border-rose-200 rounded-lg px-3.5 py-3">
          <AlertOctagon className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <div className="font-semibold text-rose-800">Blocked</div>
            <div className="text-rose-900 whitespace-pre-wrap">{b.body}</div>
            <div className="text-[11px] text-rose-600 mt-1">
              {b.author?.fullName ?? "Someone"} &middot; {timeAgo(b.createdAt)}. Clear it from the Discussion tab once
              it is resolved.
            </div>
          </div>
        </div>
      ))}

      <ErrorText>{err}</ErrorText>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi
          label="Completion"
          value={`${task.pctComplete ?? 0}%`}
          tone={(task.pctComplete ?? 0) >= 100 ? "green" : "navy"}
          Icon={CheckCircle2}
        />
        <Kpi
          label={health.overdue ? "Overdue by" : "Due in"}
          value={health.daysToDue === null ? "-" : `${Math.abs(health.daysToDue)}d`}
          tone={health.overdue ? "red" : health.daysToDue !== null && health.daysToDue <= 3 ? "amber" : "plain"}
          Icon={Clock}
          hint={task.dueDate ? fmtDate(task.dueDate) : "No due date set"}
        />
        <Kpi label="Age" value={`${health.ageDays}d`} hint="Since it was raised" Icon={History} />
        <Kpi
          label="Last reported"
          value={health.daysSinceUpdate === 0 ? "Today" : `${health.daysSinceUpdate}d ago`}
          tone={health.stale ? "amber" : "plain"}
          hint={health.stale ? `Stale after ${health.staleAfterDays} days` : undefined}
          Icon={AlertTriangle}
        />
        <Kpi label="Discussion" value={counts.posts} hint={`${counts.updates} progress update(s)`} Icon={Users} />
      </div>

      <Tabs<Tab>
        tabs={[
          { key: "overview", label: "Overview" },
          { key: "discussion", label: "Discussion", count: counts.posts, badge: counts.blockers ? "red" : undefined },
          { key: "files", label: "Files", count: counts.files },
          { key: "assignment", label: "Assignment", count: counts.handovers },
          { key: "activity", label: "Activity", count: counts.activity },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Card title="Details">
              {task.description && (
                <p className="text-sm text-slate-700 whitespace-pre-wrap mb-4 pb-4 border-b border-slate-100">
                  {task.description}
                </p>
              )}

              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs uppercase tracking-wide text-slate-400">Status</label>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {STATUSES.map((s) => (
                      <button
                        key={s}
                        type="button"
                        disabled={!data.canReportProgress}
                        onClick={() => setForm({ ...form, status: s })}
                        className={
                          "text-xs px-2.5 py-1 rounded-full border disabled:opacity-50 " +
                          (form.status === s
                            ? "bg-[color:var(--brand)] text-white border-[color:var(--brand)]"
                            : "bg-white border-slate-200 text-slate-600 hover:border-slate-300")
                        }
                      >
                        {statusLabel[s]}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs uppercase tracking-wide text-slate-400">Priority</label>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {PRIORITIES.map((p) => (
                      <button
                        key={p}
                        type="button"
                        disabled={!data.canEdit}
                        onClick={() => setForm({ ...form, priority: p })}
                        className={
                          "text-xs px-2.5 py-1 rounded-full border disabled:opacity-50 " +
                          (form.priority === p
                            ? priorityChip[p] + " ring-1 ring-offset-1 ring-slate-300"
                            : "bg-white border-slate-200 text-slate-600 hover:border-slate-300")
                        }
                      >
                        {priorityLabel[p]}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="md:col-span-2">
                  <label className="text-xs uppercase tracking-wide text-slate-400">
                    Completion &mdash; {form.pct}%
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    disabled={!data.canReportProgress}
                    value={form.pct}
                    onChange={(e) => setForm({ ...form, pct: Number(e.target.value) })}
                    className="w-full mt-2 accent-[color:var(--brand)]"
                  />
                </div>

                <Field label="Primary lead">
                  <select
                    className="input"
                    disabled={!data.canEdit}
                    value={form.primaryLeadId}
                    onChange={(e) => setForm({ ...form, primaryLeadId: e.target.value })}
                  >
                    {peopleOptions("Unassigned")}
                  </select>
                </Field>
                <Field label="Secondary lead">
                  <select
                    className="input"
                    disabled={!data.canEdit}
                    value={form.secondaryLeadId}
                    onChange={(e) => setForm({ ...form, secondaryLeadId: e.target.value })}
                  >
                    {peopleOptions("None")}
                  </select>
                </Field>
                <Field label="Currently with">
                  <select
                    className="input"
                    disabled={!data.canEdit}
                    value={form.currentlyWithId}
                    onChange={(e) => setForm({ ...form, currentlyWithId: e.target.value })}
                  >
                    {peopleOptions("None")}
                  </select>
                </Field>
                <Field label="Due date">
                  <input
                    type="date"
                    className="input"
                    disabled={!data.canEdit}
                    value={form.dueDate}
                    onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                  />
                </Field>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button onClick={save} disabled={busy || (!data.canEdit && !data.canReportProgress)}>
                  {busy ? "Saving..." : "Save changes"}
                </Button>
                <button className="btn btn-sm" onClick={() => setTab("discussion")}>
                  Report progress with a note
                </button>
                <span className="text-xs text-slate-400">
                  Raised {fmtDate(task.createdAt)} by {task.createdBy?.fullName ?? "-"}
                </span>
              </div>
              {!data.canEdit && !data.canReportProgress && (
                <p className="text-xs text-slate-500 mt-2">
                  You can read this item and post on its thread, but not change its fields. Ask a lead to add you to
                  the project if you need to report on it.
                </p>
              )}
            </Card>

            <div className="space-y-4">
              <Card title="Progress">
                <div className="flex items-center gap-4">
                  <Ring
                    value={task.pctComplete ?? 0}
                    label="done"
                    sublabel={statusLabel[task.status]}
                  />
                  <div className="text-xs text-slate-500 space-y-1 min-w-0">
                    <div>
                      Lead: <b className="text-slate-700">{task.primaryLead?.fullName ?? "nobody yet"}</b>
                    </div>
                    <div>
                      With: <b className="text-slate-700">{task.currentlyWith?.fullName ?? "nobody"}</b>
                    </div>
                    {data.lastUpdate ? (
                      <div>
                        Last reported {timeAgo(data.lastUpdate.createdAt)} by{" "}
                        {data.lastUpdate.author?.fullName ?? "someone"}
                      </div>
                    ) : (
                      <div className="text-amber-700">No progress has ever been reported on this item.</div>
                    )}
                  </div>
                </div>
              </Card>

              <Card title="Time in each state">
                <BarList
                  rows={data.timeInStatus.map((s) => ({
                    label: statusLabel[s.status as TaskStatus] ?? s.status,
                    value: Math.round(s.days),
                    colour: statusColour[s.status],
                    note: `${s.days}d`,
                  }))}
                  emptyText="No movement recorded yet."
                />
              </Card>

              <Card title={`Who has worked on this (${data.contributors.length})`}>
                {data.contributors.length === 0 ? (
                  <EmptyState>Nobody has posted on this item yet.</EmptyState>
                ) : (
                  <div className="space-y-1.5">
                    {data.contributors.map((c) => (
                      <div key={c.id} className="flex items-center gap-2 text-sm">
                        <span className="truncate">{c.name}</span>
                        <span className="ml-auto text-xs text-slate-400 shrink-0">
                          {c.posts} post{c.posts === 1 ? "" : "s"} &middot; {timeAgo(c.lastAt)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          </div>

          {data.meetings.upcoming.length > 0 && (
            <Card title="Upcoming meetings on this item">
              <div className="space-y-1.5">
                {data.meetings.upcoming.map((m) => (
                  <div key={m.id} className="flex items-center gap-2 text-sm border border-slate-200 rounded-md px-3 py-2">
                    <CalendarClock className="w-4 h-4 text-slate-400 shrink-0" />
                    <span className="font-medium truncate">{m.title}</span>
                    <span className="text-xs text-slate-500 flex items-center gap-1 shrink-0">
                      {m.mode === "ONLINE" ? <Video className="w-3 h-3" /> : <MapPin className="w-3 h-3" />}
                      {m.mode === "ONLINE" ? "Online" : m.location ?? "Venue TBC"}
                    </span>
                    <span className="ml-auto text-xs text-slate-400 shrink-0">{fmtDateTime(m.startsAt)}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <ProjectPanel task={task} onChanged={load} />
        </div>
      )}

      {tab === "discussion" && (
        <Discussion
          scope="task"
          id={task.id}
          currentStatus={task.status}
          currentPct={task.pctComplete ?? 0}
          canReportProgress={data.canReportProgress}
          onChanged={load}
        />
      )}

      {tab === "files" && <Attachments scope="task" id={task.id} canUpload />}

      {tab === "assignment" && (
        <Card title="Assignment and movement">
          {data.canEdit && (
            <>
              <div className="flex flex-wrap items-end gap-2">
                <div className="grow min-w-[12rem]">
                  <Field label="Hand this to">
                    <select className="input" value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
                      {peopleOptions("Select a person...")}
                    </select>
                  </Field>
                </div>
                <input
                  value={assignMsg}
                  onChange={(e) => setAssignMsg(e.target.value)}
                  placeholder="Message (optional)"
                  className="input grow"
                />
                <Button onClick={assign} disabled={busy || !assignTo}>
                  Assign
                </Button>
              </div>
              <p className="text-xs text-slate-400 mt-1 mb-4">
                Assigning into another department needs that department head's approval before it activates.
              </p>
            </>
          )}

          <div className="space-y-2">
            {assignments.length === 0 && <EmptyState>This work item has not moved between people yet.</EmptyState>}
            {assignments.map((a) => (
              <div key={a.id} className="border border-slate-200 rounded-md px-3 py-2">
                <div className="flex items-center gap-2 text-sm flex-wrap">
                  <span className="font-medium text-slate-700">{a.from?.fullName ?? "Someone"}</span>
                  <span className="text-slate-400">&rarr;</span>
                  <span className="font-medium text-slate-700">
                    {a.to?.fullName ?? a.toOffice?.name ?? a.toDepartment?.name ?? "Someone"}
                  </span>
                  {a.toDepartment && <span className="text-xs text-slate-400">into {a.toDepartment.name}</span>}
                  <span className={`ml-auto text-[11px] px-1.5 py-0.5 rounded-full border ${stateCls[a.state]}`}>
                    {stateLabel[a.state]}
                  </span>
                </div>
                {a.message && <div className="text-xs text-slate-500 mt-1">&ldquo;{a.message}&rdquo;</div>}
                <div className="text-[11px] text-slate-400 mt-1">{fmtDateTime(a.createdAt)}</div>
                {a.state === "PENDING_ACCEPTANCE" && a.to?.id === user?.id && (
                  <div className="flex gap-2 mt-2">
                    <Button size="sm" onClick={() => act(a.id, "accept")} disabled={busy}>
                      Accept
                    </Button>
                    <button className="btn btn-sm" onClick={() => act(a.id, "decline")} disabled={busy}>
                      Decline
                    </button>
                  </div>
                )}
                {(a.state === "PENDING_ACCEPTANCE" || a.state === "PENDING_APPROVAL") && a.from?.id === user?.id && (
                  <div className="mt-2">
                    <button className="btn btn-sm" onClick={() => act(a.id, "cancel")} disabled={busy}>
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === "activity" && (
        <Card title="Activity timeline">
          {activity.length === 0 ? (
            <EmptyState>Nothing has been recorded against this item yet.</EmptyState>
          ) : (
            <div className="space-y-1.5">
              {activity.map((a) => (
                <div key={a.id} className="text-sm flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0" />
                  <span className="text-slate-700">{a.actor?.fullName ?? "Someone"}</span>
                  <span className="text-slate-500 truncate">{describeAction(a.action)}</span>
                  <span className="ml-auto text-xs text-slate-400 shrink-0" title={fmtDateTime(a.createdAt)}>
                    {timeAgo(a.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
