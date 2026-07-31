import { useState } from "react";
import { useBranding } from "../branding";
import { useNavigate, Link } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { Button, ErrorText } from "../components/ui";

export default function Login() {
  const { branding } = useBranding();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await login(email, password);
      navigate("/");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 justify-center mb-6 text-white">
          {branding.logoUrl ? <img src={branding.logoUrl} alt="" style={{ height: 30 }} /> : <ShieldCheck className="w-7 h-7" />}
          <span className="serif text-xl">{branding.name}</span>
        </div>
        <form onSubmit={submit} className="auth-card space-y-4">
          <h1 className="text-lg font-semibold">Sign in</h1>
          <ErrorText>{err}</ErrorText>
          <div>
            <label className="text-xs uppercase tracking-wide text-slate-400">Email</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="input mt-1" />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-slate-400">Password</label>
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="input mt-1" />
          </div>
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Signing in..." : "Sign in"}
          </Button>
          <p className="text-sm text-slate-500 text-center">
            No account? <Link to="/register" className="link">Create one</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
