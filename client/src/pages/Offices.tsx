import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { Card, PageHeader, Field, Button, ErrorText, EmptyState, SkeletonRows } from "../components/ui";
import { Office, Task, Assignment, Person } from "../types";
import { useAuth } from "../auth/AuthContext";
import { fmtDate } from "../lib/format";

/**
 * The inter-office surface. Every office can see the others on the register and
 * who heads them. An office head can pick one of their own work items and ask
 * another office to take it on; that office's head then approves or rejects,
 * and on approval nominates one of their own staff. Nothing moves until they do.
 */
export default function Offices() {
  const { user } = useAuth();
  const [offices, setOffices] = useState<Office[] | null>(null);
  const [outbox, setOutbox] = useState<Assignment[]>([]);
  const [myTasks, setMyTasks] = useState<Task[]>([]);
  const [members, setMembers] = useState<Record<string, Person[]>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);

  const [target, setTarget] = useState<Office | null>(null);
  const [taskId, setTaskId] = useState("");
  const [message, setMessage] = useState("");

  const canRequest = !!user?.permissions?.includes("office.request") || !!user?.headsOfficeIds?.length;

  async function load() {
    try {
      const [o, t, out] = await Promise.all([
        api<Office[]>("/offices"),
        api<Task[]>("/tasks"),
        api<Assignment[]>("/assignments/office-outbox").catch(() => [] as Assignment[]),
      ]);
      setOffices(o);
      setMyTasks(t);
      setOutbox(out);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load the office register");
      setOffices([]);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function openOffice(o: Office) {
    setTarget(o);
    setOk(null);
    setErr(null);
    if (!members[o.id]) {
      try {
        const m = await api<Person[]>(`/offices/${o.id}/members`);
        setMembers((prev) => ({ ...prev, [o.id]: m }));
      } catch {
        /* roster is a nicety, not required to send a request */
      }
    }
  }

  async function sendRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!target || !taskId) return;
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      await api(`/tasks/${taskId}/request-office`, {
        method: "POST",
        body: JSON.stringify({ toOfficeId: target.id, message: message || undefined }),
      });
      setOk(`Request sent to ${target.name}. Their head will approve or reject it.`);
      setMessage("");
      setTaskId("");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not send the request");
    } finally {
      setBusy(false);
    }
  }

  const others = (offices ?? []).filter((o) => o.id !== user?.officeId);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Office register"
        subtitle="Every CAG office on the system, who heads it, and how to route work to it."
      />
      <ErrorText>{err}</ErrorText>
      {ok && <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">{ok}</div>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card title={`Registered offices (${others.length})`}>
          {offices === null ? (
            <SkeletonRows count={3} />
          ) : others.length === 0 ? (
            <EmptyState>No other offices are registered yet.</EmptyState>
          ) : (
            <div className="space-y-2">
              {others.map((o) => (
                <button
                  key={o.id}
                  onClick={() => openOffice(o)}
                  className={`w-full text-left border rounded-md px-3 py-2 transition ${
                    target?.id === o.id ? "border-indigo-400 bg-indigo-50/50" : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{o.name}</span>
                    {o.code && <span className="text-[11px] text-slate-400">{o.code}</span>}
                    <span className="ml-auto text-xs text-slate-400">{o._count?.users ?? 0} staff</span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {o.head ? (
                      <>
                        Head: {o.head.fullName}
                        {o.head.designation ? ` \u2014 ${o.head.designation}` : ""}
                      </>
                    ) : (
                      <span className="text-amber-600">No head appointed. Requests cannot be actioned yet.</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </Card>

        <div className="space-y-4">
          {target && (
            <Card title={`Request work from ${target.name}`}>
              {!canRequest ? (
                <p className="text-sm text-slate-500">
                  Only your office head, or someone granted the &ldquo;send work to another office&rdquo; permission, can raise a
                  request. Ask {user?.officeName ? `the head of ${user.officeName}` : "your office head"} to route this.
                </p>
              ) : !target.head ? (
                <p className="text-sm text-amber-700">
                  {target.name} has no head appointed, so there is nobody to approve a request. Ask the Super Admin to appoint one.
                </p>
              ) : (
                <form onSubmit={sendRequest} className="space-y-3">
                  <Field label="Work item to hand over">
                    <select className="input" value={taskId} onChange={(e) => setTaskId(e.target.value)} required>
                      <option value="">Select one of your work items</option>
                      {myTasks.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.title}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Message to the receiving head">
                    <textarea
                      className="input"
                      rows={3}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="Why this office, what is needed, and by when."
                    />
                  </Field>
                  <Button type="submit" disabled={busy || !taskId}>
                    Send request to {target.head.fullName}
                  </Button>
                  <p className="text-xs text-slate-500">
                    The work item stays with you until {target.name} accepts. On acceptance their head nominates a staff member,
                    who then accepts the work themselves.
                  </p>
                </form>
              )}

              {members[target.id] && members[target.id].length > 0 && (
                <div className="mt-4 pt-3 border-t border-slate-200">
                  <div className="text-xs uppercase tracking-wide text-slate-400 mb-1.5">Staff at this office</div>
                  <div className="text-xs text-slate-600 space-y-0.5 max-h-40 overflow-auto">
                    {members[target.id].map((m) => (
                      <div key={m.id}>
                        {m.fullName}
                        {m.designation ? ` \u2014 ${m.designation}` : ""}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          )}

          <Card title={`Requests my office has sent (${outbox.length})`}>
            {outbox.length === 0 ? (
              <EmptyState>No outgoing requests.</EmptyState>
            ) : (
              <div className="space-y-2">
                {outbox.map((a) => (
                  <div key={a.id} className="border border-slate-200 rounded-md px-3 py-2">
                    <div className="flex items-center gap-2 text-sm">
                      <Link to={`/tasks/${a.task?.id}`} className="font-medium text-indigo-700 hover:underline">
                        {a.task?.title ?? "Work item"}
                      </Link>
                      <span className="text-xs text-slate-400">to {a.toOffice?.name}</span>
                      <span className="ml-auto text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                        {a.state.replace(/_/g, " ").toLowerCase()}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      Sent {fmtDate(a.createdAt)}
                      {a.to ? ` \u00b7 assigned to ${a.to.fullName}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
