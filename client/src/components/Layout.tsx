import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useState, useRef, useEffect } from "react";
import { Menu, X, Search as SearchIcon, MoreHorizontal } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import NotificationBell from "./NotificationBell";
import { useRealtime } from "../realtime";
import { useBranding } from "../branding";

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
  show?: boolean;
}

export default function Layout() {
  const { user, logout } = useAuth();
  const { branding } = useBranding();
  const navigate = useNavigate();
  const location = useLocation();
  const [q, setQ] = useState("");
  const [online, setOnline] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  useRealtime("presence", (p) => setOnline((p as { count: number }).count));

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const items: NavItem[] = [
    { to: "/", label: "Dashboard", end: true, show: true },
    { to: "/tasks", label: "Tasks", show: true },
    { to: "/approvals", label: "Approvals", show: true },
    { to: "/meetings", label: "Meetings", show: true },
    { to: "/teams", label: "Teams", show: true },
    { to: "/departments", label: "Departments", show: !!user?.permissions?.includes("department.manage") },
    { to: "/reports", label: "Reports", show: !!user?.permissions?.includes("report.view") },
    { to: "/admin", label: "Admin", show: !!user?.permissions?.includes("role.manage") },
    { to: "/profile", label: "Profile", show: true },
  ].filter((i) => i.show);

  // Primary tabs stay visible; the rest fold into a "More" menu.
  const primary = items.slice(0, 5);
  const overflow = items.slice(5);

  function handleLogout() {
    logout();
    navigate("/login");
  }
  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
  }
  const isOn = (to: string, end?: boolean) => (end ? location.pathname === "/" : location.pathname.startsWith(to));
  const initials = (user?.fullName ?? "?").split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div>
      <header className="tn-wrap">
        <div className="tn-inner">
          <button className="tn-icon tn-hamb" aria-label="Menu" onClick={() => setMenuOpen((o) => !o)}>
            {menuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>

          <div className="tn-brand">
            {branding.logoUrl && <img src={branding.logoUrl} alt="" />}
            <span className="nm">{branding.name}</span>
          </div>

          <nav className="tn-tabs">
            {primary.map((i) => (
              <NavLink key={i.to} to={i.to} end={i.end} className={() => `tn-tab ${isOn(i.to, i.end) ? "on" : ""}`}>
                {i.label}
              </NavLink>
            ))}
            {overflow.length > 0 && (
              <div className="tn-more" ref={moreRef}>
                <button className={`tn-tab ${overflow.some((o) => isOn(o.to)) ? "on" : ""}`} onClick={() => setMoreOpen((o) => !o)}>
                  <MoreHorizontal size={16} /> More
                </button>
                {moreOpen && (
                  <div className="tn-menu">
                    {overflow.map((i) => (
                      <NavLink key={i.to} to={i.to} className={() => `tn-mi ${isOn(i.to) ? "on" : ""}`} onClick={() => setMoreOpen(false)}>
                        {i.label}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            )}
          </nav>

          <div className="tn-right">
            <form className="tn-search" onSubmit={submitSearch}>
              <SearchIcon size={15} color="rgba(255,255,255,.6)" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search..." />
            </form>
            <span className="tn-online" title="People online now">
              <span className="dot" /> {online}
            </span>
            <NotificationBell />
            <div className="tn-user" onClick={handleLogout} title="Log out">
              <span className="tn-ava">{initials}</span>
              <span className="tn-uinfo">
                <span className="tn-nm">{user?.fullName}</span>
                <span className="tn-rl">{user?.role?.name ?? "No role"}</span>
              </span>
            </div>
          </div>
        </div>
      </header>

      {menuOpen && (
        <div className="mobile-nav">
          {items.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end} className={() => `${isOn(i.to, i.end) ? "on" : ""}`} onClick={() => setMenuOpen(false)}>
              {i.label}
            </NavLink>
          ))}
        </div>
      )}

      <main className="container">
        <Outlet />
      </main>
    </div>
  );
}
