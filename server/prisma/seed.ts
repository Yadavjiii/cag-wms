import { PrismaClient, TaskStatus, TaskPriority } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

function day(offset: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
}

// ---- Permissions: fine-grained capabilities the app checks at runtime ----
const PERMISSIONS: [string, string][] = [
  ["task.view_all", "View all work items across every office"],
  ["task.view_office", "View all work items in own office"],
  ["task.edit_any", "Edit any work item"],
  ["task.edit_office", "Edit work items in own office"],
  ["task.assign", "Assign work to others"],
  ["task.approve", "Approve incoming cross-department work"],
  ["team.manage_any", "Manage membership of any team"],
  ["project.manage_any", "Manage any project in own office, including its team and leads"],
  ["user.manage", "Create and edit user accounts"],
  ["role.manage", "Manage roles and assign roles to users"],
  ["office.manage", "Manage offices and departments"],
  ["org.manage", "Manage organization branding and settings"],
  ["department.manage", "Create and manage departments and org hierarchy"],
  ["report.view", "View organization and department reports"],
  // ---- office hierarchy ----
  ["office.manage_all", "Work across every office; create Office Admins (Super Admin only)"],
  ["staff.manage", "Create and manage the staff logins for own office (Office Admin)"],
  ["office.request", "Send a work request to another CAG office"],
  ["office.approve", "Approve or reject work requests arriving from other offices"],
];

const ALL = PERMISSIONS.map((p) => p[0]);

// Everything a head-of-office (IAAS-rank officer) needs.
const HEAD_PERMS = [
  "task.view_office",
  "task.edit_office",
  "task.assign",
  "task.approve",
  "team.manage_any",
  "project.manage_any",
  "report.view",
  "office.request",
  "office.approve",
  "department.manage",
];

// ---- Designations: the official post someone holds ----
// Descriptive only. `rank` orders people for display and reporting and is NEVER
// consulted by an authorisation check. Permissions come from Role.
const DESIGNATIONS: { name: string; code: string; rank: number }[] = [
  { name: "System Administrator", code: "SYSADMIN", rank: 95 },
  { name: "Director General", code: "DG", rank: 90 },
  { name: "Principal Accountant General", code: "PAG", rank: 90 },
  { name: "Accountant General", code: "AG", rank: 85 },
  { name: "Deputy Accountant General", code: "DAG", rank: 80 },
  { name: "Director", code: "DIR", rank: 75 },
  { name: "Senior Audit Officer", code: "SAO", rank: 60 },
  { name: "Assistant Audit Officer", code: "AAO", rank: 50 },
  { name: "Administrative Officer", code: "AO", rank: 45 },
  { name: "Supervisor", code: "SUP", rank: 40 },
  { name: "Senior Auditor", code: "SRAUD", rank: 30 },
  { name: "Auditor", code: "AUD", rank: 25 },
  { name: "Consultant", code: "CONS", rank: 20 },
  { name: "Young Professional", code: "YP", rank: 15 },
];

// ---- Role templates: bundles of permissions, owned by the platform ----
// An Office Admin clones these into their own office and edits from there.
// `level` drives anti-escalation: nobody may create or promote to a level at or
// above their own, so an Office Admin (85) can mint an Office Head (80) but
// never another Super Admin (100) and never a second Office Admin.

const ROLES: { name: string; level: number; isDefault?: boolean; description: string; perms: string[] }[] = [
  {
    name: "Super Admin",
    level: 100,
    description: "Platform operator. There is exactly one. Creates offices and their Office Admin login. Does no audit work.",
    perms: ALL,
  },
  {
    name: "Office Admin",
    level: 85,
    description:
      "The office's own account, named after the office. Creates, edits and deletes that office's staff logins. Nothing else: it does not carry, assign or approve work.",
    // Deliberately narrow. No task.* and no office.approve, because this
    // account administers people, it does not participate in the work.
    perms: ["staff.manage", "user.manage", "role.manage", "department.manage", "report.view"],
  },
  {
    name: "Head",
    level: 60,
    description:
      "Answers for the office. Receives requests arriving from other offices and approves or rejects them with a reason. Otherwise works like Staff.",
    perms: [
      "task.view_office",
      "task.edit_office",
      "task.assign",
      "task.approve",
      "project.manage_any",
      "team.manage_any",
      "report.view",
      "office.request",
      "office.approve",
    ],
  },
  {
    name: "Staff",
    level: 20,
    isDefault: true,
    description:
      "Everyone who does the work. Creates tasks and projects, adds members, sets project leads, and is assigned work by others.",
    perms: ["task.view_office", "task.edit_office", "task.assign", "office.request"],
  },
];

/**
 * Old roles were really job titles. This maps each historical role name onto
 * (real role, designation) so an existing database lands in the right place.
 */
const LEGACY_ROLE_MAP: Record<string, { role: string; designation?: string }> = {
  "Super Admin": { role: "Super Admin", designation: "System Administrator" },
  "Administrator": { role: "Office Admin", designation: "Administrative Officer" },
  "Office Admin": { role: "Office Admin", designation: "Administrative Officer" },
  // Everything that used to be a seniority tier now collapses onto Head or
  // Staff. Seniority is expressed by designation and by project role instead.
  "Office Head": { role: "Head" },
  "Director General": { role: "Head", designation: "Director General" },
  "Principal Accountant General": { role: "Head", designation: "Principal Accountant General" },
  "Accountant General": { role: "Head", designation: "Accountant General" },
  "Deputy Accountant General": { role: "Head", designation: "Deputy Accountant General" },
  "Department Head": { role: "Head" },
  "Project Lead": { role: "Staff" },
  "Senior Audit Officer": { role: "Staff", designation: "Senior Audit Officer" },
  "Team Lead": { role: "Staff" },
  "Reviewer": { role: "Staff" },
  "Assistant Audit Officer": { role: "Staff", designation: "Assistant Audit Officer" },
  "Supervisor": { role: "Staff", designation: "Supervisor" },
  "Senior Auditor": { role: "Staff", designation: "Senior Auditor" },
  "Auditor": { role: "Staff", designation: "Auditor" },
  "Consultant": { role: "Staff", designation: "Consultant" },
  "Observer": { role: "Staff" },
  "Employee": { role: "Staff" },
  "Member": { role: "Staff" },
};

async function main() {
  const passwordHash = await bcrypt.hash("password123", 12);

  // permissions
  const permByKey: Record<string, string> = {};
  for (const [key, description] of PERMISSIONS) {
    const p = await prisma.permission.upsert({ where: { key }, update: { description }, create: { key, description } });
    permByKey[key] = p.id;
  }

  // organization branding (singleton)
  await prisma.orgSettings.upsert({
    where: { id: "org" },
    update: { primaryColor: "#0B2447", accentColor: "#C1922B" },
    create: { id: "org", name: "CAG Work Management", primaryColor: "#0B2447", accentColor: "#C1922B" },
  });

  // ---- Role templates (officeId null = platform-owned) ----
  // NOTE: upsert cannot be used here. Prisma forbids null in a compound-unique
  // lookup, so `where: { officeId_name: { officeId: null, ... } }` is invalid.
  // Find-then-create is the correct shape for a nullable-scoped unique.
  const roleByName: Record<string, string> = {};
  for (const r of ROLES) {
    const fields = { level: r.level, isSystem: true, isDefault: r.isDefault ?? false, description: r.description };
    const existing = await prisma.role.findFirst({ where: { name: r.name, officeId: null } });
    const role = existing
      ? await prisma.role.update({ where: { id: existing.id }, data: fields })
      : await prisma.role.create({ data: { name: r.name, ...fields } });
    roleByName[r.name] = role.id;
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    for (const key of r.perms) {
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permByKey[key] } });
    }
  }

  // ---- Designations (platform-wide master list) ----
  const desigByName: Record<string, string> = {};
  for (const d of DESIGNATIONS) {
    const fields = { code: d.code, rank: d.rank, isActive: true };
    const existing = await prisma.designation.findFirst({ where: { name: d.name, officeId: null } });
    const rec = existing
      ? await prisma.designation.update({ where: { id: existing.id }, data: fields })
      : await prisma.designation.create({ data: { name: d.name, ...fields } });
    desigByName[d.name] = rec.id;
  }

  // ---- Migrate anyone still sitting on a legacy job-title role ----
  // Old databases had roles called "Director General" and so on. Those are
  // designations; the person needs a real permission-bearing role instead.
  for (const [legacyName, target] of Object.entries(LEGACY_ROLE_MAP)) {
    if (legacyName === target.role && !target.designation) continue;

    const newRoleId = roleByName[target.role];
    // If the target role did not resolve, do nothing at all. Moving people onto
    // `undefined` and then deleting their old role is how you strip everyone's
    // permissions in one pass.
    if (!newRoleId) {
      console.warn(`[seed] skipping "${legacyName}": target role "${target.role}" did not resolve`);
      continue;
    }

    const legacy = await prisma.role.findFirst({ where: { name: legacyName, officeId: null } });
    if (!legacy || legacy.id === newRoleId) continue;

    await prisma.user.updateMany({
      where: { roleId: legacy.id },
      data: {
        roleId: newRoleId,
        ...(target.designation && desigByName[target.designation]
          ? { designationId: desigByName[target.designation] }
          : {}),
      },
    });

    const stillUsed = await prisma.user.count({ where: { roleId: legacy.id } });
    if (stillUsed > 0) {
      console.warn(`[seed] keeping legacy role "${legacyName}": ${stillUsed} user(s) still hold it`);
      continue;
    }
    await prisma.rolePermission.deleteMany({ where: { roleId: legacy.id } });
    await prisma.role.delete({ where: { id: legacy.id } }).catch(() => {});
  }

  // ---- Two offices, so the cross-office request flow can be exercised ----
  const hyd = await prisma.office.upsert({
    where: { code: "COEFA-HYD" },
    update: { isActive: true },
    create: { name: "CoEFA Hyderabad", code: "COEFA-HYD", city: "Hyderabad" },
  });
  const del = await prisma.office.upsert({
    where: { code: "PAG-DEL" },
    update: { isActive: true },
    create: { name: "PAG (Audit) Delhi", code: "PAG-DEL", city: "New Delhi" },
  });

  // Role = what you may DO. Designation = the post you HOLD. Note that a DG and
  // an SAO can share the "Office Head" role while holding different posts.
  const people = [
    { email: "superadmin@cag.gov.in", fullName: "System Administrator", role: "Super Admin", desig: "System Administrator", office: hyd.id, employeeId: "CAG-0000", wing: "IT" },

    // --- CoEFA Hyderabad ---
    { email: "admin.hyd@cag.gov.in", fullName: "Office Admin (Hyderabad)", role: "Office Admin", desig: "Administrative Officer", office: hyd.id, employeeId: "CAG-0001", wing: "Administration" },
    { email: "dg.hyd@cag.gov.in", fullName: "R Menon", role: "Office Head", desig: "Director General", office: hyd.id, employeeId: "CAG-0002", wing: "Director" },
    { email: "dag.hyd@cag.gov.in", fullName: "K Iyer", role: "Office Head", desig: "Deputy Accountant General", office: hyd.id, employeeId: "CAG-0003", wing: "Director" },
    { email: "srk@cag.gov.in", fullName: "S R K", role: "Project Lead", desig: "Senior Audit Officer", office: hyd.id, employeeId: "CAG-0004", wing: "SAO Commercial" },
    { email: "vnr@cag.gov.in", fullName: "V N R", role: "Project Lead", desig: "Senior Audit Officer", office: hyd.id, employeeId: "CAG-0005", wing: "SAO Commercial" },
    { email: "ps@cag.gov.in", fullName: "P S", role: "Reviewer", desig: "Assistant Audit Officer", office: hyd.id, employeeId: "CAG-0006", wing: "IS Wing" },
    { email: "vk@cag.gov.in", fullName: "V K", role: "Employee", desig: "Senior Auditor", office: hyd.id, employeeId: "CAG-0007", wing: "IS Wing" },
    { email: "sup.hyd@cag.gov.in", fullName: "M Rao", role: "Employee", desig: "Supervisor", office: hyd.id, employeeId: "CAG-0008", wing: "IS Wing" },
    { email: "nt@cag.gov.in", fullName: "N T", role: "Observer", desig: "Consultant", office: hyd.id, employeeId: "CAG-0009", wing: "CA Consultants" },

    // --- PAG (Audit) Delhi ---
    { email: "admin.del@cag.gov.in", fullName: "Office Admin (Delhi)", role: "Office Admin", desig: "Administrative Officer", office: del.id, employeeId: "CAG-0101", wing: "Administration" },
    { email: "pag.del@cag.gov.in", fullName: "A Bhattacharya", role: "Office Head", desig: "Principal Accountant General", office: del.id, employeeId: "CAG-0102", wing: "Director" },
    { email: "sao.del@cag.gov.in", fullName: "T Grewal", role: "Project Lead", desig: "Senior Audit Officer", office: del.id, employeeId: "CAG-0103", wing: "Civil Audit" },
    { email: "aao.del@cag.gov.in", fullName: "D Sharma", role: "Reviewer", desig: "Assistant Audit Officer", office: del.id, employeeId: "CAG-0104", wing: "Civil Audit" },
  ];

  const users: Record<string, string> = {};
  for (const p of people) {
    if (!roleByName[p.role]) throw new Error(`[seed] role "${p.role}" did not resolve; aborting before creating ${p.email} with no role`);

    const data = {
      roleId: roleByName[p.role],
      designationId: desigByName[p.desig],
      wing: p.wing,
      officeId: p.office,
      isActive: true,
    };

    // employeeId is unique and independent of email. On a database that already
    // had staff (their cagId became employeeId), the id we want may belong to
    // someone else entirely, so only claim it when it is genuinely free.
    const holder = await prisma.user.findUnique({ where: { employeeId: p.employeeId }, select: { email: true } });
    const employeeId = !holder || holder.email === p.email ? p.employeeId : undefined;
    if (holder && holder.email !== p.email) {
      console.warn(`[seed] employee id ${p.employeeId} already belongs to ${holder.email}; leaving ${p.email} without one`);
    }

    const u = await prisma.user.upsert({
      where: { email: p.email },
      update: data,
      create: { ...data, email: p.email, fullName: p.fullName, employeeId, passwordHash },
    });
    users[p.email] = u.id;
  }

  // ---- Office heads: the officers who approve incoming cross-office work ----
  await prisma.office.update({ where: { id: hyd.id }, data: { headId: users["dg.hyd@cag.gov.in"] } });
  await prisma.office.update({ where: { id: del.id }, data: { headId: users["pag.del@cag.gov.in"] } });

  // ---- Departments ----
  const DEPTS = [
    { id: "seed-dept-comm", name: "SAO Commercial", code: "COMM", office: hyd.id },
    { id: "seed-dept-is", name: "IS Wing", code: "IS", office: hyd.id },
    { id: "seed-dept-ca", name: "CA Consultants", code: "CA", office: hyd.id },
    { id: "seed-dept-admin", name: "Administration", code: "ADMIN", office: hyd.id },
    { id: "seed-dept-del-civil", name: "Civil Audit", code: "CIVIL", office: del.id },
    { id: "seed-dept-del-admin", name: "Administration", code: "DEL-ADMIN", office: del.id },
  ];
  for (const d of DEPTS) {
    await prisma.department.upsert({
      where: { id: d.id },
      update: { name: d.name, code: d.code, officeId: d.office },
      create: { id: d.id, name: d.name, code: d.code, officeId: d.office },
    });
  }

  // department membership + reporting line
  const assign = [
    { email: "dg.hyd@cag.gov.in", dept: "seed-dept-admin", mgr: null },
    { email: "dag.hyd@cag.gov.in", dept: "seed-dept-admin", mgr: "dg.hyd@cag.gov.in" },
    { email: "admin.hyd@cag.gov.in", dept: "seed-dept-admin", mgr: "dg.hyd@cag.gov.in" },
    { email: "srk@cag.gov.in", dept: "seed-dept-comm", mgr: "dag.hyd@cag.gov.in" },
    { email: "vnr@cag.gov.in", dept: "seed-dept-comm", mgr: "srk@cag.gov.in" },
    { email: "nt@cag.gov.in", dept: "seed-dept-ca", mgr: "srk@cag.gov.in" },
    { email: "ps@cag.gov.in", dept: "seed-dept-is", mgr: "srk@cag.gov.in" },
    { email: "vk@cag.gov.in", dept: "seed-dept-is", mgr: "ps@cag.gov.in" },
    { email: "sup.hyd@cag.gov.in", dept: "seed-dept-is", mgr: "ps@cag.gov.in" },
    { email: "pag.del@cag.gov.in", dept: "seed-dept-del-admin", mgr: null },
    { email: "admin.del@cag.gov.in", dept: "seed-dept-del-admin", mgr: "pag.del@cag.gov.in" },
    { email: "sao.del@cag.gov.in", dept: "seed-dept-del-civil", mgr: "pag.del@cag.gov.in" },
    { email: "aao.del@cag.gov.in", dept: "seed-dept-del-civil", mgr: "sao.del@cag.gov.in" },
  ];
  for (const a of assign) {
    await prisma.user.update({
      where: { id: users[a.email] },
      data: { departmentId: a.dept, managerId: a.mgr ? users[a.mgr] : null },
    });
  }

  // department heads
  await prisma.department.update({ where: { id: "seed-dept-comm" }, data: { headId: users["srk@cag.gov.in"] } });
  await prisma.department.update({ where: { id: "seed-dept-is" }, data: { headId: users["ps@cag.gov.in"] } });
  await prisma.department.update({ where: { id: "seed-dept-ca" }, data: { headId: users["nt@cag.gov.in"] } });
  await prisma.department.update({ where: { id: "seed-dept-admin" }, data: { headId: users["dag.hyd@cag.gov.in"] } });
  await prisma.department.update({ where: { id: "seed-dept-del-civil" }, data: { headId: users["sao.del@cag.gov.in"] } });

  // A project, not a standing team: the working group exists for this work.
  const project = await prisma.project.upsert({
    where: { id: "seed-project-commercial" },
    update: {},
    create: {
      id: "seed-project-commercial",
      name: "Commercial Audit 2026",
      description: "SAO Commercial working group",
      officeId: hyd.id,
      departmentId: "seed-dept-comm",
      createdById: users["srk@cag.gov.in"],
      dueDate: day(45),
      members: {
        create: [
          { userId: users["srk@cag.gov.in"], role: "PRIMARY_LEAD" },
          { userId: users["vnr@cag.gov.in"], role: "SECONDARY_LEAD" },
          { userId: users["nt@cag.gov.in"], role: "OBSERVER" },
          { userId: users["ps@cag.gov.in"], role: "MEMBER" },
        ],
      },
    },
  });

  const existingTasks = await prisma.task.count();
  if (existingTasks === 0) {
    const tasks = [
      { title: "Website update", status: TaskStatus.IN_PROGRESS, pl: "ps@cag.gov.in", sl: "vk@cag.gov.in", due: day(3), pct: 70, priority: TaskPriority.HIGH },
      { title: "AnyAudit PoC", status: TaskStatus.IN_PROGRESS, pl: "vnr@cag.gov.in", sl: "nt@cag.gov.in", due: day(-2), pct: 50, priority: TaskPriority.URGENT },
      { title: "Newsletter articles", status: TaskStatus.INITIATED, pl: "srk@cag.gov.in", sl: "ps@cag.gov.in", due: day(10), pct: 20, priority: TaskPriority.NORMAL },
      { title: "SGPFR review", status: TaskStatus.IN_PROGRESS, pl: "vnr@cag.gov.in", sl: null, due: day(1), pct: 80, priority: TaskPriority.HIGH },
      { title: "ERP navigators launch", status: TaskStatus.FINISHED, pl: "nt@cag.gov.in", sl: "srk@cag.gov.in", due: day(-6), pct: 100, priority: TaskPriority.NORMAL },
      { title: "Data hub onboarding", status: TaskStatus.INITIATED, pl: "ps@cag.gov.in", sl: "vk@cag.gov.in", due: day(20), pct: 0, priority: TaskPriority.LOW },
    ];
    for (const t of tasks) {
      await prisma.task.create({
        data: {
          title: t.title,
          status: t.status,
          priority: t.priority,
          owningOfficeId: hyd.id,
          executingOfficeId: hyd.id,
          projectId: project.id,
          primaryLeadId: users[t.pl],
          secondaryLeadId: t.sl ? users[t.sl] : null,
          currentlyWithId: users[t.pl],
          createdById: users["dg.hyd@cag.gov.in"],
          assignedDate: day(-14),
          dueDate: t.due,
          pctComplete: t.pct,
        },
      });
    }
  }

  // ---- Repair: every work item must have an owning office ----
  // Items created before the owning/executing split can have neither. Fall back
  // to the office of whoever holds or created it, so they stop being invisible.
  const orphanTasks = await prisma.task.findMany({
    where: { owningOfficeId: null },
    select: {
      id: true,
      currentlyWith: { select: { officeId: true } },
      primaryLead: { select: { officeId: true } },
      createdBy: { select: { officeId: true } },
      project: { select: { officeId: true } },
    },
  });
  let fixedTasks = 0;
  for (const t of orphanTasks) {
    const officeId =
      t.project?.officeId ?? t.currentlyWith?.officeId ?? t.primaryLead?.officeId ?? t.createdBy?.officeId ?? hyd.id;
    await prisma.task.update({
      where: { id: t.id },
      data: { owningOfficeId: officeId, executingOfficeId: officeId },
    });
    fixedTasks++;
  }
  if (fixedTasks) console.log(`Gave ${fixedTasks} work item(s) an owning office.`);

  // Anyone with no office sees nothing at all, so put them somewhere.
  const homeless = await prisma.user.findMany({ where: { officeId: null }, select: { id: true, email: true } });
  if (homeless.length) {
    await prisma.user.updateMany({ where: { officeId: null }, data: { officeId: hyd.id } });
    console.log(`Placed ${homeless.length} account(s) with no office into CoEFA Hyderabad: ${homeless.map((u) => u.email).join(", ")}`);
    console.log("Move them to the right office from the Staff screen.");
  }

  // ---- Repair: nobody may be left without a role ----
  // An earlier version of this seed could null out roleId when retiring a
  // legacy role. Anyone still in that state is put back on the default role.
  const roleless = await prisma.user.findMany({ where: { roleId: null }, select: { id: true, email: true } });
  if (roleless.length) {
    const fallback = ROLES.find((r) => r.isDefault)?.name ?? "Employee";
    await prisma.user.updateMany({ where: { roleId: null }, data: { roleId: roleByName[fallback] } });
    console.log(`Repaired ${roleless.length} account(s) that had no role: ${roleless.map((u) => u.email).join(", ")}`);
    console.log(`They were given the "${fallback}" role. Reassign from the Staff screen if that is wrong.`);
  }

  console.log("Seed complete.");
  console.log("Offices:      CoEFA Hyderabad (head: R Menon, DG), PAG Delhi (head: A Bhattacharya, PAG)");
  console.log("Roles:        " + ROLES.map((r) => `${r.name}(${r.level})`).join(", "));
  console.log("Designations: " + DESIGNATIONS.map((d) => d.code).join(", "));
  console.log("Note:         Role = permissions. Designation = the post held. They are separate now.");
  console.log("");
  console.log("All seeded accounts use the password  password123");
  console.log("  Super Admin        superadmin@cag.gov.in");
  console.log("  Office Admin (HYD) admin.hyd@cag.gov.in");
  console.log("  DG / office head   dg.hyd@cag.gov.in");
  console.log("  Office Admin (DEL) admin.del@cag.gov.in");
  console.log("  PAG / office head  pag.del@cag.gov.in");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
