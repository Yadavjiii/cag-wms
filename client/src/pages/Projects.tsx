import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { Card, PageHeader, Field, TextInput, Button, ErrorText, EmptyState, SkeletonRows } from "../components/ui";
import { Project, ProjectStatus, Person, Department } from "../types";
import { useAuth } from "../auth/AuthContext";
import { fmtDate } from "../lib/format";

const STATUS_LABEL: Record<ProjectStatus, string> = {
  PLANNING: "Planning",
  ACTIVE: "Active",
  ON_HOLD: "On hold",
  COMPLETED: "Completed",
};

const STATUS_CLASS: Record<ProjectStatus, string> = {
  PLANNING: "bg-slate-100 text-slate-600",
  ACTIVE: "bg-emerald-100 text-emerald-700",
  ON_HOLD: "bg-amber-100 text-amber-700",
  COMPLETED: "bg-indigo-100 text-indigo-700",
};

export default function Projects() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);

  // create form
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<ProjectStatus>("ACTIVE");
  const [departmentId, setDepartmentId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [primaryLeadId, setPrimaryLeadId] = useState("");
  const [secondaryLeadId, setSecondaryLeadId] = useState("");
  const [memberIds, setMemberIds] = useState<string[]>([]);

  async function load() {
    try {
      const [p, ppl, d] = await Promise.all([
        api<Project[]>(`/projects?includeArchived=${showArchived}`),
        api<Person[]>("/profiles"),
        api<Department[]>("/departments"),
      ]);
      setProjects(p);
      setPeople(ppl);
      setDepartments(d);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load projects");
      setProjects([]);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived]);

  const active = useMemo(() => (projects ?? []).filter((p) => !p.archivedAt), [projects]);
  const archived = useMemo(() => (projects ?? []).filter((p) => p.archivedAt), [projects]);

  function toggleMember(id: string) {
    setMemberIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function resetForm() {
    setName("");
    setCode("");
    setDescription("");
    setStatus("ACTIVE");
    setDepartmentId("");
    setDueDate("");
    setPrimaryLeadId("");
    setSecondaryLeadId("");
    setMemberIds([]);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api<Project>("/projects", {
        method: "POST",
        body: JSON.stringify({
          name,
          code: code || undefined,
          description: description || undefined,
          status,
          departmentId: departmentId || undefined,
          dueDate: dueDate || undefined,
          primaryLeadId: primaryLeadId || undefined,
          secondaryLeadId: secondaryLeadId || undefined,
          memberIds,
        }),
      });
      resetForm();
      setCreating(false);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not create the project");
    } finally {
      setBusy(false);
    }
  }

  async function archive(p: Project) {
    if (!confirm(`Delete "${p.name}"? It will be archived, and its work items will be kept.`)) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`/projects/${p.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not delete the project");
    } finally {
      setBusy(false);
    }
  }

  async function restore(p: Project) {
    setBusy(true);
    setErr(null);
    try {
      await api(`/projects/${p.id}/restore`, { method: "POST" });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not restore the project");
    } finally {
      setBusy(false);
    }
  }

  function Row({ p }: { p: Project }) {
    const lead = p.members.find((m) => m.role === "PRIMARY_LEAD");
    const second = p.members.find((m) => m.role === "SECONDARY_LEAD");
    return (
      <div className="border border-slate-200 rounded-md px-3 py-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <Link to={`/projects/${p.id}`} className="font-medium text-sm text-indigo-700 hover:underline">
            {p.name}
          </Link>
          {p.code && <span className="text-[11px] text-slate-400">{p.code}</span>}
          <span className={`text-[11px] px-1.5 py-0.5 rounded ${STATUS_CLASS[p.status]}`}>{STATUS_LABEL[p.status]}</span>
          {p.archivedAt && <span className="text-[11px] text-rose-600">deleted</span>}
          <span className="ml-auto text-xs text-slate-400">
            {p._count?.tasks ?? p.tasks?.length ?? 0} work items · {p.members.length} people
          </span>
        </div>
        <div className="text-xs text-slate-500 mt-1">
          {lead ? `Lead: ${lead.user.fullName}` : "No primary lead"}
          {second ? ` · 2nd: ${second.user.fullName}` : ""}
          {p.dueDate ? ` · due ${fmtDate(p.dueDate)}` : ""}
          {p.department ? ` · ${p.department.name}` : ""}
        </div>
        <div className="flex gap-2 mt-2">
          <Link to={`/projects/${p.id}`} className="btn btn-sm">
            Open
          </Link>
          {p.archivedAt ? (
            <button className="btn btn-sm" onClick={() => restore(p)} disabled={busy}>
              Restore
            </button>
          ) : (
            <button className="btn btn-sm btn-danger" onClick={() => archive(p)} disabled={busy}>
              Delete
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Projects"
        subtitle="Each project forms its own working group. Add people, set the leads, and hang work items off it."
        actions={
          <Button onClick={() => setCreating((v) => !v)}>{creating ? "Cancel" : "New project"}</Button>
        }
      />
      <ErrorText>{err}</ErrorText>

      {creating && (
        <Card title="New project">
          <form onSubmit={create} className="space-y-3">
            <div className="grid md:grid-cols-2 gap-3">
              <Field label="Project name">
                <TextInput value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
              </Field>
              <Field label="Code">
                <TextInput value={code} onChange={(e) => setCode(e.target.value)} placeholder="SGPFR-26" />
              </Field>
            </div>
            <Field label="Description">
              <textarea className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <div className="grid md:grid-cols-3 gap-3">
              <Field label="Status">
                <select className="input" value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)}>
                  {(Object.keys(STATUS_LABEL) as ProjectStatus[]).map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Department">
                <select className="input" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                  <option value="">None</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Due date">
                <TextInput type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </Field>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <Field label="Primary lead">
                <select className="input" value={primaryLeadId} onChange={(e) => setPrimaryLeadId(e.target.value)}>
                  <option value="">Unassigned</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.fullName}
                      {p.designation ? ` \u2014 ${p.designation?.name}` : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Secondary lead">
                <select className="input" value={secondaryLeadId} onChange={(e) => setSecondaryLeadId(e.target.value)}>
                  <option value="">Unassigned</option>
                  {people
                    .filter((p) => p.id !== primaryLeadId)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.fullName}
                        {p.designation ? ` \u2014 ${p.designation?.name}` : ""}
                      </option>
                    ))}
                </select>
              </Field>
            </div>
            <Field label={`Team members (${memberIds.length} selected)`}>
              <div className="border border-slate-200 rounded-md max-h-44 overflow-auto divide-y divide-slate-100">
                {people.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 px-2.5 py-1.5 text-sm hover:bg-slate-50 cursor-pointer">
                    <input type="checkbox" checked={memberIds.includes(p.id)} onChange={() => toggleMember(p.id)} />
                    <span>{p.fullName}</span>
                    {p.designation && <span className="text-xs text-slate-400">{p.designation?.name}</span>}
                  </label>
                ))}
              </div>
            </Field>
            <Button type="submit" disabled={busy || name.trim().length < 2}>
              Create project
            </Button>
            <p className="text-xs text-slate-500">Everyone you add is emailed to let them know.</p>
          </form>
        </Card>
      )}

      <Card
        title={`Projects (${active.length})`}
        right={
          <label className="text-xs text-slate-500 flex items-center gap-1.5">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            show deleted
          </label>
        }
      >
        {projects === null ? (
          <SkeletonRows count={4} />
        ) : active.length === 0 ? (
          <EmptyState>No projects yet. Create one to gather a team around a piece of work.</EmptyState>
        ) : (
          <div className="space-y-2">
            {active.map((p) => (
              <Row key={p.id} p={p} />
            ))}
          </div>
        )}
      </Card>

      {showArchived && archived.length > 0 && (
        <Card title={`Deleted (${archived.length})`}>
          <div className="space-y-2">
            {archived.map((p) => (
              <Row key={p.id} p={p} />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
