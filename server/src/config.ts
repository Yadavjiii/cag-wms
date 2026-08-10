import dotenv from "dotenv";
dotenv.config();

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: required("JWT_SECRET"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  allowedEmailDomain: process.env.ALLOWED_EMAIL_DOMAIN ?? "cag.gov.in",
  // Logins are minted by a Super Admin (office admins) or an Office Admin
  // (office staff). Public sign-up stays off unless explicitly enabled.
  allowSelfRegistration: (process.env.ALLOW_SELF_REGISTRATION ?? "false") === "true",
  clientOrigin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
  uploadDir: process.env.UPLOAD_DIR ?? "./uploads",
  orgName: process.env.ORG_NAME ?? "CAG Work Management",
  // Email: if SMTP_HOST is unset, emails are logged to the console instead of
  // being sent, so the app runs fine on localhost with no mail server.
  mailFrom: process.env.SMTP_FROM ?? "no-reply@cag.local",
  emailOnNotify: (process.env.EMAIL_ON_NOTIFY ?? "false") === "true",
  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  enableReminders: (process.env.ENABLE_REMINDERS ?? "false") === "true",
};
