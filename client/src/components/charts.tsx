import { ReactNode } from "react";

/**
 * Charts, drawn by hand in SVG.
 *
 * No charting library. Everything on these dashboards is a bar, a ring or a
 * sparkline, and each of those is twenty lines of SVG; a library would add
 * hundreds of kilobytes to a page load, on a network that is often a government
 * office's, to draw rectangles. They are also all pure functions of their props,
 * so there is nothing to reconcile when the realtime feed pushes new numbers.
 */

const PALETTE: Record<string, string> = {
  navy: "#0B2447",
  mid: "#14406E",
  gold: "#C1922B",
  green: "#1B6B4A",
  red: "#C0392B",
  amber: "#B4560A",
  slate: "#94A3B8",
  indigo: "#4F46E5",
};

export function colourOf(key: string): string {
  return PALETTE[key] ?? key;
}

/** Colour per work status, used everywhere a status appears in a chart. */
export const statusColour: Record<string, string> = {
  YET_TO_BE_ASSIGNED: PALETTE.amber,
  INITIATED: PALETTE.slate,
  IN_PROGRESS: PALETTE.mid,
  FINISHED: PALETTE.green,
  ON_HOLD: PALETTE.gold,
};

export const priorityColour: Record<string, string> = {
  URGENT: PALETTE.red,
  HIGH: PALETTE.amber,
  NORMAL: PALETTE.mid,
  LOW: PALETTE.slate,
};

// ---------------------------------------------------------------------------

/**
 * A completion ring. Reads as one number at a glance, which is what a
 * completion figure is for; the arc is there to make "62%" feel like 62%.
 */
export function Ring({
  value,
  size = 96,
  stroke = 9,
  colour = PALETTE.navy,
  label,
  sublabel,
}: {
  value: number;
  size?: number;
  stroke?: number;
  colour?: string;
  label?: string;
  sublabel?: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-3">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${pct} percent`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E7ECF3" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={colour}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${(c * pct) / 100} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dasharray .5s ease" }}
        />
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dominantBaseline="central"
          style={{ fontSize: size / 4, fontWeight: 700, fill: "#0E1B2E", fontVariantNumeric: "tabular-nums" }}
        >
          {pct}%
        </text>
      </svg>
      {(label || sublabel) && (
        <div className="min-w-0">
          {label && <div className="text-sm font-semibold text-slate-700">{label}</div>}
          {sublabel && <div className="text-xs text-slate-500">{sublabel}</div>}
        </div>
      )}
    </div>
  );
}

/** A donut for a categorical mix, with a legend that carries the counts. */
export function Donut({
  data,
  size = 132,
  thickness = 20,
  centreLabel,
  centreValue,
}: {
  data: { label: string; count: number; colour: string }[];
  size?: number;
  thickness?: number;
  centreLabel?: string;
  centreValue?: string | number;
}) {
  const total = data.reduce((a, d) => a + d.count, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="flex items-center gap-4 flex-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#EEF1F6" strokeWidth={thickness} />
        {total > 0 &&
          data
            .filter((d) => d.count > 0)
            .map((d) => {
              const len = (c * d.count) / total;
              const seg = (
                <circle
                  key={d.label}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke={d.colour}
                  strokeWidth={thickness}
                  strokeDasharray={`${len} ${c - len}`}
                  strokeDashoffset={-offset}
                  transform={`rotate(-90 ${size / 2} ${size / 2})`}
                />
              );
              offset += len;
              return seg;
            })}
        <text
          x="50%"
          y={size / 2 - 4}
          textAnchor="middle"
          style={{ fontSize: 22, fontWeight: 700, fill: "#0B2447", fontVariantNumeric: "tabular-nums" }}
        >
          {centreValue ?? total}
        </text>
        {centreLabel && (
          <text x="50%" y={size / 2 + 14} textAnchor="middle" style={{ fontSize: 9.5, fill: "#6C7C93", letterSpacing: ".08em" }}>
            {centreLabel.toUpperCase()}
          </text>
        )}
      </svg>
      <div className="space-y-1 min-w-[9rem]">
        {data.map((d) => (
          <div key={d.label} className="flex items-center gap-2 text-xs">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: d.colour }} />
            <span className="text-slate-600 truncate">{d.label}</span>
            <span className="ml-auto font-semibold tabular-nums text-slate-800">{d.count}</span>
            <span className="text-slate-400 tabular-nums w-9 text-right">
              {total ? Math.round((d.count / total) * 100) : 0}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Horizontal bars: the honest default for comparing named things. */
export function BarList({
  rows,
  max,
  emptyText = "Nothing to show.",
}: {
  rows: { label: string; value: number; colour?: string; note?: ReactNode; href?: string }[];
  max?: number;
  emptyText?: string;
}) {
  if (!rows.length) return <div className="text-sm text-slate-400 py-4">{emptyText}</div>;
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));

  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="flex items-baseline gap-2 text-xs">
            <span className="text-slate-600 truncate">{r.label}</span>
            {r.note && <span className="text-slate-400 shrink-0">{r.note}</span>}
            <span className="ml-auto font-semibold tabular-nums text-slate-800">{r.value}</span>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden mt-1">
            <div
              className="h-full rounded-full"
              style={{ width: `${(r.value / top) * 100}%`, background: r.colour ?? PALETTE.mid, transition: "width .4s ease" }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * A stacked bar in one line, for "of the open items, this many are late". Used
 * where a donut would be overkill but a bare number hides the split.
 */
export function SplitBar({
  segments,
  height = 8,
}: {
  segments: { label: string; value: number; colour: string }[];
  height?: number;
}) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  if (!total) return <div className="h-2 bg-slate-100 rounded-full" />;
  return (
    <div className="flex rounded-full overflow-hidden" style={{ height }}>
      {segments
        .filter((s) => s.value > 0)
        .map((s) => (
          <div
            key={s.label}
            title={`${s.label}: ${s.value}`}
            style={{ width: `${(s.value / total) * 100}%`, background: s.colour }}
          />
        ))}
    </div>
  );
}

/**
 * The backlog line: raised against closed, day by day, with the open count as
 * an area behind it. This is the one chart that shows whether the office is
 * keeping up rather than merely busy.
 */
export function TrendChart({
  points,
  height = 120,
}: {
  points: { date: string; created: number; finished: number; open: number }[];
  height?: number;
}) {
  if (points.length < 2) return <div className="text-sm text-slate-400 py-6">Not enough history yet.</div>;

  const w = 640;
  const h = height;
  const pad = { top: 8, right: 4, bottom: 18, left: 4 };
  const innerW = w - pad.left - pad.right;
  const innerH = h - pad.top - pad.bottom;

  const maxOpen = Math.max(1, ...points.map((p) => p.open));
  const maxBar = Math.max(1, ...points.map((p) => Math.max(p.created, p.finished)));
  const stepX = innerW / (points.length - 1);
  const barW = Math.max(2, Math.min(9, (innerW / points.length) * 0.32));

  const x = (i: number) => pad.left + i * stepX;
  const yOpen = (v: number) => pad.top + innerH - (v / maxOpen) * innerH;
  const yBar = (v: number) => pad.top + innerH - (v / maxBar) * (innerH * 0.55);

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${yOpen(p.open).toFixed(1)}`).join(" ");
  const area = `${line} L ${x(points.length - 1).toFixed(1)} ${pad.top + innerH} L ${x(0).toFixed(1)} ${pad.top + innerH} Z`;

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height }} preserveAspectRatio="none">
        <path d={area} fill="rgba(20,64,110,.08)" />
        <path d={line} fill="none" stroke={PALETTE.mid} strokeWidth={2} strokeLinejoin="round" />
        {points.map((p, i) => (
          <g key={p.date}>
            <rect
              x={x(i) - barW - 1}
              y={yBar(p.created)}
              width={barW}
              height={Math.max(0, pad.top + innerH - yBar(p.created))}
              fill={PALETTE.gold}
              opacity={0.85}
            >
              <title>{`${p.date}: ${p.created} raised`}</title>
            </rect>
            <rect
              x={x(i) + 1}
              y={yBar(p.finished)}
              width={barW}
              height={Math.max(0, pad.top + innerH - yBar(p.finished))}
              fill={PALETTE.green}
              opacity={0.85}
            >
              <title>{`${p.date}: ${p.finished} finished`}</title>
            </rect>
          </g>
        ))}
        <line x1={pad.left} y1={pad.top + innerH} x2={w - pad.right} y2={pad.top + innerH} stroke="#E1E7F0" />
      </svg>
      <div className="flex items-center gap-4 text-[11px] text-slate-500 mt-1">
        <Legend colour={PALETTE.gold} label="Raised" />
        <Legend colour={PALETTE.green} label="Finished" />
        <Legend colour={PALETTE.mid} label="Open backlog" />
        <span className="ml-auto tabular-nums">
          {points[0].date} to {points[points.length - 1].date}
        </span>
      </div>
    </div>
  );
}

function Legend({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-sm" style={{ background: colour }} />
      {label}
    </span>
  );
}

/**
 * Plan against progress. Two bars, deliberately stacked one above the other so
 * the gap between them is the message: schedule spent versus work delivered.
 */
export function PlanVsProgress({
  elapsedPct,
  completionPct,
}: {
  elapsedPct: number | null;
  completionPct: number;
}) {
  const behind = elapsedPct !== null && elapsedPct - completionPct >= 15;
  return (
    <div className="space-y-2.5">
      <Track label="Time elapsed" value={elapsedPct} colour={PALETTE.slate} unknown="No start or due date set" />
      <Track label="Work completed" value={completionPct} colour={behind ? PALETTE.red : PALETTE.green} />
      {elapsedPct !== null && (
        <p className={`text-xs ${behind ? "text-red-700" : "text-slate-500"}`}>
          {behind
            ? `The schedule is ${elapsedPct - completionPct} points ahead of delivery.`
            : "Delivery is keeping pace with the schedule."}
        </p>
      )}
    </div>
  );
}

function Track({
  label,
  value,
  colour,
  unknown,
}: {
  label: string;
  value: number | null;
  colour: string;
  unknown?: string;
}) {
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span className="text-slate-600">{label}</span>
        <span className="font-semibold tabular-nums text-slate-800">{value === null ? "-" : `${value}%`}</span>
      </div>
      {value === null ? (
        <div className="text-[11px] text-slate-400 mt-0.5">{unknown}</div>
      ) : (
        <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden mt-1">
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, value)}%`, background: colour }} />
        </div>
      )}
    </div>
  );
}

/** A small KPI tile. Tone drives the colour of the number, nothing else. */
export function Kpi({
  label,
  value,
  tone = "plain",
  hint,
  Icon,
  onClick,
}: {
  label: string;
  value: string | number;
  tone?: "plain" | "red" | "amber" | "green" | "navy";
  hint?: string;
  Icon?: React.ElementType;
  onClick?: () => void;
}) {
  const toneCls: Record<string, string> = {
    plain: "text-slate-700",
    red: "text-red-600",
    amber: "text-amber-600",
    green: "text-emerald-600",
    navy: "text-[color:var(--brand)]",
  };
  return (
    <div
      className={`bg-white border border-slate-200 rounded-lg px-3.5 py-3 ${onClick ? "cursor-pointer hover:border-slate-300 hover:shadow-sm" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
    >
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-400 font-bold">
        {Icon && <Icon className="w-3.5 h-3.5" />}
        <span className="truncate">{label}</span>
      </div>
      <div className={`text-2xl font-semibold mt-1.5 tabular-nums ${toneCls[tone]}`}>{value}</div>
      {hint && <div className="text-[11px] text-slate-400 mt-0.5 truncate">{hint}</div>}
    </div>
  );
}
