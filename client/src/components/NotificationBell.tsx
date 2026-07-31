import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useRealtime } from "../realtime";
import { AppNotification } from "../types";

export default function NotificationBell() {
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const nav = useNavigate();

  async function loadCount() {
    try {
      const r = await api<{ count: number }>("/notifications/unread-count");
      setCount(r.count);
    } catch {
      /* ignore */
    }
  }
  async function loadItems() {
    try {
      setItems(await api<AppNotification[]>("/notifications"));
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    loadCount();
    const t = setInterval(loadCount, 30000);
    return () => clearInterval(t);
  }, []);

  useRealtime("notification", () => {
    loadCount();
    if (open) loadItems();
  });

  useEffect(() => {
    if (open) loadItems();
  }, [open]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  async function openItem(n: AppNotification) {
    try {
      await api(`/notifications/${n.id}/read`, { method: "PATCH" });
    } catch {
      /* ignore */
    }
    setOpen(false);
    loadCount();
    const taskId = n.payload?.taskId;
    if (taskId) nav(`/tasks/${taskId}`);
  }

  async function markAll() {
    try {
      await api("/notifications/read-all", { method: "POST" });
    } catch {
      /* ignore */
    }
    setItems((prev) => prev.map((i) => ({ ...i, isRead: true })));
    setCount(0);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        className="relative flex items-center justify-center w-8 h-8 rounded-md text-white hover:bg-white/10"
      >
        <Bell className="w-4 h-4" />
        {count > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] leading-none px-1.5 py-0.5 rounded-full">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white border border-slate-200 rounded-lg shadow-lg z-50 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 text-sm">
            <span className="font-semibold text-slate-700">Notifications</span>
            <button className="text-xs text-indigo-700 hover:underline" onClick={markAll}>
              Mark all read
            </button>
          </div>
          <div className="max-h-96 overflow-auto">
            {items.length === 0 && <div className="text-sm text-slate-400 px-3 py-6 text-center">No notifications.</div>}
            {items.map((n) => (
              <button
                key={n.id}
                onClick={() => openItem(n)}
                className={`w-full text-left px-3 py-2 border-b border-slate-50 hover:bg-slate-50 ${n.isRead ? "" : "bg-indigo-50/50"}`}
              >
                <div className="text-sm font-medium text-slate-700 flex items-center gap-2">
                  {!n.isRead && <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 shrink-0" />}
                  {n.payload?.title ?? n.kind}
                </div>
                {n.payload?.body && <div className="text-xs text-slate-500 mt-0.5">{n.payload.body}</div>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
