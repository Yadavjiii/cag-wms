import { useEffect, useState } from "react";
import { api } from "../api/client";
import { Card, Field, TextInput, Button, ErrorText } from "./ui";
import { Task, Office, Person, Project } from "../types";
import { useAuth } from "../auth/AuthContext";

/**
 * The project side of a work item: the team working on it, the primary and
 * secondary lead, and the option to hand the whole thing to another CAG office.
 * Every part of this stays editable while the work is open, which is the point:
 * teams get reshuffled and leads change without recreating the work item.
 */
export default function ProjectPanel({ task, onChanged }: { task: Task; onChanged: () => void }) {
  const { user } = useAuth();
  const [people, setPeople] = useState<Person[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [offices, setOffices] = useState<Office[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // team controls

  // lead controls
  const [primaryLeadId, setPrimaryLeadId] = useState(task.primaryLead?.id ?? "");
  const [secondaryLeadId, setSecondaryLeadId] = useState(task.secondaryLead?.id ?? "");

  // cross-office routing
  const [toOfficeId, setToOfficeId] = useState("");
  const [requestMessage, setRequestMessage] = useState("");

  const canRouteOutward = !!user?.permissions?.includes("office.request") || !!user?.headsOfficeIds?.length;

  useEffect(() => {
    (async () => {
      try {
        const [p, o, pr] = await Promise.all([
          api<Person[]>(`/tasks/${task.id}/assignable-people`),
          api<Office[]>("/offices"),
          api<Project[]>("/projects").catch(() => [] as Project[]),
        ]);
        setPeople(p);
        setOffices(o);
        setProjects(pr);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Failed to load project options");
      }
    })();
  }, [task.id]);

  useEffect(() => {
    setPrimaryLeadId(task.primaryLead?.id ?? "");
    setSecondaryLeadId(task.secondaryLead?.id ?? "");
  }, [task.primaryLead?.id, task.secondaryLead?.id]);

  async function run(fn: () => Promise<void>, success?: string) {
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      await fn();
      if (success) setOk(success);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const saveLeads = () =>
    run(async () => {
      await api(`/tasks/${task.id}/leads`, {
        method: "PATCH",
        body: JSON.stringify({ primaryLeadId: primaryLeadId || null, secondaryLeadId: secondaryLeadId || null }),
      });
    }, "Leads updated.");





  const requestOffice = () =>
    run(async () => {
      await api(`/tasks/${task.id}/request-office`, {
        method: "POST",
        body: JSON.stringify({ toOfficeId, message: requestMessage || undefined }),
      });
      setRequestMessage("");
      setToOfficeId("");
    }, "Request sent. The receiving office's head will approve or reject it.");

  const otherOffices = offices.filter((o) => o.id !== user?.officeId);

  return (
    <Card title="Project team & routing">
      <ErrorText>{err}</ErrorText>
      {ok && <div className="text-sm text-emerald-700 mb-2">{ok}</div>}

      {/* ---------------- Leads ---------------- */}
      <div className="grid md:grid-cols-2 gap-3">
        <Field label="Primary lead">
          <select className="input" value={primaryLeadId} onChange={(e) => setPrimaryLeadId(e.target.value)}>
            <option value="">Unassigned</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName}
                {p.designation ? ` \u2014 ${p.designation}` : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Secondary lead">
          <select className="input" value={secondaryLeadId} onChange={(e) => setSecondaryLeadId(e.target.value)}>
            <option value="">Unassigned</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName}
                {p.designation ? ` \u2014 ${p.designation}` : ""}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="mt-2">
        <Button size="sm" onClick={saveLeads} disabled={busy}>
          Save leads
        </Button>
      </div>

      {/* ---------------- Project ---------------- */}
      <div className="mt-5 pt-4 border-t border-slate-200">
        <Field label="Part of project">
          <select
            className="input"
            value={task.projectId ?? ""}
            onChange={(e) =>
              run(async () => {
                await api(`/tasks/${task.id}/project`, {
                  method: "PATCH",
                  body: JSON.stringify({ projectId: e.target.value || null }),
                });
              }, "Project updated.")
            }
            disabled={busy}
          >
            <option value="">Not part of a project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {/* ---------------- Cross-office routing ---------------- */}
      {canRouteOutward && otherOffices.length > 0 && (
        <div className="mt-5 pt-4 border-t border-slate-200 space-y-3">
          <div className="text-xs uppercase tracking-wide text-slate-400">Hand this work to another office</div>
          <Field label="Office">
            <select className="input" value={toOfficeId} onChange={(e) => setToOfficeId(e.target.value)}>
              <option value="">Select an office</option>
              {otherOffices.map((o) => (
                <option key={o.id} value={o.id} disabled={!o.head}>
                  {o.name}
                  {o.head ? ` \u2014 ${o.head.fullName}` : " (no head appointed)"}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Message to the receiving head">
            <textarea
              className="input"
              rows={2}
              value={requestMessage}
              onChange={(e) => setRequestMessage(e.target.value)}
              placeholder="What is needed and why this office."
            />
          </Field>
          <Button size="sm" onClick={requestOffice} disabled={busy || !toOfficeId}>
            Send request
          </Button>
          <p className="text-xs text-slate-500">
            The work item stays with you until that office's head accepts and nominates one of their staff.
          </p>
        </div>
      )}
    </Card>
  );
}
