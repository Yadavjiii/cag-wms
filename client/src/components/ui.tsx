import { ReactNode } from "react";

export function Card({
  title,
  right,
  children,
  className = "",
}: {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || right) && (
        <div className="flex items-center justify-between mb-3.5">
          {title && <h3 className="text-[13.5px] font-semibold text-slate-600 m-0">{title}</h3>}
          {right && <div>{right}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-4">
      <div>
        <h1 className="page-title serif">{title}</h1>
        {subtitle && <p className="page-sub">{subtitle}</p>}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wide text-slate-400">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`input ${props.className ?? ""}`} />;
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  ...props
}: {
  children: ReactNode;
  variant?: "primary" | "ghost" | "danger";
  size?: "sm" | "md";
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = ["btn", variant === "primary" ? "btn-primary" : variant === "danger" ? "btn-danger" : "", size === "sm" ? "btn-sm" : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <button {...props} className={`${cls} ${props.className ?? ""}`}>
      {children}
    </button>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <div className="err">{children}</div>;
}

export function EmptyState({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="icon">{icon}</div>}
      <div>{children}</div>
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

/** A few skeleton rows for list/loading states. */
export function SkeletonRows({ count = 4 }: { count?: number }) {
  return (
    <div className="rows">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-14" />
      ))}
    </div>
  );
}

/**
 * Tabs.
 *
 * A work item and a project each carry six or seven panels' worth of
 * information, and stacking them all vertically produced a page nobody scrolled
 * to the bottom of. State is held by the caller so a tab choice can survive a
 * reload or be driven from a link.
 */
export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: T; label: string; count?: number; badge?: "red" | "amber" }[];
  active: T;
  onChange: (key: T) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-slate-200 -mb-px">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className={
            "relative inline-flex items-center gap-1.5 px-3.5 py-2 text-[13px] font-semibold whitespace-nowrap border-b-2 " +
            (active === t.key
              ? "border-[color:var(--gold)] text-[color:var(--brand)]"
              : "border-transparent text-slate-500 hover:text-slate-800")
          }
        >
          {t.label}
          {t.count !== undefined && t.count > 0 && (
            <span
              className={
                "text-[10px] px-1.5 py-0.5 rounded-full tabular-nums font-bold " +
                (t.badge === "red"
                  ? "bg-red-100 text-red-700"
                  : t.badge === "amber"
                    ? "bg-amber-100 text-amber-700"
                    : "bg-slate-100 text-slate-600")
              }
            >
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/** A labelled statistic, for the dense summary strips on the detail pages. */
export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "red" | "amber" | "green" }) {
  const cls = tone === "red" ? "text-red-600" : tone === "amber" ? "text-amber-600" : tone === "green" ? "text-emerald-600" : "text-slate-800";
  return (
    <div className="bg-slate-50 border border-slate-100 rounded-md px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold truncate">{label}</div>
      <div className={`text-sm font-semibold mt-0.5 tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}
