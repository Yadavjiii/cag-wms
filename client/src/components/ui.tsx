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
