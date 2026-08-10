import { useEffect, useState } from "react";
import { api } from "../api/client";
import { Card, PageHeader, Field, TextInput, Button, ErrorText, EmptyState, SkeletonRows } from "../components/ui";
import { Office, StaffAccount, CreatedAccount, Person } from "../types";
import { fmtDate } from "../lib/format";
import CredentialSlip from "../components/CredentialSlip";

/**
 * Super Admin console. Two jobs live here and nowhere else:
 *   1. Register a CAG office.
 *   2. Create that office's Office Admin, who then creates their own staff.
 * Appointing the office head (DG / PAG / DAG) also happens here, because the
 * head is who other offices will send their work requests to.
 */
export default function SuperAdmin() {
  const [offices, setOffices] = useState<Office[] | null>(null);
  const [selected, setSelected] = useState<Office | null>(null);
  const [admins, setAdmins] = useState<StaffAccount[]>([]);
  const [members, setMembers] = useState<Person[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<CreatedAccount | null>(null);

  // new office form
  const [oName, setOName] = useState("");
  const [oCode, setOCode] = useState("");
  const [oCity, setOCity] = useState("");

  // new office admin form
  const [aName, setAName] = useState("");
  const [aEmail, setAEmail] = useState("");
  const [aDesignation, setADesignation] = useState("");

  async function loadOffices() {
    try {
      setOffices(await api<Office[]>("/superadmin/offices"));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load offices");
      setOffices([]);
    }
  }
  useEffect(() => {
    loadOffices();
  }, []);

  async function openOffice(o: Office) {
    setSelected(o);
    setIssued(null);
    setErr(null);
    try {
      const [ad, mem] = await Promise.all([
        api<StaffAccount[]>(`/superadmin/offices/${o.id}/admins`),
        api<Person[]>(`/offices/${o.id}/members`),
      ]);
      setAdmins(ad);
      setMembers(mem);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load office");
    }
  }

  async function createOffice(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const office = await api<Office>("/superadmin/offices", {
        method: "POST",
        body: JSON.stringify({ name: oName, code: oCode || undefined, city: oCity || undefined }),
      });
      setOName("");
      setOCode("");
      setOCity("");
      await loadOffices();
      await openOffice(office);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not create the office");
    } finally {
      setBusy(false);
    }
  }

  async function createAdmin(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    setErr(null);
    try {
      const created = await api<CreatedAccount>(`/superadmin/offices/${selected.id}/admins`, {
        method: "POST",
        body: JSON.stringify({
          fullName: aName,
          email: aEmail,
          designation: aDesignation || undefined,
        }),
      });
      setIssued(created);
      setAName("");
      setAEmail("");
      setADesignation("");
      await openOffice(selected);
      await loadOffices();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not create the office admin");
    } finally {
      setBusy(false);
    }
  }

  async function setHead(headId: string) {
    if (!selected) return;
    setBusy(true);
    setErr(null);
    try {
      const updated = await api<Office>(`/superadmin/offices/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({ headId: headId || null }),
      });
      setSelected(updated);
      await loadOffices();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not appoint the head");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(o: Office) {
    setBusy(true);
    setErr(null);
    try {
      await api(`/superadmin/offices/${o.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !o.isActive }) });
      await loadOffices();
      if (selected?.id === o.id) setSelected({ ...o, isActive: !o.isActive });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not update the office");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Offices & office admins"
        subtitle="Register each CAG office, appoint its head, and issue the office admin login that will create the rest of that office's staff."
      />
      <ErrorText>{err}</ErrorText>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="space-y-4">
          <Card title="Register an office">
            <form onSubmit={createOffice} className="space-y-3">
              <Field label="Office name">
                <TextInput value={oName} onChange={(e) => setOName(e.target.value)} placeholder="PAG (Audit) Maharashtra" required />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Code">
                  <TextInput value={oCode} onChange={(e) => setOCode(e.target.value)} placeholder="PAG-MH" />
                </Field>
                <Field label="City">
                  <TextInput value={oCity} onChange={(e) => setOCity(e.target.value)} placeholder="Mumbai" />
                </Field>
              </div>
              <Button type="submit" disabled={busy || oName.trim().length < 2}>
                Register office
              </Button>
            </form>
          </Card>

          <Card title={`Registered offices (${offices?.length ?? 0})`}>
            {offices === null ? (
              <SkeletonRows count={3} />
            ) : offices.length === 0 ? (
              <EmptyState>No offices yet. Register the first one above.</EmptyState>
            ) : (
              <div className="space-y-2">
                {offices.map((o) => (
                  <button
                    key={o.id}
                    onClick={() => openOffice(o)}
                    className={`w-full text-left border rounded-md px-3 py-2 transition ${
                      selected?.id === o.id ? "border-indigo-400 bg-indigo-50/50" : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{o.name}</span>
                      {o.code && <span className="text-[11px] text-slate-400">{o.code}</span>}
                      {!o.isActive && <span className="text-[11px] text-rose-600">inactive</span>}
                      <span className="ml-auto text-xs text-slate-400">{o._count?.users ?? 0} staff</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {o.head ? `Head: ${o.head.fullName}${o.head.designation ? ` (${o.head.designation})` : ""}` : "No head appointed"}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          {!selected ? (
            <Card>
              <EmptyState>Pick an office to manage its head and its admin accounts.</EmptyState>
            </Card>
          ) : (
            <>
              <Card
                title={selected.name}
                right={
                  <button className="btn btn-sm" onClick={() => toggleActive(selected)} disabled={busy}>
                    {selected.isActive ? "Deactivate" : "Reactivate"}
                  </button>
                }
              >
                <Field label="Head of office (approves incoming work requests)">
                  <select className="input" value={selected.head?.id ?? ""} onChange={(e) => setHead(e.target.value)} disabled={busy}>
                    <option value="">Not appointed</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.fullName}
                        {m.designation ? ` \u2014 ${m.designation}` : ""}
                      </option>
                    ))}
                  </select>
                </Field>
                <p className="text-xs text-slate-500 mt-2">
                  Only a member of this office can head it. Create the staff first, then appoint from this list.
                </p>
              </Card>

              <Card title="Create an office admin">
                <form onSubmit={createAdmin} className="space-y-3">
                  <Field label="Full name">
                    <TextInput value={aName} onChange={(e) => setAName(e.target.value)} required />
                  </Field>
                  <Field label="Official email">
                    <TextInput type="email" value={aEmail} onChange={(e) => setAEmail(e.target.value)} placeholder="admin.mh@cag.gov.in" required />
                  </Field>
                  <Field label="Designation">
                    <TextInput value={aDesignation} onChange={(e) => setADesignation(e.target.value)} placeholder="Administrative Officer" />
                  </Field>
                  <Button type="submit" disabled={busy || !aName || !aEmail}>
                    Create login
                  </Button>
                  <p className="text-xs text-slate-500">
                    A temporary password is generated and shown once. The admin must change it at first login.
                  </p>
                </form>
              </Card>

              {issued && <CredentialSlip account={issued} onDismiss={() => setIssued(null)} />}

              <Card title={`Office admins (${admins.length})`}>
                {admins.length === 0 ? (
                  <EmptyState>No admin has been created for this office yet.</EmptyState>
                ) : (
                  <div className="space-y-2">
                    {admins.map((a) => (
                      <div key={a.id} className="border border-slate-200 rounded-md px-3 py-2">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="font-medium">{a.fullName}</span>
                          {!a.isActive && <span className="text-[11px] text-rose-600">deactivated</span>}
                          {a.mustChangePassword && <span className="text-[11px] text-amber-600">password not yet changed</span>}
                          <span className="ml-auto text-xs text-slate-400">
                            {a.lastLoginAt ? `last login ${fmtDate(a.lastLoginAt)}` : "never signed in"}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">{a.email}</div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
