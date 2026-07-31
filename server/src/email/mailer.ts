import nodemailer, { Transporter } from "nodemailer";
import { config } from "../config";

// Build a transport only if SMTP is configured. Otherwise emails are logged,
// so local development needs no mail server.
let transport: Transporter | null = null;
if (config.smtp.host) {
  transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
}

export async function sendMail(to: string, subject: string, html: string): Promise<void> {
  if (!transport) {
    console.log(`[email:disabled] would send to ${to} -> ${subject}`);
    return;
  }
  try {
    await transport.sendMail({ from: config.mailFrom, to, subject, html });
  } catch (e) {
    console.error("[email] send failed:", (e as Error).message);
  }
}
