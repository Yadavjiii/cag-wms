import { useEffect, useState } from "react";
import { api } from "../api/client";
import { User } from "../types";
import { Card, Button, ErrorText } from "../components/ui";

const input = "w-full border border-slate-200 rounded-md px-3 py-2 text-sm outline-none focus:border-indigo-400";

export default function Profile() {
  const [me, setMe] = useState<User | null>(null);
  const [fullName, setFullName] = useState("");
  const [designation, setDesignation] = useState("");
  const [wing, setWing] = useState("");
  const [cagId, setCagId] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<User>("/profiles/me")
      .then((p) => {
        setMe(p);
        setFullName(p.fullName ?? "");
        setDesignation(p.designation ?? "");
        setWing(p.wing ?? "");
        setCagId(p.cagId ?? "");
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const updated = await api<User>("/profiles/me", {
        method: "PATCH",
        body: JSON.stringify({
          fullName,
          designation: designation || undefined,
          wing: wing || undefined,
          cagId: cagId || undefined,
        }),
      });
      setMe(updated);
      setMsg("Profile saved.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  if (!me) return <div className="text-slate-500">{err ?? "Loading profile..."}</div>;

  return (
    <div className="space-y-4 max-w-xl">
      <h1 className="text-xl font-serif text-slate-800">My profile</h1>
      <ErrorText>{err}</ErrorText>
      {msg && <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">{msg}</div>}

      <Card>
        <form onSubmit={save} className="space-y-3">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <ReadOnly label="Email" value={me.email ?? "-"} />
            <ReadOnly label="Role" value={me.role?.name ?? "-"} />
            <ReadOnly label="Department" value={me.department?.name ?? "-"} />
            <ReadOnly label="Office" value={me.office?.name ?? "Not set"} />
            <ReadOnly label="Unique ID" value={me.id} />
          </div>

          <div>
            <label className="text-xs uppercase tracking-wide text-slate-400">Full name</label>
            <input required value={fullName} onChange={(e) => setFullName(e.target.value)} className={`mt-1 ${input}`} />
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs uppercase tracking-wide text-slate-400">Designation</label>
              <input value={designation} onChange={(e) => setDesignation(e.target.value)} className={`mt-1 ${input}`} />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-slate-400">Wing</label>
              <input value={wing} onChange={(e) => setWing(e.target.value)} className={`mt-1 ${input}`} placeholder="e.g. IS Wing, SAO Commercial" />
            </div>
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-slate-400">CAG / staff ID</label>
            <input value={cagId} onChange={(e) => setCagId(e.target.value)} className={`mt-1 ${input}`} />
          </div>

          <Button type="submit" disabled={busy}>{busy ? "Saving..." : "Save profile"}</Button>
        </form>
      </Card>
    </div>
  );
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-50 rounded-md px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-slate-700 truncate">{value}</div>
    </div>
  );
}
