import { useEffect, useState } from "react";
import { api } from "../api/client";
import { Card, PageHeader, Field, TextInput, Button, ErrorText, EmptyState, SkeletonRows } from "../components/ui";
import { RoleRef, Designation } from "../types";
import { useAuth } from "../auth/AuthContext";

interface PermissionDef {
  id: string;
  key: string;
  description?: string | null;
}

/**
 * Roles and Designations, deliberately on one screen, because the whole point
 * is that they are different things and people conflate them constantly:
 *
 *   Designation = the post someone holds. Descriptive. Grants nothing.
 *   Role        = a bundle of permissions. This is what actually grants power.
 *
 * A DG and an SAO can share the "Office Head" role while holding different
 * posts. Platform templates are maintained by the Super Admin; an office clones
 * one and edits the copy, so two offices can each have a "Reviewer" that means
 * something different.
 */
export default function RolesAndDesignations() {
  const { user } = useAuth();
  const [tab, setTab] = useState<"roles" | "designations">("roles");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Roles & designations"
        subtitle="A role is what someone may DO. A designation is the post they HOLD. Permissions come only from the role."
      />
      <div className="flex gap-2">
        <button
          className={`text-xs px-3 py-1.5 rounded-full border ${tab === "roles" ? "bg-indigo-950 text-white border-indigo-950" : "bg-white text-slate-600 border-slate-200"}`}
          onClick={() => setTab("roles")}
        >
          Roles (permissions)
        </button>
        <button
          className={`text-xs px-3 py-1.5 rounded-full border ${tab === "designations" ? "bg-indigo-950 text-white border-indigo-950" : "bg-white text-slate-600 border-slate-200"}`}
          onClick={() => setTab("designations")}
        >
          Designations (posts)
        </button>
      </div>
      {tab === "roles" ? <RolesPanel myLevel={user?.level ?? 0} /> : <DesignationsPanel />}
    </div>
  );
}

// ===========================================================================

function RolesPanel({ myLevel }: { myLevel: number }) {
  const [roles, setRoles] = useState<RoleRef[] | null>(null);
  const [perms, setPerms] = useState<PermissionDef[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<RoleRef | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);

  async function load() {
    try {
      const [r, p] = await Promise.all([api<RoleRef[]>("/roles"), api<PermissionDef[]>("/roles/permissions")]);
      setRoles(r);
      setPerms(p);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load roles");
      setRoles([]);
    }
  }
  useEffect(() => {
    load();
  }, []);

  function startEdit(role: RoleRef) {
    setEditing(role);
    setSelectedKeys(role.permissions?.map((p) => p.permission.key) ?? []);
  }

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

  const clone = (templateId: string) =>
    run(async () => {
      await api("/roles/clone", { method: "POST", body: JSON.stringify({ templateId }) });
    });

  const save = () =>
    run(async () => {
      if (!editing) return;
      await api(`/roles/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: editing.name,
          description: editing.description ?? undefined,
          permissionKeys: selectedKeys,
        }),
      });
      setEditing(null);
    });

  const remove = (role: RoleRef) => {
    if (!confirm(`Delete the "${role.name}" role?`)) return;
    run(async () => {
      await api(`/roles/${role.id}`, { method: "DELETE" });
    });
  };

  const templates = (roles ?? []).filter((r) => !r.officeId);
  const mine = (roles ?? []).filter((r) => r.officeId);

  return (
    <>
      <ErrorText>{err}</ErrorText>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`Platform templates (${templates.length})`}>
          <p className="text-xs text-slate-500 mb-3">
            Maintained by the Super Admin. Clone one into your office to change what it can do.
          </p>
          {roles === null ? (
            <SkeletonRows count={4} />
          ) : (
            <div className="space-y-2">
              {templates.map((r) => {
                const tooSenior = r.level >= myLevel;
                return (
                  <div key={r.id} className="border border-slate-200 rounded-md px-3 py-2">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium">{r.name}</span>
                      <span className="text-[11px] text-slate-400">level {r.level}</span>
                      <span className="ml-auto text-xs text-slate-400">{r._count?.users ?? 0} users</span>
                    </div>
                    {r.description && <div className="text-xs text-slate-500 mt-0.5">{r.description}</div>}
                    <button
                      className="btn btn-sm mt-2"
                      onClick={() => clone(r.id)}
                      disabled={busy || tooSenior}
                      title={tooSenior ? "This role sits at or above your own level" : "Copy into your office"}
                    >
                      Clone into my office
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card title={`My office's roles (${mine.length})`}>
          {mine.length === 0 ? (
            <EmptyState>No custom roles yet. Clone a template to start.</EmptyState>
          ) : (
            <div className="space-y-2">
              {mine.map((r) => (
                <div key={r.id} className="border border-slate-200 rounded-md px-3 py-2">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium">{r.name}</span>
                    <span className="text-[11px] text-slate-400">level {r.level}</span>
                    <span className="ml-auto text-xs text-slate-400">{r._count?.users ?? 0} users</span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {r.permissions?.length ?? 0} permissions
                    {r.templateId ? " \u00b7 cloned from a template" : ""}
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button className="btn btn-sm" onClick={() => startEdit(r)} disabled={busy}>
                      Edit permissions
                    </button>
                    <button className="btn btn-sm btn-danger" onClick={() => remove(r)} disabled={busy}>
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {editing && (
        <Card title={`Edit "${editing.name}"`}>
          <div className="space-y-3">
            <div className="grid md:grid-cols-2 gap-3">
              <Field label="Role name">
                <TextInput value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </Field>
              <Field label="Description">
                <TextInput
                  value={editing.description ?? ""}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                />
              </Field>
            </div>
            <Field label={`Permissions (${selectedKeys.length} of ${perms.length})`}>
              <div className="border border-slate-200 rounded-md max-h-72 overflow-auto divide-y divide-slate-100">
                {perms.map((p) => (
                  <label key={p.id} className="flex items-start gap-2 px-2.5 py-1.5 text-sm hover:bg-slate-50 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={selectedKeys.includes(p.key)}
                      onChange={() =>
                        setSelectedKeys((prev) =>
                          prev.includes(p.key) ? prev.filter((k) => k !== p.key) : [...prev, p.key]
                        )
                      }
                    />
                    <span>
                      <span className="font-mono text-xs">{p.key}</span>
                      {p.description && <span className="block text-xs text-slate-500">{p.description}</span>}
                    </span>
                  </label>
                ))}
              </div>
            </Field>
            <p className="text-xs text-slate-500">
              This list shows only permissions you hold yourself. You cannot grant what you do not have.
            </p>
            <div className="flex gap-2">
              <Button onClick={save} disabled={busy}>
                Save role
              </Button>
              <button className="btn btn-sm" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </div>
        </Card>
      )}
    </>
  );
}

// ===========================================================================

function DesignationsPanel() {
  const [items, setItems] = useState<Designation[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [rank, setRank] = useState("0");

  async function load() {
    try {
      setItems(await api<Designation[]>("/designations?includeInactive=true"));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load designations");
      setItems([]);
    }
  }
  useEffect(() => {
    load();
  }, []);

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

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api("/designations", {
        method: "POST",
        body: JSON.stringify({ name, code: code || undefined, rank: Number(rank) || 0 }),
      });
      setName("");
      setCode("");
      setRank("0");
    });
  };

  const remove = (d: Designation) => {
    if (!confirm(`Remove "${d.name}"?`)) return;
    run(async () => {
      await api(`/designations/${d.id}`, { method: "DELETE" });
    });
  };

  return (
    <>
      <ErrorText>{err}</ErrorText>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <Card title="Add a designation">
          <form onSubmit={create} className="space-y-3">
            <Field label="Name">
              <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Assistant Audit Officer" required />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Code">
                <TextInput value={code} onChange={(e) => setCode(e.target.value)} placeholder="AAO" />
              </Field>
              <Field label="Rank (0-100)">
                <TextInput type="number" min={0} max={100} value={rank} onChange={(e) => setRank(e.target.value)} />
              </Field>
            </div>
            <Button type="submit" disabled={busy || name.trim().length < 2}>
              Add designation
            </Button>
            <p className="text-xs text-slate-500">
              Rank only orders people in lists and reports. It grants nothing: permissions come from the role.
            </p>
          </form>
        </Card>

        <Card title={`Designations (${items?.length ?? 0})`}>
          {items === null ? (
            <SkeletonRows count={5} />
          ) : (
            <div className="space-y-1.5">
              {items.map((d) => (
                <div key={d.id} className="flex items-center gap-2 text-sm border-b border-slate-100 pb-1.5 last:border-0">
                  <span className="font-medium">{d.name}</span>
                  {d.code && <span className="text-[11px] text-slate-400">{d.code}</span>}
                  {!d.officeId && <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">platform</span>}
                  {d.isActive === false && <span className="text-[11px] text-rose-600">inactive</span>}
                  <span className="ml-auto text-xs text-slate-400">
                    rank {d.rank} \u00b7 {d._count?.users ?? 0} people
                  </span>
                  {d.officeId && (
                    <button className="btn btn-sm btn-danger" onClick={() => remove(d)} disabled={busy}>
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-slate-500 mt-3">
            Platform designations are maintained by the Super Admin. You can add your office's own on top.
          </p>
        </Card>
      </div>
    </>
  );
}
