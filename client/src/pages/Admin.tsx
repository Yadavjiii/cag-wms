import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { api, uploadFile } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useBranding } from "../branding";
import { Card, Button, ErrorText } from "../components/ui";
import { RoleRef } from "../types";

interface AdminUser {
  id: string;
  fullName: string;
  email: string;
  designation?: string | null;
  wing?: string | null;
  role?: RoleRef | null;
  office?: { id: string; name: string } | null;
}

export default function Admin() {
  const { user } = useAuth();
  const { branding, refresh } = useBranding();
  const canOrg = !!user?.permissions?.includes("org.manage");
  const [roles, setRoles] = useState<RoleRef[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  // Org settings form
  const [orgName, setOrgName] = useState(branding.name);
  const [primary, setPrimary] = useState(branding.primaryColor);
  const [accent, setAccent] = useState(branding.accentColor);
  useEffect(() => {
    setOrgName(branding.name);
    setPrimary(branding.primaryColor);
    setAccent(branding.accentColor);
  }, [branding]);

  async function saveOrg() {
    setErr(null);
    try {
      await api("/settings", { method: "PATCH", body: JSON.stringify({ name: orgName, primaryColor: primary, accentColor: accent }) });
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save settings");
    }
  }

  async function uploadLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(null);
    try {
      await uploadFile("/settings/logo", file);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Logo upload failed");
    } finally {
      e.target.value = "";
    }
  }

  // Only users who can manage roles may see this page.
  if (user && !user.permissions?.includes("role.manage")) return <Navigate to="/" replace />;

  async function load() {
    try {
      const [r, u] = await Promise.all([api<RoleRef[]>("/admin/roles"), api<AdminUser[]>("/admin/users")]);
      setRoles(r);
      setUsers(u);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function changeRole(userId: string, roleId: string) {
    setSavingId(userId);
    setErr(null);
    try {
      const updated = await api<AdminUser>(`/admin/users/${userId}/role`, {
        method: "PATCH",
        body: JSON.stringify({ roleId }),
      });
      setUsers((prev) => prev.map((x) => (x.id === userId ? { ...x, role: updated.role } : x)));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to update role");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-serif text-2xl text-indigo-950">Administration</h1>
        <p className="text-sm text-slate-500">
          Designations are free text set by each person. Roles below control what a person can do in the system.
        </p>
      </div>

      <ErrorText>{err}</ErrorText>

      {canOrg && (
        <Card title="Organization (branding)">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div>
                <label className="text-xs uppercase tracking-wide text-slate-400">Organization name</label>
                <input value={orgName} onChange={(e) => setOrgName(e.target.value)} className="mt-1 w-full border border-slate-200 rounded-md px-3 py-2 text-sm outline-none focus:border-indigo-400" />
              </div>
              <div className="flex gap-4">
                <div>
                  <label className="text-xs uppercase tracking-wide text-slate-400">Header colour</label>
                  <input type="color" value={primary} onChange={(e) => setPrimary(e.target.value)} className="mt-1 block h-9 w-16 rounded border border-slate-200" />
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wide text-slate-400">Accent colour</label>
                  <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} className="mt-1 block h-9 w-16 rounded border border-slate-200" />
                </div>
              </div>
              <Button onClick={saveOrg}>Save branding</Button>
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-slate-400">Logo</label>
              <div className="mt-1 flex items-center gap-3">
                {branding.logoUrl ? (
                  <img src={branding.logoUrl} alt="logo" className="h-10 w-auto border border-slate-200 rounded bg-white p-1" />
                ) : (
                  <span className="text-sm text-slate-400">No logo set</span>
                )}
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <span className="btn btn-sm">Upload logo</span>
                  <input type="file" accept="image/*" className="hidden" onChange={uploadLogo} />
                </label>
              </div>
              <p className="text-xs text-slate-400 mt-2">Name, colour, and logo are stored in the database, so this app can be rebranded for another organization without code changes.</p>
            </div>
          </div>
        </Card>
      )}

      <Card title={`Roles (${roles.length})`}>
        <div className="flex flex-wrap gap-2">
          {roles.map((r) => (
            <span key={r.id} className="text-xs px-2.5 py-1 rounded-full border border-slate-200 bg-slate-50 text-slate-600">
              {r.name} <span className="text-slate-400">&middot; level {r.level}</span>
            </span>
          ))}
        </div>
      </Card>

      <Card title={`Users (${users.length})`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 border-b border-slate-100">
                <th className="py-2 pr-3 font-medium">Name</th>
                <th className="py-2 pr-3 font-medium">Designation</th>
                <th className="py-2 pr-3 font-medium">Email</th>
                <th className="py-2 pr-3 font-medium">Role</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-slate-50">
                  <td className="py-2 pr-3 font-medium text-slate-700">{u.fullName}</td>
                  <td className="py-2 pr-3 text-slate-500">{u.designation ?? "-"}</td>
                  <td className="py-2 pr-3 text-slate-500">{u.email}</td>
                  <td className="py-2 pr-3">
                    <select
                      value={u.role?.id ?? ""}
                      disabled={savingId === u.id}
                      onChange={(e) => changeRole(u.id, e.target.value)}
                      className="border border-slate-200 rounded-md px-2 py-1 text-sm outline-none focus:border-indigo-400"
                    >
                      <option value="" disabled>
                        No role
                      </option>
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
