import { useEffect, useState } from "react";
import { api } from "../api/client";
import { Card, PageHeader, Field, TextInput, Button, ErrorText, EmptyState, SkeletonRows } from "../components/ui";
import { Office, StaffAccount, CreatedAccount, CreatedOffice, Person } from "../types";
import { fmtDate } from "../lib/format";
import CredentialSlip from "../components/CredentialSlip";

/**
 * Super Admin console.
 *
 * Registering an office and issuing its login are ONE act: "PAG Hyderabad" is
 * both the office on the register and the account that administers its people.
 * So the form asks for the office name, its mailbox and a password, and out
 * comes a working Office Admin login. That admin then creates their own staff.
 *
 * Appointing the head (DG / PAG / DAG) also happens here, because the head is
 * who other offices send their work requests to.
 */
export default function SuperAdmin() {
  const [offices, setOffices] = useState<Office[] | null>(null);
  const [selected, setSelected] = useState<Office | null>(null);
  const [admins, setAdmins] = useState<StaffAccount[]>([]);
  const [members, setMembers] = useState<Person[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<CreatedAccount | null>(null);

  // One form creates the office and its admin login together.
  const [oName, setOName] = useState("");
  const [oCode, setOCode] = useState("");
  const [oCity, setOCity] = useState("");
  const [oEmail, setOEmail] = useState("");
  const [oPassword, setOPassword] = useState("");

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
      const created = await api<CreatedOffice>("/superadmin/offices", {
        method: "POST",
        body: JSON.stringify({
          name: oName,
          code: oCode || undefined,
          city: oCity || undefined,
          email: oEmail,
          password: oPassword,
        }),
      });
      setIssued({ user: created.admin });
      setOName("");
      setOCode("");
      setOCity("");
      setOEmail("");
      setOPassword("");
      await loadOffices();
      await openOffice(created.office);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not create the office");
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
        subtitle="Create each office with its login in one step, then appoint its head. The office admin creates the rest of that office's staff."
      />
      <ErrorText>{err}</ErrorText>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="space-y-4">
          <Card title="Create an office">
            <form onSubmit={createOffice} className="space-y-3">
              <Field label="Office name">
                <TextInput value={oName} onChange={(e) => setOName(e.target.value)} placeholder="PAG Hyderabad" required />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Code">
                  <TextInput value={oCode} onChange={(e) => setOCode(e.target.value)} placeholder="PAG-HYD" />
                </Field>
                <Field label="City">
                  <TextInput value={oCity} onChange={(e) => setOCity(e.target.value)} placeholder="Hyderabad" />
                </Field>
              </div>
              <Field label="Office email (this becomes the login username)">
                <TextInput
                  type="email"
                  value={oEmail}
                  onChange={(e) => setOEmail(e.target.value)}
                  placeholder="pag.hyderabad@cag.gov.in"
                  required
                />
              </Field>
              <Field label="Password">
                <TextInput
                  type="text"
                  value={oPassword}
                  onChange={(e) => setOPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  required
                />
              </Field>
              <Button type="submit" disabled={busy || oName.trim().length < 2 || !oEmail || oPassword.length < 8}>
                Create office and issue login
              </Button>
              <p className="text-xs text-slate-500">
                This creates the office and its Office Admin login in one step. The account is named after the office and
                exists to manage that office's staff. The credentials are emailed to the address above, and the office can
                change the password once signed in.
              </p>
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
                      {o.email ?? "no mailbox"}
                    </div>
                    <div className="text-xs text-slate-500">
                      {o.head ? `Head: ${o.head.fullName}${o.head.designation ? ` (${o.head.designation.name})` : ""}` : "No head appointed"}
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
                        {m.designation ? ` \u2014 ${m.designation.name}` : ""}
                      </option>
                    ))}
                  </select>
                </Field>
                <p className="text-xs text-slate-500 mt-2">
                  Only a member of this office can head it, so the office admin creates the staff first and you appoint the
                  head from this list. Until a head is appointed, incoming requests from other offices go to the office
                  admin.
                </p>
              </Card>

              {issued && <CredentialSlip account={issued} onDismiss={() => setIssued(null)} />}

              <Card title={`Admin logins (${admins.length})`}>
                {admins.length === 0 ? (
                  <EmptyState>This office has no admin login. That should not happen; contact support.</EmptyState>
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
