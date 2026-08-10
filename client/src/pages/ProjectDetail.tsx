import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { Card, PageHeader, Field, TextInput, Button, ErrorText, EmptyState } from "../components/ui";
import { Project, ProjectRoleKind, ProjectStatus, Person, Task } from "../types";
import { fmtDate } from "../lib/format";

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

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [available, setAvailable] = useState<Person[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  // add-member controls
  const [addUserId, setAddUserId] = useState("");
  const [addRole, setAddRole] = useState<ProjectRoleKind>("MEMBER");

  // edit form
  const [form, setForm] = useState({ name: "", code: "", description: "", status: "ACTIVE" as ProjectStatus, dueDate: "" });

  async function load() {
    try {
      const [p, avail] = await Promise.all([
        api<Project>(`/projects/${id}`),
        api<Person[]>(`/projects/${id}/available-people`).catch(() => [] as Person[]),
      ]);
      setProject(p);
      setAvailable(avail);
      setForm({
        name: p.name,
        code: p.code ?? "",
        description: p.description ?? "",
        status: p.status,
        dueDate: p.dueDate ? p.dueDate.slice(0, 10) : "",
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load the project");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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
      await api(`/projects/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: form.name,
          code: form.code || undefined,
          description: form.description || undefined,
          status: form.status,
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
    run(async () => {
      await api(`/projects/${id}/members/${userId}`, { method: "PATCH", body: JSON.stringify({ role }) });
    });

  const removeMember = (userId: string, name: string) => {
    if (!confirm(`Remove ${name} from this project?`)) return;
    run(async () => {
      await api(`/projects/${id}/members/${userId}`, { method: "DELETE" });
    });
  };

  async function deleteProject() {
    if (!project) return;
    if (!confirm(`Delete "${project.name}"? It is archived, not destroyed, and its work items are kept.`)) return;
    setBusy(true);
    try {
      await api(`/projects/${id}`, { method: "DELETE" });
      navigate("/projects");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not delete the project");
      setBusy(false);
    }
  }

  if (!project) {
    return (
      <div className="space-y-4">
        <ErrorText>{err}</ErrorText>
        {!err && <div className="text-sm text-slate-400">Loading...</div>}
      </div>
    );
  }

  const canManage = project.canManage !== false;
  const sorted = [...project.members].sort(
    (a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.user.fullName.localeCompare(b.user.fullName)
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title={project.name}
        subtitle={[project.code, project.department?.name, STATUS_LABEL[project.status]].filter(Boolean).join(" \u00b7 ")}
        actions={
          canManage ? (
            <div className="flex gap-2">
              <Button onClick={() => setEditing((v) => !v)}>{editing ? "Cancel" : "Edit"}</Button>
              <button className="btn btn-sm btn-danger" onClick={deleteProject} disabled={busy}>
                Delete
              </button>
            </div>
          ) : undefined
        }
      />
      <ErrorText>{err}</ErrorText>

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
            <div className="grid md:grid-cols-2 gap-3">
              <Field label="Status">
                <select
                  className="input"
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value as ProjectStatus })}
                >
                  {(Object.keys(STATUS_LABEL) as ProjectStatus[]).map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
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

      {project.description && !editing && (
        <Card>
          <p className="text-sm text-slate-700 whitespace-pre-wrap">{project.description}</p>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card title={`Team (${project.members.length})`}>
          <div className="space-y-1.5">
            {sorted.map((m) => (
              <div key={m.userId} className="flex items-center gap-2 text-sm border-b border-slate-100 pb-1.5 last:border-0">
                <div className="min-w-0">
                  <div className="font-medium truncate">{m.user.fullName}</div>
                  <div className="text-xs text-slate-500 truncate">
                    {m.user.designation?.name ?? m.user.email}
                    {m.user.department ? ` \u00b7 ${m.user.department.name}` : ""}
                  </div>
                </div>
                {canManage ? (
                  <>
                    <select
                      className="input btn-sm ml-auto w-36"
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
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => removeMember(m.userId, m.user.fullName)}
                      disabled={busy}
                    >
                      Remove
                    </button>
                  </>
                ) : (
                  <span className="ml-auto text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                    {ROLE_LABEL[m.role]}
                  </span>
                )}
              </div>
            ))}
          </div>

          {canManage && (
            <div className="mt-4 pt-3 border-t border-slate-200 flex gap-2 items-end">
              <div className="grow">
                <Field label="Add someone from your office">
                  <select className="input" value={addUserId} onChange={(e) => setAddUserId(e.target.value)}>
                    <option value="">Select a person</option>
                    {available.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.fullName}
                        {p.designation ? ` \u2014 ${p.designation?.name}` : ""}
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
          <p className="text-xs text-slate-500 mt-2">
            There can be one primary and one secondary lead. Promoting someone moves the previous holder to Member.
          </p>
        </Card>

        <Card
          title={`Work items (${project.tasks?.length ?? 0})`}
          right={
            <Link to="/tasks" className="btn btn-sm">
              All work
            </Link>
          }
        >
          {!project.tasks?.length ? (
            <EmptyState>No work items on this project yet.</EmptyState>
          ) : (
            <div className="space-y-2">
              {project.tasks.map((t: Task) => (
                <div key={t.id} className="border border-slate-200 rounded-md px-3 py-2">
                  <div className="flex items-center gap-2 text-sm">
                    <Link to={`/tasks/${t.id}`} className="font-medium text-indigo-700 hover:underline truncate">
                      {t.title}
                    </Link>
                    <span className="ml-auto text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                      {String(t.status).replace(/_/g, " ").toLowerCase()}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {t.primaryLead ? `Lead: ${t.primaryLead.fullName}` : "No lead"}
                    {t.dueDate ? ` \u00b7 due ${fmtDate(t.dueDate)}` : ""}
                    {typeof t.pctComplete === "number" ? ` \u00b7 ${t.pctComplete}%` : ""}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
