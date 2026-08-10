import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { Card, PageHeader, Field, TextInput, Button, ErrorText, EmptyState, SkeletonRows } from "../components/ui";
import { StaffAccount, AssignableRole, CreatedAccount, Department, Designation } from "../types";
import { useAuth } from "../auth/AuthContext";
import { fmtDate } from "../lib/format";
import CredentialSlip from "../components/CredentialSlip";

/**
 * Office Admin console. Creates the logins for one office's staff: DG, DAG,
 * SAOs, AAOs, Senior Auditors, Supervisors, consultants and anyone else. The
 * server pins every action to the admin's own office and refuses to mint an
 * account at or above the admin's own level, so this screen cannot be used to
 * reach into another office or to manufacture a second Super Admin.
 */
export default function Staff() {
  const { user } = useAuth();
  const [staff, setStaff] = useState<StaffAccount[] | null>(null);
  const [roles, setRoles] = useState<AssignableRole[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<CreatedAccount | null>(null);
  const [q, setQ] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<StaffAccount | null>(null);

  // create form
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [designationId, setDesignationId] = useState("");
  const [mobile, setMobile] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [wing, setWing] = useState("");
  const [roleId, setRoleId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [managerId, setManagerId] = useState("");

  async function load() {
    try {
      const [s, r, d, dg] = await Promise.all([
        api<StaffAccount[]>(`/staff?includeInactive=${showInactive}${q ? `&q=${encodeURIComponent(q)}` : ""}`),
        api<AssignableRole[]>("/staff/assignable-roles"),
        api<Department[]>(user?.officeId ? `/departments?officeId=${user.officeId}` : "/departments"),
        api<Designation[]>("/designations"),
      ]);
      setStaff(s);
      setRoles(r);
      setDepartments(d);
      setDesignations(dg);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load the roster");
      setStaff([]);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showInactive]);

  const managers = useMemo(() => (staff ?? []).filter((s) => s.isActive), [staff]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const created = await api<CreatedAccount>("/staff", {
        method: "POST",
        body: JSON.stringify({
          fullName,
          email,
          roleId,
          designationId: designationId || undefined,
          employeeId: employeeId || undefined,
          mobile: mobile || undefined,
          wing: wing || undefined,
          departmentId: departmentId || undefined,
          managerId: managerId || undefined,
        }),
      });
      setIssued(created);
      setFullName("");
      setEmail("");
      setDesignationId("");
      setEmployeeId("");
      setMobile("");
      setWing("");
      setManagerId("");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not create the account");
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`/staff/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          fullName: editing.fullName,
          designation: editing.designation ?? undefined,
          wing: editing.wing ?? undefined,
          roleId: editing.role?.id,
          designationId: editing.designation?.id ?? null,
          departmentId: editing.department?.id ?? null,
          managerId: editing.manager?.id ?? null,
        }),
      });
      setEditing(null);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save changes");
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword(s: StaffAccount) {
    setBusy(true);
    setErr(null);
    try {
      const { temporaryPassword } = await api<{ temporaryPassword: string }>(`/staff/${s.id}/reset-password`, { method: "POST" });
      setIssued({ user: s, temporaryPassword });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not reset the password");
    } finally {
      setBusy(false);
    }
  }

  async function setActive(s: StaffAccount, isActive: boolean) {
    setBusy(true);
    setErr(null);
    try {
      await api(`/staff/${s.id}`, { method: "PATCH", body: JSON.stringify({ isActive }) });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not update the account");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Office staff"
        subtitle={`Create and manage the logins for ${user?.officeName ?? "your office"}. Staff sign in with the credentials you issue here.`}
      />
      <ErrorText>{err}</ErrorText>
      {issued && <CredentialSlip account={issued} onDismiss={() => setIssued(null)} />}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Card title="Create a staff login">
          <form onSubmit={create} className="space-y-3">
            <Field label="Full name">
              <TextInput value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </Field>
            <Field label="Official email (this is their username)">
              <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@cag.gov.in" required />
            </Field>
            <Field label="Role">
              <select className="input" value={roleId} onChange={(e) => setRoleId(e.target.value)} required>
                <option value="">Select a role</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Designation (the post they hold)">
                <select className="input" value={designationId} onChange={(e) => setDesignationId(e.target.value)}>
                  <option value="">Not set</option>
                  {designations.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Employee ID">
                <TextInput value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} placeholder="CAG-0123" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Wing">
                <TextInput value={wing} onChange={(e) => setWing(e.target.value)} placeholder="IS Wing" />
              </Field>
              <Field label="Mobile">
                <TextInput value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="+91 ..." />
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
            </div>
            <Field label="Reports to">
              <select className="input" value={managerId} onChange={(e) => setManagerId(e.target.value)}>
                <option value="">Nobody</option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.fullName}
                    {m.designation ? ` \u2014 ${m.designation}` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Button type="submit" disabled={busy || !fullName || !email || !roleId}>
              Create login
            </Button>
            <p className="text-xs text-slate-500">
              A temporary password is generated and shown once. Hand it to the staff member; they must change it at first sign-in.
            </p>
          </form>
        </Card>

        <Card
          title={`Roster (${staff?.length ?? 0})`}
          right={
            <label className="text-xs text-slate-500 flex items-center gap-1.5">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              show deactivated
            </label>
          }
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              load();
            }}
            className="flex gap-2 mb-3"
          >
            <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, employee ID" />
            <button className="btn btn-sm" type="submit">
              Search
            </button>
          </form>

          {staff === null ? (
            <SkeletonRows count={5} />
          ) : staff.length === 0 ? (
            <EmptyState>No staff accounts yet. Create the first one on the left.</EmptyState>
          ) : (
            <div className="space-y-2">
              {staff.map((s) => (
                <div key={s.id} className="border border-slate-200 rounded-md px-3 py-2">
                  <div className="flex items-center gap-2 text-sm flex-wrap">
                    <span className="font-medium">{s.fullName}</span>
                    {s.role && <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{s.role.name}</span>}
                    {!s.isActive && <span className="text-[11px] text-rose-600">deactivated</span>}
                    {s.mustChangePassword && <span className="text-[11px] text-amber-600">temp password</span>}
                    <span className="ml-auto text-xs text-slate-400">
                      {s.lastLoginAt ? `last login ${fmtDate(s.lastLoginAt)}` : "never signed in"}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {s.email}
                    {s.designation ? ` \u00b7 ${s.designation.name}` : ""}
                    {s.department ? ` \u00b7 ${s.department.name}` : ""}
                    {s.manager ? ` \u00b7 reports to ${s.manager.fullName}` : ""}
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button className="btn btn-sm" onClick={() => setEditing(s)} disabled={busy}>
                      Edit
                    </button>
                    <button className="btn btn-sm" onClick={() => resetPassword(s)} disabled={busy}>
                      Reset password
                    </button>
                    {s.isActive ? (
                      <button className="btn btn-sm btn-danger" onClick={() => setActive(s, false)} disabled={busy}>
                        Deactivate
                      </button>
                    ) : (
                      <button className="btn btn-sm" onClick={() => setActive(s, true)} disabled={busy}>
                        Reactivate
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {editing && (
        <Card title={`Edit ${editing.fullName}`}>
          <form onSubmit={saveEdit} className="grid gap-3 md:grid-cols-2">
            <Field label="Full name">
              <TextInput value={editing.fullName} onChange={(e) => setEditing({ ...editing, fullName: e.target.value })} />
            </Field>
            <Field label="Designation">
              <select
                className="input"
                value={editing.designation?.id ?? ""}
                onChange={(e) => {
                  const d = designations.find((x) => x.id === e.target.value);
                  setEditing({ ...editing, designation: d ?? null });
                }}
              >
                <option value="">Not set</option>
                {designations.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Role">
              <select
                className="input"
                value={editing.role?.id ?? ""}
                onChange={(e) => {
                  const r = roles.find((x) => x.id === e.target.value);
                  setEditing({ ...editing, role: r ? { id: r.id, name: r.name, level: r.level } : null });
                }}
              >
                <option value="">Unchanged</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Department">
              <select
                className="input"
                value={editing.department?.id ?? ""}
                onChange={(e) => {
                  const d = departments.find((x) => x.id === e.target.value);
                  setEditing({ ...editing, department: d ? { id: d.id, name: d.name } : null });
                }}
              >
                <option value="">None</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Reports to">
              <select
                className="input"
                value={editing.manager?.id ?? ""}
                onChange={(e) => {
                  const m = managers.find((x) => x.id === e.target.value);
                  setEditing({ ...editing, manager: m ? { id: m.id, fullName: m.fullName } : null });
                }}
              >
                <option value="">Nobody</option>
                {managers
                  .filter((m) => m.id !== editing.id)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.fullName}
                    </option>
                  ))}
              </select>
            </Field>
            <div className="md:col-span-2 flex gap-2">
              <Button type="submit" disabled={busy}>
                Save
              </Button>
              <button type="button" className="btn btn-sm" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
