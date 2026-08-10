import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { Card, PageHeader, ErrorText, EmptyState } from "../components/ui";
import { CalendarEvent } from "../types";

const KIND_CLASS: Record<CalendarEvent["kind"], string> = {
  task: "bg-indigo-100 text-indigo-800 border-indigo-200",
  project: "bg-amber-100 text-amber-800 border-amber-200",
  meeting: "bg-emerald-100 text-emerald-800 border-emerald-200",
};

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
}
function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function key(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * One month grid plus an agenda list, fed by a single /api/calendar call that
 * merges work item due dates, project deadlines and meetings. Weeks start on
 * Monday, which is how office calendars here are usually read.
 */
export default function Calendar() {
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<Date | null>(new Date());

  useEffect(() => {
    (async () => {
      setEvents(null);
      try {
        const from = startOfMonth(cursor).toISOString();
        const to = endOfMonth(cursor).toISOString();
        setEvents(await api<CalendarEvent[]>(`/calendar?from=${from}&to=${to}`));
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Failed to load the calendar");
        setEvents([]);
      }
    })();
  }, [cursor]);

  // Bucket events by calendar day for O(1) cell lookup.
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events ?? []) {
      const d = new Date(e.start);
      const k = key(d);
      map.set(k, [...(map.get(k) ?? []), e]);
    }
    return map;
  }, [events]);

  // Build the grid: pad to the Monday before the 1st, run to a whole week.
  const cells = useMemo(() => {
    const first = startOfMonth(cursor);
    const last = endOfMonth(cursor);
    const lead = (first.getDay() + 6) % 7; // Monday = 0
    const out: Date[] = [];
    for (let i = lead; i > 0; i--) out.push(new Date(first.getFullYear(), first.getMonth(), 1 - i));
    for (let d = 1; d <= last.getDate(); d++) out.push(new Date(first.getFullYear(), first.getMonth(), d));
    while (out.length % 7 !== 0) {
      const tail = out[out.length - 1];
      out.push(new Date(tail.getFullYear(), tail.getMonth(), tail.getDate() + 1));
    }
    return out;
  }, [cursor]);

  const today = new Date();
  const selectedEvents = selected ? byDay.get(key(selected)) ?? [] : [];
  const monthLabel = cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  function shift(months: number) {
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + months, 1));
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Calendar"
        subtitle="Work item deadlines, project due dates and meetings, in one view."
        actions={
          <div className="flex items-center gap-1.5">
            <button className="btn btn-sm" onClick={() => shift(-1)}>
              ‹
            </button>
            <button
              className="btn btn-sm"
              onClick={() => {
                setCursor(startOfMonth(new Date()));
                setSelected(new Date());
              }}
            >
              Today
            </button>
            <button className="btn btn-sm" onClick={() => shift(1)}>
              ›
            </button>
          </div>
        }
      />
      <ErrorText>{err}</ErrorText>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card title={monthLabel}>
          <div className="grid grid-cols-7 gap-px bg-slate-200 border border-slate-200 rounded-md overflow-hidden">
            {DAYS.map((d) => (
              <div key={d} className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 text-center py-1.5">
                {d}
              </div>
            ))}
            {cells.map((d) => {
              const dayEvents = byDay.get(key(d)) ?? [];
              const outside = d.getMonth() !== cursor.getMonth();
              const isToday = isSameDay(d, today);
              const isSelected = selected && isSameDay(d, selected);
              return (
                <button
                  key={d.toISOString()}
                  onClick={() => setSelected(d)}
                  className={`bg-white min-h-[76px] text-left p-1.5 transition hover:bg-slate-50 ${
                    outside ? "opacity-40" : ""
                  } ${isSelected ? "ring-2 ring-inset ring-indigo-400" : ""}`}
                >
                  <div
                    className={`text-xs mb-1 ${
                      isToday ? "font-bold text-indigo-700" : "text-slate-500"
                    }`}
                  >
                    {d.getDate()}
                  </div>
                  <div className="space-y-0.5">
                    {dayEvents.slice(0, 3).map((e) => (
                      <div
                        key={`${e.kind}-${e.id}`}
                        className={`text-[10px] leading-tight px-1 py-0.5 rounded border truncate ${KIND_CLASS[e.kind]}`}
                        title={e.title}
                      >
                        {e.title}
                      </div>
                    ))}
                    {dayEvents.length > 3 && (
                      <div className="text-[10px] text-slate-400 px-1">+{dayEvents.length - 3} more</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="flex gap-3 mt-3 text-[11px] text-slate-500">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-indigo-200 inline-block" /> Work item
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-amber-200 inline-block" /> Project deadline
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-emerald-200 inline-block" /> Meeting
            </span>
          </div>
        </Card>

        <Card
          title={
            selected
              ? selected.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })
              : "Select a day"
          }
        >
          {events === null ? (
            <div className="text-sm text-slate-400">Loading...</div>
          ) : selectedEvents.length === 0 ? (
            <EmptyState>Nothing scheduled for this day.</EmptyState>
          ) : (
            <div className="space-y-2">
              {selectedEvents.map((e) => (
                <Link
                  key={`${e.kind}-${e.id}`}
                  to={e.url}
                  className={`block border rounded-md px-2.5 py-2 hover:shadow-sm transition ${KIND_CLASS[e.kind]}`}
                >
                  <div className="text-sm font-medium">{e.title}</div>
                  <div className="text-[11px] opacity-80 mt-0.5">
                    {e.kind === "meeting"
                      ? new Date(e.start).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
                      : e.kind === "project"
                      ? "project deadline"
                      : "due"}
                    {e.meta ? ` \u00b7 ${e.meta}` : ""}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
