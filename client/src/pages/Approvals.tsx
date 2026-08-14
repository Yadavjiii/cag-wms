import { useEffect, useState, ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { Card, Button, ErrorText, PageHeader, EmptyState } from "../components/ui";
import { Assignment, Person } from "../types";
import { useAuth } from "../auth/AuthContext";
import { fmtDate } from "../lib/format";

export default function Approvals() {
  const { user } = useAuth();
  const [approvals, setApprovals] = useState<Assignment[]>([]);
  const [inbox, setInbox] = useState<Assignment[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // For OFFICE-scope requests the approving head must nominate one of their own
  // staff at the moment of approval, so we keep a roster and a per-request pick.
  const [roster, setRoster] = useState<Record<string, Person[]>>({});
  const [nominee, setNominee] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<Record<string, string>>({});

  async function load() {
    try {
      const [a, i] = await Promise.all([
        api<Assignment[]>("/assignments/pending-approvals"),
        api<Assignment[]>("/assignments/my-inbox"),
      ]);
      setApprovals(a);
      setInbox(i);

      // Pre-load the roster for every office we are being asked to staff.
      const officeIds = [...new Set(a.filter((x) => x.scope === "OFFICE" && x.toOffice).map((x) => x.toOffice!.id))];
      const rosters: Record<string, Person[]> = {};
      await Promise.all(
        officeIds.map(async (id) => {
          try {
            rosters[id] = await api<Person[]>(`/offices/${id}/members`);
          } catch {
            rosters[id] = [];
          }
        })
      );
      setRoster((prev) => ({ ...prev, ...rosters }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function act(a: Assignment, action: string) {
    setBusy(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = {};
      if (action === "approve" && a.scope === "OFFICE") {
        const assigneeId = nominee[a.id];
        if (!assigneeId) {
          setErr("Choose a member of your office to carry out this work before approving.");
          setBusy(false);
          return;
        }
        body.assigneeId = assigneeId;
      }
      if (action === "reject" && reason[a.id]) body.reason = reason[a.id];

      await api(`/assignments/${a.id}/${action}`, { method: "POST", body: JSON.stringify(body) });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  function Row({ a, children }: { a: Assignment; children: ReactNode }) {
    const isOffice = a.scope === "OFFICE";
    return (
      <div className={`border rounded-md px-3 py-2 ${isOffice ? "border-indigo-200 bg-indigo-50/30" : "border-slate-200"}`}>
        <div className="flex items-center gap-2 text-sm flex-wrap">
          <Link to={`/tasks/${a.task?.id}`} className="font-medium text-indigo-700 hover:underline">
            {a.task?.title ?? "Work item"}
          </Link>
          {isOffice && (
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800">
              from {a.from?.office?.name ?? "another office"}
            </span>
          )}
          {a.toDepartment && !isOffice && <span className="text-xs text-slate-400">into {a.toDepartment.name}</span>}
          <span className="ml-auto text-xs text-slate-400">{fmtDate(a.createdAt)}</span>
        </div>
        <div className="text-xs text-slate-500 mt-1">
          {a.from?.fullName ?? "Someone"}
          {a.from?.designation ? ` (${a.from.designation.name})` : ""}
          {" \u2192 "}
          {isOffice ? a.toOffice?.name ?? "your office" : a.to?.fullName ?? "someone"}
        </div>
        {a.message && <div className="text-xs text-slate-600 mt-1 italic">&ldquo;{a.message}&rdquo;</div>}
        {children}
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <PageHeader
        title="Approvals & inbox"
        subtitle="Work requests arriving from other offices and departments that need your decision, plus work assigned to you awaiting acceptance."
      />
      <ErrorText>{err}</ErrorText>

      <Card title={`Awaiting my decision (${approvals.length})`}>
        <div className="space-y-2">
          {approvals.length === 0 && <EmptyState>Nothing is waiting on you.</EmptyState>}
          {approvals.map((a) => (
            <Row key={a.id} a={a}>
              {a.scope === "OFFICE" && (
                <div className="mt-2 space-y-2">
                  <label className="block">
                    <span className="text-xs uppercase tracking-wide text-slate-400">
                      Nominate someone from {a.toOffice?.name ?? "your office"} to carry this out
                    </span>
                    <select
                      className="input mt-1"
                      value={nominee[a.id] ?? ""}
                      onChange={(e) => setNominee((p) => ({ ...p, [a.id]: e.target.value }))}
                    >
                      <option value="">Select a staff member</option>
                      {(roster[a.toOffice?.id ?? ""] ?? []).map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.fullName}
                          {m.designation ? ` \u2014 ${m.designation.name}` : ""}
                          {m.department ? ` (${m.department.name})` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <input
                    className="input"
                    placeholder="Reason, if you are rejecting (optional)"
                    value={reason[a.id] ?? ""}
                    onChange={(e) => setReason((p) => ({ ...p, [a.id]: e.target.value }))}
                  />
                </div>
              )}
              <div className="flex gap-2 mt-2">
                <Button onClick={() => act(a, "approve")} disabled={busy}>
                  {a.scope === "OFFICE" ? "Accept & assign" : "Approve"}
                </Button>
                <button className="btn btn-sm" onClick={() => act(a, "reject")} disabled={busy}>
                  Reject
                </button>
              </div>
            </Row>
          ))}
        </div>
      </Card>

      <Card title={`Assigned to me (${inbox.length})`}>
        <div className="space-y-2">
          {inbox.length === 0 && <EmptyState>Nothing waiting for you to accept.</EmptyState>}
          {inbox.map((a) => (
            <Row key={a.id} a={a}>
              <div className="flex gap-2 mt-2">
                <Button onClick={() => act(a, "accept")} disabled={busy}>
                  Accept
                </Button>
                <button className="btn btn-sm" onClick={() => act(a, "decline")} disabled={busy}>
                  Decline
                </button>
              </div>
            </Row>
          ))}
        </div>
      </Card>

      {!!user?.headsOfficeIds?.length && (
        <p className="text-xs text-slate-500">
          You are the head of record for your office, so cross-office requests come to you here.
        </p>
      )}
    </div>
  );
}
