import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Card, Button, ErrorText } from "../components/ui";
import { Department, User } from "../types";

const input = "w-full border border-slate-200 rounded-md px-3 py-2 text-sm outline-none focus:border-indigo-400";

export default function Departments() {
  const { user } = useAuth();
  const canManage = !!user?.permissions?.includes("department.manage");

  const [depts, setDepts] = useState<Department[]>([]);
  const [people, setPeople] = useState<User[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [selected, setSelected] = useState<Department | null>(null);

  if (user && !canManage) return <Navigate to="/" replace />;

  async function load() {
    try {
      const [d, u] = await Promise.all([api<Department[]>("/departments"), api<User[]>("/profiles")]);
      setDepts(d);
      setPeople(u);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function openDetail(id: string) {
    try {
      setSelected(await api<Department>(`/departments/${id}`));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load department");
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await api<Department>("/departments", { method: "POST", body: JSON.stringify({ name, code: code || undefined }) });
      setName("");
      setCode("");
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to create");
    }
  }

  async function setHead(deptId: string, headId: string) {
    try {
      await api(`/departments/${deptId}`, { method: "PATCH", body: JSON.stringify({ headId: headId || undefined }) });
      await Promise.all([load(), openDetail(deptId)]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to set head");
    }
  }

  async function addMember(deptId: string, userId: string) {
    if (!userId) return;
    try {
      await api(`/departments/${deptId}/members`, { method: "POST", body: JSON.stringify({ userId }) });
      await openDetail(deptId);
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to add member");
    }
  }

  async function removeMember(deptId: string, userId: string) {
    try {
      await api(`/departments/${deptId}/members/${userId}`, { method: "DELETE" });
      await openDetail(deptId);
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to remove member");
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-serif text-2xl text-indigo-950">Departments & hierarchy</h1>
        <p className="text-sm text-slate-500">Departments, their heads, and members. Heads will approve incoming work once the workflow engine is added.</p>
      </div>

      <ErrorText>{err}</ErrorText>

      <div className="grid md:grid-cols-3 gap-4">
        <Card title="Create department">
          <form onSubmit={create} className="space-y-2">
            <input className={input} placeholder="Name (e.g. IS Wing)" value={name} onChange={(e) => setName(e.target.value)} required />
            <input className={input} placeholder="Code (optional, e.g. IS)" value={code} onChange={(e) => setCode(e.target.value)} />
            <Button type="submit">Create</Button>
          </form>
        </Card>

        <Card title={`Departments (${depts.length})`} className="md:col-span-2">
          <div className="space-y-2">
            {depts.map((d) => (
              <button
                key={d.id}
                onClick={() => openDetail(d.id)}
                className={`w-full text-left border rounded-md px-3 py-2 hover:bg-slate-50 ${
                  selected?.id === d.id ? "border-indigo-300 bg-indigo-50" : "border-slate-200"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium text-slate-700">{d.name}</span>
                  {d.code && <span className="text-xs text-slate-400">{d.code}</span>}
                  <span className="ml-auto text-xs text-slate-400">{d._count?.members ?? 0} members</span>
                </div>
                <div className="text-xs text-slate-500 mt-0.5">Head: {d.head?.fullName ?? "unassigned"}</div>
              </button>
            ))}
            {depts.length === 0 && <div className="text-sm text-slate-400 py-4 text-center">No departments yet.</div>}
          </div>
        </Card>
      </div>

      {selected && (
        <Card title={`Manage: ${selected.name}`}>
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <label className="text-xs uppercase tracking-wide text-slate-400">Department head</label>
              <select className={`${input} mt-1`} value={selected.head?.id ?? ""} onChange={(e) => setHead(selected.id, e.target.value)}>
                <option value="">Unassigned</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName} {p.designation ? `(${p.designation})` : ""}
                  </option>
                ))}
              </select>

              <label className="text-xs uppercase tracking-wide text-slate-400 block mt-4">Add member</label>
              <select
                className={`${input} mt-1`}
                value=""
                onChange={(e) => addMember(selected.id, e.target.value)}
              >
                <option value="">Select a person to add...</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName} {p.designation ? `(${p.designation})` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs uppercase tracking-wide text-slate-400">Members ({selected.members?.length ?? 0})</label>
              <div className="mt-1 space-y-1">
                {selected.members?.map((m) => (
                  <div key={m.id} className="flex items-center gap-2 border border-slate-200 rounded-md px-3 py-1.5 text-sm">
                    <span className="font-medium text-slate-700">{m.fullName}</span>
                    <span className="text-xs text-slate-400">{m.designation}</span>
                    <button className="ml-auto text-xs text-red-600 hover:underline" onClick={() => removeMember(selected.id, m.id)}>
                      remove
                    </button>
                  </div>
                ))}
                {(selected.members?.length ?? 0) === 0 && <div className="text-sm text-slate-400">No members yet.</div>}
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
