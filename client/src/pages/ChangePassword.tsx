import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, PageHeader, Field, TextInput, Button, ErrorText } from "../components/ui";
import { useAuth } from "../auth/AuthContext";

/**
 * Where every admin-created account starts. The office admin hands over a
 * temporary password; this is the screen that turns it into a real one. Until
 * it is done, ProtectedRoute keeps the rest of the app out of reach.
 */
export default function ChangePassword() {
  const { user, changePassword } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const forced = !!user?.mustChangePassword;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (next !== confirm) {
      setErr("The two new passwords do not match");
      return;
    }
    if (next.length < 8) {
      setErr("Your new password must be at least 8 characters");
      return;
    }
    setBusy(true);
    try {
      await changePassword(current, next);
      navigate("/", { replace: true });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not change your password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-md">
      <PageHeader
        title={forced ? "Set your password" : "Change your password"}
        subtitle={
          forced
            ? "You are signed in with the temporary password your administrator issued. Choose your own before continuing."
            : "Pick a new password for your account."
        }
      />
      <Card>
        <form onSubmit={submit} className="space-y-3">
          <Field label={forced ? "Temporary password" : "Current password"}>
            <TextInput type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoFocus />
          </Field>
          <Field label="New password">
            <TextInput type="password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} />
          </Field>
          <Field label="Confirm new password">
            <TextInput type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} />
          </Field>
          <ErrorText>{err}</ErrorText>
          <Button type="submit" disabled={busy || !current || !next || !confirm}>
            {busy ? "Saving..." : "Set password"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
