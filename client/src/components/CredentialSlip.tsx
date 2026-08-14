import { useState } from "react";
import { CreatedAccount } from "../types";

/**
 * A temporary password is returned by the API exactly once and is never
 * retrievable afterwards, so this panel makes it obvious that the admin has to
 * hand it over now. If it is lost, the fix is a password reset, not a lookup.
 */
export default function CredentialSlip({ account, onDismiss }: { account: CreatedAccount; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  const { user, temporaryPassword, emailed, emailError } = account;

  const text = `CAG WMS login\nName: ${user.fullName}\nEmail: ${user.email}\nTemporary password: ${temporaryPassword ?? "(set by the administrator)"}\n\nChange this password at first sign-in.`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked; the text is on screen anyway */
    }
  }

  return (
    <section className="card border-2 border-amber-300 bg-amber-50/60">
      <div className="flex items-start justify-between gap-3 mb-2">
        <h3 className="text-[13.5px] font-semibold text-amber-900 m-0">Account created. Copy these credentials now.</h3>
        <button className="btn btn-sm" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
      <dl className="text-sm space-y-1">
        <div className="flex gap-2">
          <dt className="w-40 text-slate-500">Name</dt>
          <dd className="font-medium">{user.fullName}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-40 text-slate-500">Email (username)</dt>
          <dd className="font-mono">{user.email}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-40 text-slate-500">Temporary password</dt>
          <dd className="font-mono font-semibold">{temporaryPassword ?? "(as you set it)"}</dd>
        </div>
        {user.role && (
          <div className="flex gap-2">
            <dt className="w-40 text-slate-500">Role</dt>
            <dd>{user.role.name}</dd>
          </div>
        )}
      </dl>
      <div className="flex gap-2 mt-3">
        <button className="btn btn-sm btn-primary" onClick={copy}>
          {copied ? "Copied" : "Copy credentials"}
        </button>
      </div>
      <p className="text-xs text-amber-800 mt-2">
        This password will not be shown again. If it is lost, issue a password reset instead.
      </p>

      {/* Whether the email went out decides what the admin has to do next, so
          say it plainly rather than leaving them to guess. */}
      {emailed ? (
        <p className="text-xs text-emerald-700 mt-2">
          Emailed to {user.email}. They can sign in without you passing anything on.
        </p>
      ) : (
        <div className="text-xs text-rose-700 mt-2 border-t border-amber-200 pt-2">
          <strong>Not emailed.</strong> Give these credentials to the person yourself.
          {emailError ? <div className="mt-1 text-rose-600">Reason: {emailError}</div> : null}
        </div>
      )}
    </section>
  );
}
