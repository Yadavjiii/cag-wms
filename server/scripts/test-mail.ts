import { config } from "../src/config";
import { verifyMail, sendMail, mailEnabled } from "../src/email/mailer";
import { renderEmail } from "../src/email/templates";

/**
 * Check the mail configuration on its own.
 *
 *   npm run test:mail                     -> connect and authenticate only
 *   npm run test:mail -- you@example.com  -> also send one real message
 *
 * Worth having as a separate step: otherwise the only way to test mail is to
 * create a real account and wait to see whether anything arrives.
 */

const to = process.argv.find((a) => a.includes("@"));

/** Turn nodemailer's terse errors into something actionable. */
function diagnose(reason: string): string[] {
  const r = reason.toLowerCase();
  const tips: string[] = [];

  if (r.includes("invalid login") || r.includes("username and password not accepted") || r.includes("535")) {
    tips.push("The username or password was rejected.");
    tips.push("For Gmail: SMTP_PASS must be a 16-character App Password, NOT your normal Google password.");
    tips.push("App Passwords need 2-Step Verification switched on: myaccount.google.com/apppasswords");
    tips.push("Paste it without spaces.");
  }
  if (r.includes("econnrefused")) {
    tips.push("Nothing accepted a connection on that host and port. Check SMTP_HOST and SMTP_PORT.");
  }
  if (r.includes("etimedout") || r.includes("timeout")) {
    tips.push("The connection timed out, which usually means a firewall is blocking outbound SMTP.");
    tips.push("Office and government networks often block port 587 and 465. Try a phone hotspot to confirm.");
  }
  if (r.includes("self signed") || r.includes("certificate")) {
    tips.push("A TLS certificate problem, common with internal relays. Ask your mail administrator.");
  }
  if (r.includes("enotfound") || r.includes("getaddrinfo")) {
    tips.push("That hostname does not resolve. Check SMTP_HOST for a typo.");
  }
  if (!tips.length) {
    tips.push("Check SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASS in server/.env.");
  }
  return tips;
}

async function main() {
  console.log("\nMail configuration in server/.env:");
  console.log(`  SMTP_HOST  ${config.smtp.host || "(empty)"}`);
  console.log(`  SMTP_PORT  ${config.smtp.port}`);
  console.log(`  SMTP_USER  ${config.smtp.user || "(empty)"}`);
  console.log(`  SMTP_PASS  ${config.smtp.pass ? `set, ${config.smtp.pass.length} characters` : "(empty)"}`);
  console.log(`  SMTP_FROM  ${config.mailFrom}\n`);

  if (!mailEnabled()) {
    console.log("Mail is OFF, because SMTP_HOST is empty.");
    console.log("Accounts still get created; their credentials are shown on screen and logged");
    console.log("to this console instead of being emailed.\n");
    console.log("To switch it on with Gmail, put this in server/.env and restart:\n");
    console.log('  SMTP_HOST="smtp.gmail.com"');
    console.log("  SMTP_PORT=587");
    console.log('  SMTP_USER="your.address@gmail.com"');
    console.log('  SMTP_PASS="your 16 character app password"');
    console.log('  SMTP_FROM="CAG WMS <your.address@gmail.com>"\n');
    process.exit(1);
  }

  console.log("Connecting and authenticating...");
  const check = await verifyMail();
  if (!check.sent) {
    console.error(`\nFAILED: ${check.reason}\n`);
    for (const t of diagnose(check.reason ?? "")) console.error(`  - ${t}`);
    console.error("");
    process.exit(1);
  }
  console.log("Connected and authenticated.\n");

  if (!to) {
    console.log("Add an address to send a real test message:");
    console.log("  npm run test:mail -- you@example.com\n");
    return;
  }

  console.log(`Sending a test message to ${to}...`);
  const { subject, html } = renderEmail({
    title: "Mail is working",
    name: "there",
    body: "This is a test from your CAG WMS server.\n\nIf you are reading this, account credentials will now reach people automatically.",
    ctaUrl: config.clientOrigin,
    ctaLabel: "Open CAG WMS",
  });
  const result = await sendMail(to, subject, html);

  if (result.sent) {
    console.log(`\nSent. Check the inbox for ${to}, and the spam folder if it is not there.\n`);
  } else {
    console.error(`\nFAILED: ${result.reason}\n`);
    for (const t of diagnose(result.reason ?? "")) console.error(`  - ${t}`);
    console.error("");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
