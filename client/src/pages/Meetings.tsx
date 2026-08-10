import { useEffect, useState } from "react";
import { CalendarDays, Download } from "lucide-react";
import { api, downloadFile } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Card, Button, ErrorText } from "../components/ui";
import { Meeting, MeetingMode, Person } from "../types";

const input = "w-full border border-slate-200 rounded-md px-3 py-2 text-sm outline-none focus:border-indigo-400";

export default function Meetings() {
  const { user } = useAuth();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [mode, setMode] = useState<MeetingMode>("PHYSICAL");
  const [location, setLocation] = useState("");
  const [agenda, setAgenda] = useState("");
  const [participantIds, setParticipantIds] = useState<string[]>([]);

  async function load() {
    try {
      const [m, p] = await Promise.all([api<Meeting[]>("/meetings"), api<Person[]>("/profiles")]);
      setMeetings(m);
      setPeople(p);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    }
  }
  useEffect(() => {
    load();
  }, []);

  function toggle(id: string) {
    setParticipantIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function schedule(e: React.FormEvent) {
    e.preventDefault();
    if (!title || !startsAt) return;
    setBusy(true);
    setErr(null);
    try {
      await api("/meetings", {
        method: "POST",
        body: JSON.stringify({
          title,
          agenda: agenda || undefined,
          startsAt: new Date(startsAt).toISOString(),
          mode,
          location: location || undefined,
          participantIds,
        }),
      });
      setTitle("");
      setStartsAt("");
      setLocation("");
      setAgenda("");
      setParticipantIds([]);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to schedule");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setErr(null);
    try {
      await api(`/meetings/${id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to delete");
    }
  }

  async function ics(m: Meeting) {
    try {
      await downloadFile(`/meetings/${m.id}/ics`, `${m.title.replace(/\s+/g, "_")}.ics`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Download failed");
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-serif text-2xl text-indigo-950">Meetings</h1>
        <p className="text-sm text-slate-500">Schedule meetings, invite participants, and download a calendar invite.</p>
      </div>

      <ErrorText>{err}</ErrorText>

      <div className="grid md:grid-cols-2 gap-4">
        <Card title="Schedule a meeting">
          <form onSubmit={schedule} className="space-y-2">
            <input className={input} placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} required />
            <div className="grid grid-cols-2 gap-2">
              <input type="datetime-local" className={input} value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />
              <select className={input} value={mode} onChange={(e) => setMode(e.target.value as MeetingMode)}>
                <option value="PHYSICAL">Physical</option>
                <option value="ONLINE">Online</option>
              </select>
            </div>
            <input className={input} placeholder={mode === "ONLINE" ? "Meeting link" : "Room / location"} value={location} onChange={(e) => setLocation(e.target.value)} />
            <textarea className={input} rows={2} placeholder="Agenda (optional)" value={agenda} onChange={(e) => setAgenda(e.target.value)} />
            <div>
              <label className="text-xs uppercase tracking-wide text-slate-400">Participants</label>
              <div className="mt-1 border border-slate-200 rounded-md max-h-40 overflow-auto p-1">
                {people.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 px-2 py-1 text-sm hover:bg-slate-50 rounded">
                    <input type="checkbox" checked={participantIds.includes(p.id)} onChange={() => toggle(p.id)} />
                    <span>{p.fullName}</span>
                    {p.designation && <span className="text-xs text-slate-400">{p.designation?.name}</span>}
                  </label>
                ))}
              </div>
            </div>
            <Button type="submit" disabled={busy}>{busy ? "Scheduling..." : "Schedule meeting"}</Button>
          </form>
        </Card>

        <Card title={`Upcoming (${meetings.length})`}>
          <div className="space-y-2">
            {meetings.length === 0 && <div className="text-sm text-slate-400 py-4 text-center">No upcoming meetings.</div>}
            {meetings.map((m) => (
              <div key={m.id} className="border border-slate-200 rounded-md px-3 py-2">
                <div className="flex items-center gap-2">
                  <CalendarDays className="w-4 h-4 text-indigo-600 shrink-0" />
                  <span className="font-medium text-slate-700">{m.title}</span>
                  <span className="ml-auto text-[11px] px-1.5 py-0.5 rounded-full border border-slate-200 text-slate-500">{m.mode.toLowerCase()}</span>
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  {new Date(m.startsAt).toLocaleString()}
                  {m.location ? ` \u00b7 ${m.location}` : ""}
                </div>
                <div className="text-xs text-slate-400 mt-0.5">
                  {(m.participants?.length ?? 0)} participant(s) &middot; by {m.createdBy?.fullName ?? "-"}
                  {m.task ? ` \u00b7 re: ${m.task.title}` : ""}
                </div>
                {m.agenda && <div className="text-xs text-slate-500 mt-1">{m.agenda}</div>}
                <div className="flex gap-2 mt-2">
                  <button className="btn btn-sm inline-flex items-center gap-1" onClick={() => ics(m)}>
                    <Download className="w-3.5 h-3.5" /> Calendar invite
                  </button>
                  {m.createdBy?.id === user?.id && (
                    <button className="text-xs text-red-600 hover:underline" onClick={() => remove(m.id)}>Cancel meeting</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
