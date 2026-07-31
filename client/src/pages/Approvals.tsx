import { useEffect, useState, ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { Card, Button, ErrorText } from "../components/ui";
import { Assignment } from "../types";
import { fmtDate } from "../lib/format";

export default function Approvals() {
  const [approvals, setApprovals] = useState<Assignment[]>([]);
  const [inbox, setInbox] = useState<Assignment[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [a, i] = await Promise.all([
        api<Assignment[]>("/assignments/pending-approvals"),
        api<Assignment[]>("/assignments/my-inbox"),
      ]);
      setApprovals(a);
      setInbox(i);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function act(id: string, action: string) {
    setBusy(true);
    setErr(null);
    try {
      await api(`/assignments/${id}/${action}`, { method: "POST" });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  function Row({ a, children }: { a: Assignment; children: ReactNode }) {
    return (
      <div className="border border-slate-200 rounded-md px-3 py-2">
        <div className="flex items-center gap-2 text-sm">
          <Link to={`/tasks/${a.task?.id}`} className="font-medium text-indigo-700 hover:underline">
            {a.task?.title ?? "Work item"}
          </Link>
          {a.toDepartment && <span className="text-xs text-slate-400">into {a.toDepartment.name}</span>}
          <span className="ml-auto text-xs text-slate-400">{fmtDate(a.createdAt)}</span>
        </div>
        <div className="text-xs text-slate-500 mt-1">
          {a.from?.fullName ?? "Someone"} &rarr; {a.to?.fullName ?? "Someone"}
          {a.message ? ` \u00b7 "${a.message}"` : ""}
        </div>
        <div className="flex gap-2 mt-2">{children}</div>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h1 className="font-serif text-2xl text-indigo-950">Approvals & inbox</h1>
        <p className="text-sm text-slate-500">Incoming work you need to approve as a department head, and work assigned to you awaiting acceptance.</p>
      </div>
      <ErrorText>{err}</ErrorText>

      <Card title={`Awaiting my approval (${approvals.length})`}>
        <div className="space-y-2">
          {approvals.length === 0 && <div className="text-sm text-slate-400">Nothing awaiting your approval.</div>}
          {approvals.map((a) => (
            <Row key={a.id} a={a}>
              <Button onClick={() => act(a.id, "approve")} disabled={busy}>Approve</Button>
              <button className="btn btn-sm" onClick={() => act(a.id, "reject")} disabled={busy}>Reject</button>
            </Row>
          ))}
        </div>
      </Card>

      <Card title={`Assigned to me (${inbox.length})`}>
        <div className="space-y-2">
          {inbox.length === 0 && <div className="text-sm text-slate-400">Nothing waiting for you to accept.</div>}
          {inbox.map((a) => (
            <Row key={a.id} a={a}>
              <Button onClick={() => act(a.id, "accept")} disabled={busy}>Accept</Button>
              <button className="btn btn-sm" onClick={() => act(a.id, "decline")} disabled={busy}>Decline</button>
            </Row>
          ))}
        </div>
      </Card>
    </div>
  );
}
