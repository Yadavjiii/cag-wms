import { config } from "../config";

interface EmailParts {
  title: string;
  body?: string;
  name?: string;
  ctaUrl?: string;
  ctaLabel?: string;
}

// One branded, inline-styled HTML template used for all notification emails.
export function renderEmail(p: EmailParts): { subject: string; html: string } {
  const org = config.orgName;
  const subject = `[${org}] ${p.title}`;
  const cta = p.ctaUrl
    ? `<p style="margin:24px 0"><a href="${p.ctaUrl}" style="background:#1e1b4b;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-size:14px">${p.ctaLabel ?? "Open"}</a></p>`
    : "";
  const html = `
  <div style="font-family:Segoe UI,Arial,sans-serif;background:#f1f5f9;padding:24px">
    <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">
      <div style="background:#1e1b4b;color:#fff;padding:16px 20px;font-size:15px;font-weight:600">${org}</div>
      <div style="padding:20px">
        ${p.name ? `<p style="color:#475569;font-size:14px;margin:0 0 12px">Hello ${p.name},</p>` : ""}
        <h2 style="font-size:17px;color:#1e293b;margin:0 0 8px">${p.title}</h2>
        ${p.body ? `<p style="color:#475569;font-size:14px;line-height:1.5;margin:0">${p.body.replace(/\n/g, "<br>")}</p>` : ""}
        ${cta}
        <p style="color:#94a3b8;font-size:12px;margin-top:24px">This is an automated message from ${org}.</p>
      </div>
    </div>
  </div>`;
  return { subject, html };
}
