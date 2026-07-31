import { useEffect, useState } from "react";
import { Plus, Users, ChevronDown, ChevronRight } from "lucide-react";
import { api } from "../api/client";
import { Team, Person } from "../types";
import { Card, Button, ErrorText } from "../components/ui";

const input = "w-full border border-slate-200 rounded-md px-3 py-2 text-sm outline-none focus:border-indigo-400";

export default function Teams() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setTeams(await api<Team[]>("/teams"));
  }
  useEffect(() => {
    load().catch((e) => setErr(e instanceof Error ? e.message : "Failed to load"));
    api<Person[]>("/profiles").then(setPeople).catch(() => {});
  }, []);

  async function createTeam(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api<Team>("/teams", { method: "POST", body: JSON.stringify({ name, description: description || undefined }) });
      setName("");
      setDescription("");
      setShowForm(false);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to create team");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-serif text-slate-800">Teams</h1>
        <Button className="ml-auto flex items-center gap-1" onClick={() => setShowForm((s) => !s)}>
          <Plus className="w-4 h-4" /> New team
        </Button>
      </div>

      <ErrorText>{err}</ErrorText>

      {showForm && (
        <Card>
          <form onSubmit={createTeam} className="space-y-3">
            <div>
              <label className="text-xs uppercase tracking-wide text-slate-400">Team name</label>
              <input required value={name} onChange={(e) => setName(e.target.value)} className={`mt-1 ${input}`} />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-slate-400">Description</label>
              <input value={description} onChange={(e) => setDescription(e.target.value)} className={`mt-1 ${input}`} />
            </div>
            <Button type="submit" disabled={busy}>{busy ? "Creating..." : "Create team"}</Button>
          </form>
        </Card>
      )}

      <div className="space-y-2">
        {teams.length === 0 && <div className="text-sm text-slate-400 py-8 text-center">No teams yet.</div>}
        {teams.map((t) => (
          <TeamRow
            key={t.id}
            team={t}
            people={people}
            open={openId === t.id}
            onToggle={() => setOpenId(openId === t.id ? null : t.id)}
          />
        ))}
      </div>
    </div>
  );
}

function TeamRow({ team, people, open, onToggle }: { team: Team; people: Person[]; open: boolean; onToggle: () => void }) {
  const [detail, setDetail] = useState<Team | null>(null);
  const [userId, setUserId] = useState("");
  const [roleInTeam, setRoleInTeam] = useState("member");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadDetail() {
    setDetail(await api<Team>(`/teams/${team.id}`));
  }
  useEffect(() => {
    if (open && !detail) loadDetail().catch((e) => setErr(e instanceof Error ? e.message : "Failed to load"));
  }, [open]);

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`/teams/${team.id}/members`, { method: "POST", body: JSON.stringify({ userId, roleInTeam }) });
      setUserId("");
      await loadDetail();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to add member");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg">
      <button onClick={onToggle} className="w-full flex items-center gap-3 px-4 py-3 text-left">
        <Users className="w-4 h-4 text-indigo-600" />
        <div className="min-w-0">
          <div className="font-medium text-slate-800">{team.name}</div>
          <div className="text-xs text-slate-500">
            Owner {team.owner?.fullName ?? "-"} - {team._count?.members ?? 0} members - {team._count?.tasks ?? 0} tasks
          </div>
        </div>
        {open ? <ChevronDown className="w-4 h-4 text-slate-400 ml-auto" /> : <ChevronRight className="w-4 h-4 text-slate-400 ml-auto" />}
      </button>

      {open && (
        <div className="border-t border-slate-100 px-4 py-3 space-y-3">
          <ErrorText>{err}</ErrorText>
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">Members</div>
            {!detail && <div className="text-sm text-slate-400">Loading...</div>}
            <div className="space-y-1">
              {detail?.members?.map((m) => (
                <div key={m.userId} className="flex items-center gap-2 text-sm">
                  <span className="text-slate-700">{m.user?.fullName ?? m.userId}</span>
                  <span className="text-xs text-slate-400">{m.roleInTeam}</span>
                  {m.user?.wing && <span className="text-xs text-slate-400">- {m.user.wing}</span>}
                </div>
              ))}
              {detail && (detail.members?.length ?? 0) === 0 && <div className="text-sm text-slate-400">No members.</div>}
            </div>
          </div>

          <form onSubmit={addMember} className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[12rem]">
              <label className="text-xs uppercase tracking-wide text-slate-400">Add member</label>
              <select value={userId} onChange={(e) => setUserId(e.target.value)} className={`mt-1 ${input}`}>
                <option value="">Select a person</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>{p.fullName}</option>
                ))}
              </select>
            </div>
            <select value={roleInTeam} onChange={(e) => setRoleInTeam(e.target.value)} className={`${input} w-32`}>
              <option value="member">Member</option>
              <option value="lead">Lead</option>
              <option value="admin">Admin</option>
            </select>
            <Button type="submit" disabled={busy}>Add</Button>
          </form>
        </div>
      )}
    </div>
  );
}
