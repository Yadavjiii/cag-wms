import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, ChevronRight, Trash2, RotateCcw } from "lucide-react";
import { api } from "../api/client";
import { Task, TaskStatus, TaskPriority, Person, Project } from "../types";
import { Card, Button, ErrorText } from "../components/ui";
import { rag, ragText, ragBorder, statusLabel, statusChip, fmtDate } from "../lib/format";

const STATUSES: TaskStatus[] = ["YET_TO_BE_ASSIGNED", "INITIATED", "IN_PROGRESS", "FINISHED", "ON_HOLD"];
const PRIORITIES: TaskPriority[] = ["LOW", "NORMAL", "HIGH", "URGENT"];

export default function Tasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [filter, setFilter] = useState<TaskStatus | "ALL">("ALL");
  const [projectFilter, setProjectFilter] = useState("");
  const [mine, setMine] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    const qs = new URLSearchParams();
    if (filter !== "ALL") qs.set("status", filter);
    if (mine) qs.set("mine", "true");
    if (projectFilter) qs.set("projectId", projectFilter);
    if (showDeleted) qs.set("includeArchived", "true");
    const list = await api<Task[]>(`/tasks?${qs.toString()}`);
    setTasks(list);
  }

  useEffect(() => {
    load().catch((e) => setErr(e instanceof Error ? e.message : "Failed to load"));
  }, [filter, mine, projectFilter, showDeleted]);

  useEffect(() => {
    api<Person[]>("/profiles").then(setPeople).catch(() => {});
    api<Project[]>("/projects").then(setProjects).catch(() => {});
  }, []);

  /** Deleting archives the work item. It stays recoverable via "show deleted". */
  async function remove(e: React.MouseEvent, t: Task) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete "${t.title}"? It is archived, not destroyed, and can be restored.`)) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`/tasks/${t.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setErr(err instanceof Error ? err.message : "Could not delete");
    } finally {
      setBusy(false);
    }
  }

  async function restore(e: React.MouseEvent, t: Task) {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    setErr(null);
    try {
      await api(`/tasks/${t.id}/restore`, { method: "POST" });
      await load();
    } catch (err) {
      setErr(err instanceof Error ? err.message : "Could not restore");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-serif text-slate-800">Tasks</h1>
        <Button className="ml-auto flex items-center gap-1" onClick={() => setShowForm((s) => !s)}>
          <Plus className="w-4 h-4" /> New task
        </Button>
      </div>

      <ErrorText>{err}</ErrorText>

      {showForm && (
        <NewTaskForm
          people={people}
          projects={projects}
          onCreated={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <Chip active={filter === "ALL"} onClick={() => setFilter("ALL")}>
          All
        </Chip>
        {STATUSES.map((s) => (
          <Chip key={s} active={filter === s} onClick={() => setFilter(s)}>
            {statusLabel[s]}
          </Chip>
        ))}
        <select
          className="ml-auto text-xs border border-slate-200 rounded-md px-2 py-1.5 outline-none focus:border-indigo-400"
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
        >
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only mine
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} /> Show deleted
        </label>
      </div>

      <div className="space-y-2">
        {tasks.length === 0 && <div className="text-sm text-slate-400 py-8 text-center">No tasks yet.</div>}
        {tasks.map((t) => {
          const r = rag(t.status, t.dueDate);
          return (
            <Link
              key={t.id}
              to={`/tasks/${t.id}`}
              className={`block bg-white border border-slate-200 border-l-4 ${ragBorder[r.key]} rounded-lg px-3 py-2.5 hover:shadow-sm hover:border-slate-300`}
            >
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-800 truncate">{t.title}</span>
                    <span className={`text-[11px] px-1.5 py-0.5 rounded border ${statusChip[t.status]}`}>
                      {statusLabel[t.status]}
                    </span>
                    {t.archivedAt && <span className="text-[11px] text-rose-600">deleted</span>}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-500">
                    <span>PL <b className="text-slate-700">{t.primaryLead?.fullName ?? "-"}</b></span>
                    <span>with <b className="text-slate-700">{t.currentlyWith?.fullName ?? "-"}</b></span>
                    <span>due {fmtDate(t.dueDate)}</span>
                    {t.project && <span className="text-indigo-600">{t.project.name}</span>}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className={`text-xs font-semibold ${ragText[r.key]}`}>{r.label}</span>
                  {t.pctComplete != null && (
                    <div className="w-20 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-indigo-500" style={{ width: `${t.pctComplete}%` }} />
                    </div>
                  )}
                </div>
                {t.archivedAt ? (
                  <button
                    onClick={(e) => restore(e, t)}
                    disabled={busy}
                    title="Restore"
                    className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-emerald-600"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    onClick={(e) => remove(e, t)}
                    disabled={busy}
                    title="Delete"
                    className="p-1.5 rounded hover:bg-rose-50 text-slate-300 hover:text-rose-600"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
                <ChevronRight className="w-4 h-4 text-slate-300" />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={
        "text-xs px-3 py-1.5 rounded-full border " +
        (active ? "bg-indigo-950 text-white border-indigo-950" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300")
      }
    >
      {children}
    </button>
  );
}

function NewTaskForm({ people, projects, onCreated }: { people: Person[]; projects: Project[]; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("NORMAL");
  const [primaryLeadId, setPrimaryLeadId] = useState("");
  const [secondaryLeadId, setSecondaryLeadId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api<Task>("/tasks", {
        method: "POST",
        body: JSON.stringify({
          title,
          description: description || undefined,
          priority,
          primaryLeadId: primaryLeadId || undefined,
          secondaryLeadId: secondaryLeadId || undefined,
          projectId: projectId || undefined,
          currentlyWithId: primaryLeadId || undefined,
          dueDate: dueDate || undefined,
        }),
      });
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to create");
    } finally {
      setBusy(false);
    }
  }

  const input = "w-full border border-slate-200 rounded-md px-3 py-2 text-sm outline-none focus:border-indigo-400";

  return (
    <Card>
      <form onSubmit={submit} className="grid md:grid-cols-2 gap-3">
        <ErrorText>{err}</ErrorText>
        <div className="md:col-span-2">
          <label className="text-xs uppercase tracking-wide text-slate-400">Title</label>
          <input required value={title} onChange={(e) => setTitle(e.target.value)} className={`mt-1 ${input}`} />
        </div>
        <div className="md:col-span-2">
          <label className="text-xs uppercase tracking-wide text-slate-400">Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={`mt-1 ${input}`} />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-slate-400">Primary lead</label>
          <select value={primaryLeadId} onChange={(e) => setPrimaryLeadId(e.target.value)} className={`mt-1 ${input}`}>
            <option value="">Unassigned</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>{p.fullName}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-slate-400">Secondary lead</label>
          <select value={secondaryLeadId} onChange={(e) => setSecondaryLeadId(e.target.value)} className={`mt-1 ${input}`}>
            <option value="">None</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>{p.fullName}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-slate-400">Project</label>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={`mt-1 ${input}`}>
            <option value="">None</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-slate-400">Priority</label>
          <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} className={`mt-1 ${input}`}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-slate-400">Due date</label>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={`mt-1 ${input}`} />
        </div>
        <div className="md:col-span-2">
          <Button type="submit" disabled={busy}>{busy ? "Creating..." : "Create task"}</Button>
        </div>
      </form>
    </Card>
  );
}
