import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertOctagon,
  CornerDownRight,
  Gavel,
  MessageSquare,
  Paperclip,
  Pin,
  PinOff,
  Send,
  TrendingUp,
  X,
} from "lucide-react";
import { api, uploadFile } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Comment, CommentKind, Thread, ThreadScope, Attachment, TaskStatus } from "../types";
import { Button, ErrorText } from "./ui";
import { fmtDateTime, kindAccent, kindChip, kindLabel, statusLabel, timeAgo } from "../lib/format";
import { useRealtime } from "../realtime";
import FileChip from "./FileChip";

/**
 * The discussion thread, for a work item or for a project.
 *
 * One component for both, because the two threads do the same job and any
 * difference between them would be an accident rather than a decision. What
 * scope changes is only the URLs.
 *
 * The composer takes a kind, so a progress update is filed as a progress update
 * rather than as a paragraph that happens to mention a percentage. Files are
 * uploaded before the post is sent and then linked to it, which means a failed
 * post leaves an orphan file on the parent rather than losing somebody's
 * document.
 */

const KINDS: { kind: CommentKind; Icon: React.ElementType; hint: string }[] = [
  { kind: "REMARK", Icon: MessageSquare, hint: "An ordinary comment" },
  { kind: "STATUS_UPDATE", Icon: TrendingUp, hint: "Report where the work has got to" },
  { kind: "DIRECTION", Icon: Gavel, hint: "An instruction to the team" },
  { kind: "DECISION", Icon: Gavel, hint: "Record a decision that was taken" },
  { kind: "BLOCKER", Icon: AlertOctagon, hint: "Something is stopping the work" },
];

const STATUSES: TaskStatus[] = ["YET_TO_BE_ASSIGNED", "INITIATED", "IN_PROGRESS", "FINISHED", "ON_HOLD"];

interface Props {
  scope: ThreadScope;
  id: string;
  /** Current status and completion, so a progress update starts from the truth. */
  currentStatus?: TaskStatus;
  currentPct?: number;
  /** Called after anything that could have moved the parent record. */
  onChanged?: () => void;
  /** Only offered when the server says this person may report progress. */
  canReportProgress?: boolean;
}

export default function Discussion({ scope, id, currentStatus, currentPct, onChanged, canReportProgress }: Props) {
  const { user } = useAuth();
  const [thread, setThread] = useState<Thread | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<CommentKind | "ALL">("ALL");

  // composer
  const [kind, setKind] = useState<CommentKind>("REMARK");
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [status, setStatus] = useState<TaskStatus | "">("");
  const [pct, setPct] = useState<number | "">("");
  const [pending, setPending] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const base = scope === "task" ? `/tasks/${id}` : `/projects/${id}`;
  const postBase = scope === "task" ? "/discussion/task" : "/discussion/project";

  async function load() {
    try {
      setThread(await api<Thread>(`${base}/discussion`));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load the discussion");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, id]);

  useRealtime("discussion:changed", (p) => {
    const payload = p as { scope?: string; id?: string } | undefined;
    if (!payload || (payload.scope === scope && payload.id === id)) load();
  });

  useEffect(() => {
    if (kind === "STATUS_UPDATE") {
      if (status === "" && currentStatus) setStatus(currentStatus);
      if (pct === "" && currentPct !== undefined) setPct(currentPct);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  /** Files go up first; the ids are attached to the post when it is sent. */
  async function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setUploading(true);
    setErr(null);
    try {
      for (const f of files) {
        const uploaded = await uploadFile<Attachment>(`${base}/attachments`, f);
        setPending((prev) => [...prev, uploaded]);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function dropPending(att: Attachment) {
    try {
      await api(`/attachments/${att.id}`, { method: "DELETE" });
    } catch {
      /* the post was never made, so a failure here is not worth reporting */
    }
    setPending((prev) => prev.filter((p) => p.id !== att.id));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`${base}/discussion`, {
        method: "POST",
        body: JSON.stringify({
          body: body.trim(),
          kind,
          parentId: replyTo?.id,
          attachmentIds: pending.map((p) => p.id),
          ...(kind === "STATUS_UPDATE" && scope === "task"
            ? { status: status || undefined, pctComplete: pct === "" ? undefined : Number(pct) }
            : {}),
        }),
      });
      setBody("");
      setReplyTo(null);
      setPending([]);
      setStatus("");
      setPct("");
      setKind("REMARK");
      await load();
      onChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not post that");
    } finally {
      setBusy(false);
    }
  }

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await load();
      onChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That did not work");
    } finally {
      setBusy(false);
    }
  }

  const edit = (post: Comment) => {
    const next = prompt("Edit your post:", post.body);
    if (next === null || !next.trim() || next === post.body) return;
    act(() => api(`${postBase}/${post.id}`, { method: "PATCH", body: JSON.stringify({ body: next.trim() }) }));
  };

  const withdraw = (post: Comment) => {
    if (!confirm("Withdraw this post? It stays in the record as withdrawn, but the text is hidden.")) return;
    act(() => api(`${postBase}/${post.id}`, { method: "DELETE" }));
  };

  const pin = (post: Comment, pinned: boolean) =>
    act(() => api(`${postBase}/${post.id}/pin`, { method: "POST", body: JSON.stringify({ pinned }) }));

  // Replies are nested under their parent; everything else is chronological,
  // newest last, the way a conversation actually reads.
  const tree = useMemo(() => {
    const posts = thread?.posts ?? [];
    const shown = filter === "ALL" ? posts : posts.filter((p) => p.kind === filter);
    const roots = shown.filter((p) => !p.parentId);
    const repliesOf = (pid: string) => posts.filter((p) => p.parentId === pid);
    return roots.map((r) => ({ post: r, replies: repliesOf(r.id) }));
  }, [thread, filter]);

  const counts = useMemo(() => {
    const posts = (thread?.posts ?? []).filter((p) => !p.deletedAt);
    const by = (k: CommentKind) => posts.filter((p) => p.kind === k).length;
    return { all: posts.length, ...({} as Record<string, number>), REMARK: by("REMARK"), STATUS_UPDATE: by("STATUS_UPDATE"), DIRECTION: by("DIRECTION"), DECISION: by("DECISION"), BLOCKER: by("BLOCKER") };
  }, [thread]);

  const mayReportProgress = canReportProgress ?? thread?.canReportProgress ?? false;
  const pinned = (thread?.pinned ?? []).filter((p) => !p.deletedAt);

  return (
    <div className="space-y-3">
      <ErrorText>{err}</ErrorText>

      {pinned.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold flex items-center gap-1">
            <Pin className="w-3 h-3" /> Pinned
          </div>
          {pinned.map((p) => (
            <Post
              key={`pin-${p.id}`}
              post={p}
              meId={user?.id}
              scope={scope}
              compact
              canPin={mayReportProgress}
              onReply={() => setReplyTo(p)}
              onEdit={() => edit(p)}
              onWithdraw={() => withdraw(p)}
              onPin={(v) => pin(p, v)}
            />
          ))}
        </div>
      )}

      {/* Filter chips. The counts are the point: "three blockers" is worth
          seeing before you decide what to read. */}
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          className={`chip btn-sm ${filter === "ALL" ? "active" : ""}`}
          onClick={() => setFilter("ALL")}
        >
          All {counts.all}
        </button>
        {KINDS.map(({ kind: k }) => {
          const n = counts[k] ?? 0;
          if (!n) return null;
          return (
            <button
              key={k}
              type="button"
              className={`chip btn-sm ${filter === k ? "active" : ""}`}
              onClick={() => setFilter(filter === k ? "ALL" : k)}
            >
              {kindLabel[k]} {n}
            </button>
          );
        })}
      </div>

      <div className="space-y-2.5 max-h-[34rem] overflow-auto pr-1">
        {!thread && <div className="text-sm text-slate-400 py-4">Loading the discussion...</div>}
        {thread && tree.length === 0 && (
          <div className="text-sm text-slate-400 py-6 text-center">
            Nothing posted yet. The first update is the useful one.
          </div>
        )}
        {tree.map(({ post, replies }) => (
          <div key={post.id}>
            <Post
              post={post}
              meId={user?.id}
              scope={scope}
              canPin={mayReportProgress}
              onReply={() => setReplyTo(post)}
              onEdit={() => edit(post)}
              onWithdraw={() => withdraw(post)}
              onPin={(v) => pin(post, v)}
            />
            {replies.length > 0 && (
              <div className="ml-6 mt-1.5 space-y-1.5 border-l border-slate-200 pl-3">
                {replies.map((r) => (
                  <Post
                    key={r.id}
                    post={r}
                    meId={user?.id}
                    scope={scope}
                    compact
                    canPin={mayReportProgress}
                    onReply={() => setReplyTo(post)}
                    onEdit={() => edit(r)}
                    onWithdraw={() => withdraw(r)}
                    onPin={(v) => pin(r, v)}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ---- composer ---- */}
      <form onSubmit={submit} className="border-t border-slate-200 pt-3 space-y-2">
        {replyTo && (
          <div className="flex items-center gap-2 text-xs bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1.5">
            <CornerDownRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="text-slate-500 shrink-0">Replying to {replyTo.author?.fullName ?? "someone"}:</span>
            <span className="truncate text-slate-600">{replyTo.body.slice(0, 80)}</span>
            <button type="button" onClick={() => setReplyTo(null)} className="ml-auto text-slate-400 hover:text-slate-700">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className="flex flex-wrap gap-1.5">
          {KINDS.map(({ kind: k, Icon, hint }) => {
            const locked = k === "STATUS_UPDATE" && !mayReportProgress;
            return (
              <button
                key={k}
                type="button"
                title={locked ? "Only the leads, the holder, or someone on the project can report progress" : hint}
                disabled={locked}
                onClick={() => setKind(k)}
                className={
                  "inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border " +
                  (kind === k
                    ? "bg-indigo-950 text-white border-indigo-950"
                    : locked
                      ? "bg-slate-50 text-slate-300 border-slate-200 cursor-not-allowed"
                      : "bg-white border-slate-200 text-slate-600 hover:border-slate-300")
                }
              >
                <Icon className="w-3.5 h-3.5" /> {kindLabel[k]}
              </button>
            );
          })}
        </div>

        {kind === "STATUS_UPDATE" && scope === "task" && (
          <div className="grid sm:grid-cols-2 gap-2 bg-indigo-50/60 border border-indigo-100 rounded-md p-2.5">
            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Move status to</span>
              <select className="input mt-1" value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
                <option value="">Leave unchanged</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {statusLabel[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                Completion {pct === "" ? "(unchanged)" : `- ${pct}%`}
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={pct === "" ? (currentPct ?? 0) : pct}
                onChange={(e) => setPct(Number(e.target.value))}
                className="w-full mt-2.5 accent-indigo-700"
              />
            </label>
          </div>
        )}

        <textarea
          className="input"
          rows={kind === "REMARK" ? 2 : 3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={
            kind === "STATUS_UPDATE"
              ? "What moved, what is left, and anything the team needs to know..."
              : kind === "BLOCKER"
                ? "What is blocking this, and who can unblock it..."
                : kind === "DIRECTION"
                  ? "The instruction, and who it is for..."
                  : "Write a remark..."
          }
        />

        {pending.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {pending.map((att) => (
              <FileChip key={att.id} file={att} onRemove={() => dropPending(att)} />
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <label className="btn btn-sm cursor-pointer">
            <Paperclip className="w-3.5 h-3.5" />
            {uploading ? "Uploading..." : "Attach"}
            <input ref={fileRef} type="file" multiple className="hidden" onChange={onPickFiles} disabled={uploading} />
          </label>
          <span className="text-[11px] text-slate-400">Up to 25 MB per file.</span>
          <Button type="submit" disabled={busy || uploading || !body.trim()} className="ml-auto">
            <Send className="w-3.5 h-3.5" /> {busy ? "Posting..." : "Post"}
          </Button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Post({
  post,
  meId,
  scope,
  compact,
  canPin,
  onReply,
  onEdit,
  onWithdraw,
  onPin,
}: {
  post: Comment;
  meId?: string;
  scope: ThreadScope;
  compact?: boolean;
  canPin?: boolean;
  onReply: () => void;
  onEdit: () => void;
  onWithdraw: () => void;
  onPin: (pinned: boolean) => void;
}) {
  if (post.deletedAt) {
    return (
      <div className="text-xs text-slate-400 italic border-l-2 border-slate-200 pl-3 py-1">
        A post by {post.author?.fullName ?? "someone"} was withdrawn on {fmtDateTime(post.deletedAt)}.
      </div>
    );
  }

  const mine = post.author?.id === meId;
  const m = post.meta;

  return (
    <div className={`bg-white border border-slate-200 border-l-[3px] ${kindAccent[post.kind]} rounded-md px-3 py-2.5`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold text-slate-800">{post.author?.fullName ?? "Someone"}</span>
        {post.authorRole && <span className="text-[11px] text-slate-500">{post.authorRole}</span>}
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-semibold ${kindChip[post.kind]}`}>
          {kindLabel[post.kind]}
        </span>
        {post.isPinned && <Pin className="w-3 h-3 text-amber-600" />}
        <span className="ml-auto text-[11px] text-slate-400" title={fmtDateTime(post.createdAt)}>
          {timeAgo(post.createdAt)}
          {post.editedAt ? " (edited)" : ""}
        </span>
      </div>

      {/* A progress update carries the movement it caused, frozen at the time it
          was written, so the thread still reads correctly later. */}
      {post.kind === "STATUS_UPDATE" && m && (
        <div className="flex items-center gap-2 text-[11px] text-slate-600 mt-1.5 flex-wrap">
          {m.statusFrom && m.statusTo && m.statusFrom !== m.statusTo && (
            <span className="inline-flex items-center gap-1 bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5">
              {statusLabel[m.statusFrom]} <span className="text-slate-400">&rarr;</span>{" "}
              <b className="text-slate-800">{statusLabel[m.statusTo]}</b>
            </span>
          )}
          {m.pctFrom !== undefined && m.pctTo !== undefined && m.pctFrom !== m.pctTo && (
            <span className="inline-flex items-center gap-1 bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5">
              {m.pctFrom}% <span className="text-slate-400">&rarr;</span> <b className="text-slate-800">{m.pctTo}%</b>
            </span>
          )}
        </div>
      )}

      <div className={`text-sm text-slate-700 whitespace-pre-wrap mt-1.5 ${compact ? "" : ""}`}>{post.body}</div>

      {!!post.attachments?.length && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {post.attachments.map((a) => (
            <FileChip key={a.id} file={a} />
          ))}
        </div>
      )}

      <div className="flex items-center gap-3 mt-2 text-[11px]">
        <button type="button" onClick={onReply} className="text-slate-500 hover:text-slate-800">
          Reply
        </button>
        {canPin && (
          <button
            type="button"
            onClick={() => onPin(!post.isPinned)}
            className="text-slate-500 hover:text-slate-800 inline-flex items-center gap-1"
          >
            {post.isPinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
            {post.isPinned ? (post.kind === "BLOCKER" ? "Mark resolved" : "Unpin") : "Pin"}
          </button>
        )}
        {mine && (
          <>
            <button type="button" onClick={onEdit} className="text-slate-500 hover:text-slate-800">
              Edit
            </button>
            <button type="button" onClick={onWithdraw} className="text-rose-600 hover:text-rose-700">
              Withdraw
            </button>
          </>
        )}
      </div>
    </div>
  );
}
