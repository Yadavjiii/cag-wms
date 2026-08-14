import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Paperclip, Upload } from "lucide-react";
import { api, uploadFile } from "../api/client";
import { Attachment, ThreadScope } from "../types";
import { Button, EmptyState, ErrorText } from "./ui";
import { fmtDate, fmtSize } from "../lib/format";
import FileChip from "./FileChip";
import { useRealtime } from "../realtime";

/**
 * The file list for a work item or a project.
 *
 * Files pinned to a single post in the discussion are not listed here by
 * default. They belong to the conversation that produced them, and folding them
 * in turns the file list into a pile within a fortnight. The toggle is there for
 * the moment somebody genuinely needs "every file anyone has ever attached".
 */
export default function Attachments({
  scope,
  id,
  canUpload = true,
  /** Projects can roll up the files from all their work items. */
  offerRollup = false,
}: {
  scope: ThreadScope;
  id: string;
  canUpload?: boolean;
  offerRollup?: boolean;
}) {
  const [files, setFiles] = useState<Attachment[] | null>(null);
  const [all, setAll] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const base = scope === "task" ? `/tasks/${id}` : `/projects/${id}`;

  async function load() {
    try {
      setFiles(await api<Attachment[]>(`${base}/attachments${all ? "?all=true" : ""}`));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load the files");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, id, all]);

  useRealtime(scope === "task" ? "task:changed" : "project:changed", () => load());

  async function send(list: File[]) {
    if (!list.length) return;
    setUploading(true);
    setErr(null);
    try {
      for (const f of list) await uploadFile<Attachment>(`${base}/attachments`, f);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove(att: Attachment) {
    if (!confirm(`Remove "${att.fileName}"?`)) return;
    setErr(null);
    try {
      await api(`/attachments/${att.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not remove that file");
    }
  }

  const totalSize = (files ?? []).reduce((a, f) => a + (f.size ?? 0), 0);

  return (
    <div className="space-y-3">
      <ErrorText>{err}</ErrorText>

      {canUpload && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            send(Array.from(e.dataTransfer.files));
          }}
          className={`border-2 border-dashed rounded-lg px-4 py-5 text-center transition-colors ${
            dragging ? "border-indigo-400 bg-indigo-50/50" : "border-slate-200"
          }`}
        >
          <Upload className="w-5 h-5 mx-auto text-slate-300" />
          <p className="text-sm text-slate-600 mt-1.5">
            Drop files here, or{" "}
            <button type="button" className="link" onClick={() => inputRef.current?.click()}>
              browse
            </button>
            .
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Up to 25 MB each. Executables and scripts are refused.
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            disabled={uploading}
            onChange={(e) => send(Array.from(e.target.files ?? []))}
          />
          {uploading && <p className="text-xs text-indigo-700 mt-1.5">Uploading...</p>}
        </div>
      )}

      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Paperclip className="w-3.5 h-3.5" />
        <span>
          {files?.length ?? 0} file{files?.length === 1 ? "" : "s"}
          {totalSize > 0 ? `, ${fmtSize(totalSize)}` : ""}
        </span>
        {offerRollup && (
          <label className="ml-auto inline-flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
            Include files from every work item
          </label>
        )}
      </div>

      {files && files.length === 0 && <EmptyState>No files attached yet.</EmptyState>}

      <div className="space-y-1.5">
        {(files ?? []).map((f) => (
          <div key={f.id} className="flex items-center gap-2 flex-wrap border-b border-slate-100 pb-1.5 last:border-0">
            <FileChip file={f} onRemove={() => remove(f)} />
            <span className="text-[11px] text-slate-400">
              {f.uploadedBy?.fullName ?? "Unknown"} &middot; {fmtDate(f.createdAt)}
            </span>
            {f.task && (
              <Link to={`/tasks/${f.task.id}`} className="text-[11px] text-indigo-700 hover:underline truncate">
                {f.task.title}
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
