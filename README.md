# CAG Work Management System (WMS)

A full-stack work management app for CAG offices.

- **client/** - React + TypeScript + Vite + Tailwind (the web UI)
- **server/** - Node + Express + TypeScript + Prisma (the API)
- **Database** - MySQL

Authorization that would normally be database row-level security lives in the
Express layer (`taskVisibility` / `canEdit` in `server/src/routes/task.routes.ts`).
That central layer decides who can see and edit each task.

## What works today

- Sign up (restricted to a CAG email domain), sign in, sign out. JWT + bcrypt.
- Profiles: view/edit your own, browse the staff directory.
- Teams: create, list, view members, add members.
- Tasks: create, list with filters (status, "only mine"), view detail, edit
  status / progress / leads / due date, add remarks. Every change is logged.
- Dashboard: live KPIs, status mix, and an automatic overdue / due-soon (RAG) list.
- Roles & permissions: database-driven roles (not hardcoded), free-text
  designations at sign-up, and an Admin page to assign roles (permission-gated).
- Departments & hierarchy: departments belong to an office, can nest, and have
  a head; users have a department and a reporting manager. Managed on the
  Departments page (needs `department.manage`). Endpoints: `GET/POST /api/offices`,
  `GET/POST /api/departments`, `GET/PATCH /api/departments/:id`,
  `POST/DELETE /api/departments/:id/members`.
- Assign & approve workflow: assign a work item to a person; same-department
  assignments land immediately (assignee accepts/declines), cross-department
  assignments require the target department head to approve first. Full movement
  history is recorded per work item, and there's an Approvals & inbox page.
  Endpoints: `POST /api/tasks/:id/assign`, `GET /api/tasks/:id/assignments`,
  `GET /api/assignments/pending-approvals`, `GET /api/assignments/my-inbox`,
  `POST /api/assignments/:id/{approve,reject,accept,decline,cancel}`.
- Notifications & email: every workflow event (assigned, approval requested,
  approved, rejected, accepted, declined, cancelled) creates an in-app
  notification, shown via a bell with an unread badge in the header. Optional
  email delivery uses a branded HTML template; if no SMTP is configured, emails
  are logged to the console so nothing breaks locally. An optional daily job
  reminds leads of due/overdue work. Endpoints: `GET /api/notifications`,
  `GET /api/notifications/unread-count`, `PATCH /api/notifications/:id/read`,
  `POST /api/notifications/read-all`. Email/reminder settings live in
  `server/.env` (`SMTP_*`, `EMAIL_ON_NOTIFY`, `ENABLE_REMINDERS`), all off by default.
- Documents: upload files (up to 20 MB) to a work item, list them, download
  (auth-protected), and delete (uploader or task editor). Files are stored on
  the server's `UPLOAD_DIR`; the DB keeps the original name and uploader.
  Endpoints: `POST/GET /api/tasks/:id/attachments`,
  `GET /api/attachments/:id/download`, `DELETE /api/attachments/:id`.
- Meetings & calendar: schedule meetings with participants, agenda, mode
  (physical/online) and location, optionally linked to a work item; participants
  get an invite notification; download a calendar (.ics) invite. Endpoints:
  `GET/POST /api/meetings`, `GET/PATCH/DELETE /api/meetings/:id`,
  `POST/DELETE /api/meetings/:id/participants`, `GET /api/meetings/:id/ics`.
- Search, reports & audit: global search across work items, people, teams, and
  meetings (header search box); a Reports page with KPIs, status/department/lead
  breakdowns, and recent activity (needs `report.view`); and a per-work-item
  activity timeline (the permanent audit trail). Endpoints: `GET /api/search`,
  `GET /api/reports/summary`, `GET /api/reports/activity`, `GET /api/tasks/:id/activity`.
- Real-time: a Socket.IO layer (JWT-authenticated) pushes live updates. The
  notification bell updates instantly, the dashboard and open work items refresh
  themselves when anything changes, and the header shows a live "people online"
  count. Single-instance/in-memory for local and pilot use; a multi-instance
  production deploy should add the Socket.IO Redis adapter.
- Configurable organization (branding): the org name, logo, and header/accent
  colours live in the database (`OrgSettings`) and are edited on the Admin page
  (needs `org.manage`). The login screen, header, and page title all read from
  it, so the same app can be rebranded for another organization without code
  changes. Endpoints: `GET /api/settings` (public), `GET /api/settings/logo`
  (public), `PATCH /api/settings`, `POST /api/settings/logo`.

  Note: this makes the app single-tenant but fully re-brandable. True
  multi-tenancy (many organizations isolated in one deployment via a tenant key
  on every table) is a larger effort deferred to a funded SaaS phase; roles,
  departments, hierarchy, and branding are already data, which is the groundwork.

## Still to come (next builds)

Attachments upload, the assign/request workflow screens, meetings + calendar
invites, notifications + email reminders, and reports/exports.

---

## Prerequisites

- Node.js 18 or newer
- MySQL 8 running locally (you have this via MySQL Workbench)

You already created the database:

```sql
CREATE DATABASE cag_wms CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
```

## 1. Backend

```bash
cd server
cp .env.example .env        # Windows PowerShell: copy .env.example .env
```

Edit `.env` and set `DATABASE_URL` to your MySQL login, for example:

```
DATABASE_URL="mysql://root:YOUR_PASSWORD@localhost:3306/cag_wms"
```

If your password has special characters, URL-encode them (@ = %40, # = %23, : = %3A).

Then:

```bash
npm install
npm run prisma:migrate     # creates every table in cag_wms
npm run seed               # OPTIONAL: sample office, users, team, tasks
npm run dev                # API on http://localhost:4000
```

Health check: open http://localhost:4000/api/health -> should show {"ok":true}.

If you ran the seed, you can log in with:

```
admin@cag.gov.in  /  password123     (SUPER_ADMIN, sees everything)
```

## 2. Frontend

Open a **second terminal**:

```bash
cd client
npm install
npm run dev                # UI on http://localhost:5173
```

Open http://localhost:5173 in your browser.

## Testing sign-up with your own email

Registration only accepts emails on the domain in `server/.env`
(`ALLOWED_EMAIL_DOMAIN`, default `cag.gov.in`). To test with your own address,
change that line (e.g. `ALLOWED_EMAIL_DOMAIN="gmail.com"`), restart the server,
then register. To make any account an admin, run in Workbench:

```sql
UPDATE users SET role = 'SUPER_ADMIN' WHERE email = 'your@email';
```

## Browsing the data

`cd server && npm run prisma:studio` opens a visual table browser, or refresh
the `cag_wms` schema in Workbench to see the tables.

## Project layout

```
cag-wms/
  server/
    prisma/schema.prisma     # full data model (all features)
    prisma/seed.ts           # sample data
    src/
      index.ts               # Express app
      config.ts              # env config
      prisma.ts              # Prisma client
      middleware/auth.ts     # JWT + role guards
      middleware/error.ts    # error handler
      routes/                # auth, profiles, teams, tasks
      utils/http.ts          # asyncHandler + HttpError
  client/
    src/
      main.tsx, App.tsx      # router
      api/client.ts          # fetch wrapper + token
      auth/                  # AuthContext (login state)
      components/            # Layout, ui
      lib/format.ts          # dates + RAG logic
      pages/                 # Login, Register, Dashboard, Tasks,
                             # TaskDetail, Teams, Profile
```

## Roles, designations and permissions (configurable, not hardcoded)

Two separate ideas, on purpose:

- **Designation** is a person's official title (e.g. "Senior Audit Officer",
  "Consultant", "Data Analyst"). It is FREE TEXT that each person types at
  sign-up. It does not by itself grant any access.
- **Role** is what the system uses to decide permissions and seniority. Roles
  live in the `roles` table (not in code), each mapping to a set of permission
  keys and a hierarchy `level`. An admin assigns a role to a person.

New sign-ups get the role flagged `isDefault` (seeded as **Member**). An admin
can change anyone's role on the Admin page. Roles are renamable and extendable
later without code changes, which is the "nothing hardcoded" principle.

Seeded roles: Super Admin, Administrator, Department Head, Team Lead, Member.
Permission keys the code checks: `task.view_all`, `task.view_office`,
`task.edit_any`, `task.edit_office`, `task.assign`, `task.approve`,
`team.manage_any`, `user.manage`, `role.manage`, `office.manage`, `report.view`.

Admin API (needs `role.manage`): `GET /api/admin/roles`, `GET /api/admin/users`,
`PATCH /api/admin/users/:id/role`. You cannot assign a role more senior than
your own (anti-escalation guard).

## Applying this update to an existing database

If you already ran the older schema, apply the new tables and re-seed:

```bash
cd server
npm run prisma:migrate     # creates roles/permissions tables, adds users.roleId
npm run seed               # seeds permissions, roles, and assigns sample users
```

## Security note

The RLS-style checks in the Express layer are a solid starting point, not a
final security sign-off. Test each role and have the authorization reviewed
before any official rollout.
