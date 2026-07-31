import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Task, TaskStatus, Person, Assignment, RequestState, Attachment, ActivityEntry } from "../types";
import { Card, Button, ErrorText } from "../components/ui";
import { useAuth } from "../auth/AuthContext";
import { api, uploadFile, downloadFile } from "../api/client";
import { rag, ragText, statusLabel, fmtDate, describeAction, fmtDateTime } from "../lib/format";
import { useRealtime } from "../realtime";

const STATUSES: TaskStatus[] = ["YET_TO_BE_ASSIGNED", "INITIATED", "IN_PROGRESS", "FINISHED", "ON_HOLD"];
const stateLabel: Record<RequestState, string> = {
  PENDING_APPROVAL: "Awaiting dept approval",
  PENDING_ACCEPTANCE: "Awaiting acceptance",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};
const stateCls: Record<RequestState, string> = {
  PENDING_APPROVAL: "border-amber-200 text-amber-700 bg-amber-50",
  PENDING_ACCEPTANCE: "border-indigo-200 text-indigo-700 bg-indigo-50",
  ACCEPTED: "border-emerald-200 text-emerald-700 bg-emerald-50",
  DECLINED: "border-slate-200 text-slate-500 bg-slate-50",
  REJECTED: "border-red-200 text-red-700 bg-red-50",
  CANCELLED: "border-slate-200 text-slate-500 bg-slate-50",
};
const input = "w-full border border-slate-200 rounded-md px-3 py-2 text-sm outline-none focus:border-indigo-400";

export default function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const [task, setTask] = useState<Task | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // editable fields
  const [status, setStatus] = useState<TaskStatus>("INITIATED");
  const [pct, setPct] = useState(0);
  const [primaryLeadId, setPrimaryLeadId] = useState("");
  const [secondaryLeadId, setSecondaryLeadId] = useState("");
  const [currentlyWithId, setCurrentlyWithId] = useState("");
  const [dueDate, setDueDate] = useState("");

  // comment box
  const [comment, setComment] = useState("");
  const [authorRole, setAuthorRole] = useState("");

  // assignment workflow
  const { user } = useAuth();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [assignTo, setAssignTo] = useState("");
  const [assignMsg, setAssignMsg] = useState("");

  // documents
  const [files, setFiles] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);

  // activity timeline
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  async function loadActivity() {
    try {
      setActivity(await api<ActivityEntry[]>(`/tasks/${id}/activity`));
    } catch {
      /* ignore */
    }
  }

  async function loadFiles() {
    try {
      setFiles(await api<Attachment[]>(`/tasks/${id}/attachments`));
    } catch {
      /* ignore */
    }
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setErr(null);
    try {
      await uploadFile(`/tasks/${id}/attachments`, file);
      await loadFiles();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function removeFile(attId: string) {
    setErr(null);
    try {
      await api(`/attachments/${attId}`, { method: "DELETE" });
      await loadFiles();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete failed");
    }
  }

  async function download(att: Attachment) {
    try {
      await downloadFile(`/attachments/${att.id}/download`, att.fileName);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Download failed");
    }
  }

  async function loadAssignments() {
    try {
      setAssignments(await api<Assignment[]>(`/tasks/${id}/assignments`));
    } catch {
      /* ignore */
    }
  }

  async function assign() {
    if (!assignTo) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`/tasks/${id}/assign`, { method: "POST", body: JSON.stringify({ toUserId: assignTo, message: assignMsg || undefined }) });
      setAssignTo("");
      setAssignMsg("");
      await load();
      await loadAssignments();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to assign");
    } finally {
      setBusy(false);
    }
  }

  async function act(assignmentId: string, action: string) {
    setBusy(true);
    setErr(null);
    try {
      await api(`/assignments/${assignmentId}/${action}`, { method: "POST" });
      await load();
      await loadAssignments();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function load() {
    const t = await api<Task>(`/tasks/${id}`);
    setTask(t);
    setStatus(t.status);
    setPct(t.pctComplete ?? 0);
    setPrimaryLeadId(t.primaryLead?.id ?? "");
    setSecondaryLeadId(t.secondaryLead?.id ?? "");
    setCurrentlyWithId(t.currentlyWith?.id ?? "");
    setDueDate(t.dueDate ? t.dueDate.slice(0, 10) : "");
  }

  useEffect(() => {
    load().catch((e) => setErr(e instanceof Error ? e.message : "Failed to load"));
    api<Person[]>("/profiles").then(setPeople).catch(() => {});
    loadAssignments();
    loadFiles();
    loadActivity();
  }, [id]);

  useRealtime("task:changed", (p) => {
    if (!p || (p as { taskId?: string }).taskId === id) {
      load();
      loadAssignments();
      loadActivity();
    }
  });

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api<Task>(`/tasks/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status,
          pctComplete: pct,
          primaryLeadId: primaryLeadId || undefined,
          secondaryLeadId: secondaryLeadId || undefined,
          currentlyWithId: currentlyWithId || undefined,
          dueDate: dueDate || undefined,
        }),
      });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  async function addComment(e: React.FormEvent) {
    e.preventDefault();
    if (!comment.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`/tasks/${id}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: comment, authorRole: authorRole || undefined }),
      });
      setComment("");
      setAuthorRole("");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to add remark");
    } finally {
      setBusy(false);
    }
  }

  if (!task) return <div className="text-slate-500">{err ?? "Loading task..."}</div>;

  const r = rag(status, dueDate);
  const peopleOptions = (empty: string) => (
    <>
      <option value="">{empty}</option>
      {people.map((p) => (
        <option key={p.id} value={p.id}>{p.fullName}</option>
      ))}
    </>
  );

  return (
    <div className="space-y-4 max-w-3xl">
      <Link to="/tasks" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft className="w-4 h-4" /> Back to tasks
      </Link>

      <div className="flex items-start gap-3">
        <div>
          <h1 className="text-xl font-serif text-slate-800">{task.title}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{task.description || "No description"}</p>
        </div>
        <span className={`ml-auto text-sm font-semibold ${ragText[r.key]}`}>{r.label}</span>
      </div>

      <ErrorText>{err}</ErrorText>

      <Card title="Details">
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs uppercase tracking-wide text-slate-400">Status</label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={
                    "text-xs px-2.5 py-1 rounded-full border " +
                    (status === s ? "bg-indigo-950 text-white border-indigo-950" : "bg-white border-slate-200 text-slate-600 hover:border-slate-300")
                  }
                >
                  {statusLabel[s]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-slate-400">Completion - {pct}%</label>
            <input type="range" min={0} max={100} step={10} value={pct} onChange={(e) => setPct(Number(e.target.value))} className="w-full mt-2 accent-indigo-700" />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-slate-400">Primary lead</label>
            <select value={primaryLeadId} onChange={(e) => setPrimaryLeadId(e.target.value)} className={`mt-1 ${input}`}>{peopleOptions("Unassigned")}</select>
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-slate-400">Secondary lead</label>
            <select value={secondaryLeadId} onChange={(e) => setSecondaryLeadId(e.target.value)} className={`mt-1 ${input}`}>{peopleOptions("None")}</select>
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-slate-400">Currently with</label>
            <select value={currentlyWithId} onChange={(e) => setCurrentlyWithId(e.target.value)} className={`mt-1 ${input}`}>{peopleOptions("None")}</select>
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-slate-400">Due date</label>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={`mt-1 ${input}`} />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button onClick={save} disabled={busy}>{busy ? "Saving..." : "Save changes"}</Button>
          <span className="text-xs text-slate-400">Assigned {fmtDate(task.assignedDate)} - created by {task.createdBy?.fullName ?? "-"}</span>
        </div>
      </Card>

      <Card title="Assignment & movement">
        <div className="flex flex-wrap items-end gap-2">
          <div className="grow min-w-[12rem]">
            <label className="text-xs uppercase tracking-wide text-slate-400">Assign to</label>
            <select value={assignTo} onChange={(e) => setAssignTo(e.target.value)} className={`mt-1 ${input}`}>
              <option value="">Select a person...</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fullName}
                  {p.designation ? ` (${p.designation})` : ""}
                </option>
              ))}
            </select>
          </div>
          <input value={assignMsg} onChange={(e) => setAssignMsg(e.target.value)} placeholder="Message (optional)" className={`${input} grow`} />
          <Button onClick={assign} disabled={busy || !assignTo}>Assign</Button>
        </div>
        <p className="text-xs text-slate-400 mt-1">
          Assigning into another department needs that department head's approval before it activates.
        </p>

        <div className="mt-4 space-y-2">
          {assignments.length === 0 && <div className="text-sm text-slate-400">No assignment history yet.</div>}
          {assignments.map((a) => (
            <div key={a.id} className="border border-slate-200 rounded-md px-3 py-2">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium text-slate-700">{a.from?.fullName ?? "Someone"}</span>
                <span className="text-slate-400">&rarr;</span>
                <span className="font-medium text-slate-700">{a.to?.fullName ?? "Someone"}</span>
                {a.toDepartment && <span className="text-xs text-slate-400">into {a.toDepartment.name}</span>}
                <span className={`ml-auto text-[11px] px-1.5 py-0.5 rounded-full border ${stateCls[a.state]}`}>{stateLabel[a.state]}</span>
              </div>
              {a.message && <div className="text-xs text-slate-500 mt-1">&ldquo;{a.message}&rdquo;</div>}
              <div className="text-[11px] text-slate-400 mt-1">{fmtDate(a.createdAt)}</div>
              {a.state === "PENDING_ACCEPTANCE" && a.to?.id === user?.id && (
                <div className="flex gap-2 mt-2">
                  <Button onClick={() => act(a.id, "accept")} disabled={busy}>Accept</Button>
                  <button className="btn btn-sm" onClick={() => act(a.id, "decline")} disabled={busy}>Decline</button>
                </div>
              )}
              {(a.state === "PENDING_ACCEPTANCE" || a.state === "PENDING_APPROVAL") && a.from?.id === user?.id && (
                <div className="mt-2">
                  <button className="btn btn-sm" onClick={() => act(a.id, "cancel")} disabled={busy}>Cancel</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card title="Documents">
        <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
          <span className="btn btn-sm">{uploading ? "Uploading..." : "Upload file"}</span>
          <input type="file" className="hidden" onChange={onUpload} disabled={uploading} />
        </label>
        <span className="text-xs text-slate-400 ml-2">Up to 20 MB per file.</span>
        <div className="mt-3 space-y-1.5">
          {files.length === 0 && <div className="text-sm text-slate-400">No documents attached yet.</div>}
          {files.map((f) => (
            <div key={f.id} className="flex items-center gap-2 border border-slate-200 rounded-md px-3 py-1.5 text-sm">
              <button onClick={() => download(f)} className="text-indigo-700 hover:underline text-left truncate">{f.fileName}</button>
              <span className="text-xs text-slate-400 ml-auto shrink-0">{f.uploadedBy?.fullName ?? ""} &middot; {fmtDate(f.createdAt)}</span>
              <button onClick={() => removeFile(f.id)} className="text-xs text-red-600 hover:underline shrink-0">remove</button>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Remarks">
        <div className="space-y-2 mb-3">
          {(task.comments ?? []).length === 0 && <div className="text-sm text-slate-400">No remarks yet.</div>}
          {(task.comments ?? []).map((c) => (
            <div key={c.id} className="border-l-2 border-indigo-200 pl-3 py-1">
              <div className="text-sm text-slate-700">{c.body}</div>
              <div className="text-xs text-slate-400">
                {c.author?.fullName ?? "Someone"}
                {c.authorRole ? ` (${c.authorRole})` : ""} - {fmtDate(c.createdAt)}
              </div>
            </div>
          ))}
        </div>
        <form onSubmit={addComment} className="space-y-2">
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="Add a remark or direction..." className={input} />
          <div className="flex items-center gap-2">
            <input value={authorRole} onChange={(e) => setAuthorRole(e.target.value)} placeholder="Role (optional, e.g. director)" className={`${input} max-w-xs`} />
            <Button type="submit" disabled={busy}>Add remark</Button>
          </div>
        </form>
      </Card>

      <Card title="Activity timeline">
        <div className="space-y-1.5">
          {activity.length === 0 && <div className="text-sm text-slate-400">No activity recorded yet.</div>}
          {activity.map((a) => (
            <div key={a.id} className="text-sm flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0" />
              <span className="text-slate-700">{a.actor?.fullName ?? "Someone"}</span>
              <span className="text-slate-500">{describeAction(a.action)}</span>
              <span className="ml-auto text-xs text-slate-400 shrink-0">{fmtDateTime(a.createdAt)}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
