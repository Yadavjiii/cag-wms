import { useState } from "react";
import { useBranding } from "../branding";
import { useNavigate, Link } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { Button, ErrorText } from "../components/ui";

export default function Register() {
  const { branding } = useBranding();
  const { register } = useAuth();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [designation, setDesignation] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await register({ fullName, email, password, designation: designation || undefined });
      navigate("/");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Registration failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 justify-center mb-6 text-indigo-950">
          <ShieldCheck className="w-7 h-7" />
          <span className="font-serif text-xl">{branding.name}</span>
        </div>
        <form onSubmit={submit} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h1 className="text-lg font-semibold">Create account</h1>
          <ErrorText>{err}</ErrorText>
          <div>
            <label className="text-xs uppercase tracking-wide text-slate-400">Full name</label>
            <input
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="mt-1 w-full border border-slate-200 rounded-md px-3 py-2 text-sm outline-none focus:border-indigo-400"
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-slate-400">Designation</label>
            <input
              value={designation}
              onChange={(e) => setDesignation(e.target.value)}
              placeholder="e.g. Senior Audit Officer, Consultant, Data Analyst"
              className="mt-1 w-full border border-slate-200 rounded-md px-3 py-2 text-sm outline-none focus:border-indigo-400"
            />
            <p className="text-xs text-slate-400 mt-1">Your official title. Free text; your access level is set separately by an admin.</p>
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-slate-400">Official email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full border border-slate-200 rounded-md px-3 py-2 text-sm outline-none focus:border-indigo-400"
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-slate-400">Password</label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full border border-slate-200 rounded-md px-3 py-2 text-sm outline-none focus:border-indigo-400"
            />
            <p className="text-xs text-slate-400 mt-1">At least 8 characters. Only approved CAG email domains can register.</p>
          </div>
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Creating..." : "Create account"}
          </Button>
          <p className="text-sm text-slate-500 text-center">
            Already have an account?{" "}
            <Link to="/login" className="text-indigo-700 font-medium">
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
