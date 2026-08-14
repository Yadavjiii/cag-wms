import nodemailer, { Transporter } from "nodemailer";
import { config } from "../config";

/**
 * Mail delivery.
 *
 * This used to return void and swallow every error, so a failed send looked
 * exactly like a successful one from anywhere upstream: no exception, nothing
 * in the API response, nothing on screen. An admin would create an account,
 * assume the credentials had gone out, and only discover otherwise when the
 * person said they had received nothing.
 *
 * It now reports what happened, so the caller can tell the admin plainly
 * whether the password still has to be handed over by hand.
 */

export interface MailResult {
  sent: boolean;
  /** Why it did not send. Safe to show to an administrator. */
  reason?: string;
}

let transport: Transporter | null = null;
if (config.smtp.host) {
  transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    // 465 is implicit TLS; 587 upgrades through STARTTLS.
    secure: config.smtp.port === 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
}

/** True when SMTP has been configured at all. */
export function mailEnabled(): boolean {
  return transport !== null;
}

export async function sendMail(to: string, subject: string, html: string): Promise<MailResult> {
  if (!transport) {
    console.log(`[email:off] would have sent to ${to}: ${subject}`);
    return { sent: false, reason: "No mail server is configured (SMTP_HOST is empty in server/.env)" };
  }
  try {
    await transport.sendMail({ from: config.mailFrom, to, subject, html });
    console.log(`[email:sent] ${to}: ${subject}`);
    return { sent: true };
  } catch (e) {
    const reason = (e as Error).message;
    console.error(`[email:FAILED] ${to}: ${reason}`);
    return { sent: false, reason };
  }
}

/**
 * Open a connection and authenticate without sending anything. Used by
 * `npm run test:mail`, so the configuration can be checked on its own instead
 * of by creating a real account and hoping.
 */
export async function verifyMail(): Promise<MailResult> {
  if (!transport) {
    return { sent: false, reason: "SMTP_HOST is empty in server/.env, so mail is switched off" };
  }
  try {
    await transport.verify();
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: (e as Error).message };
  }
}
