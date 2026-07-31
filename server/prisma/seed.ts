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
  ["task.view_all", "View all work items across the organization"],
  ["task.view_office", "View all work items in own office/department"],
  ["task.edit_any", "Edit any work item"],
  ["task.edit_office", "Edit work items in own office/department"],
  ["task.assign", "Assign work to others"],
  ["task.approve", "Approve incoming or cross-department work"],
  ["team.manage_any", "Manage membership of any team"],
  ["user.manage", "Create and edit user accounts"],
  ["role.manage", "Manage roles and assign roles to users"],
  ["office.manage", "Manage offices and departments"],
  ["org.manage", "Manage organization branding and settings"],
  ["department.manage", "Create and manage departments and org hierarchy"],
  ["report.view", "View organization and department reports"],
];

const ALL = PERMISSIONS.map((p) => p[0]);

// ---- Roles: renamable/editable by an admin later. isDefault -> new sign-ups ----
const ROLES: { name: string; level: number; isDefault?: boolean; description: string; perms: string[] }[] = [
  { name: "Super Admin", level: 100, description: "Unrestricted access to everything.", perms: ALL },
  { name: "Administrator", level: 90, description: "Organization administration and user/role management.", perms: ALL },
  {
    name: "Department Head",
    level: 70,
    description: "Leads a department/office; approves incoming work.",
    perms: ["task.view_office", "task.edit_office", "task.assign", "task.approve", "team.manage_any", "report.view"],
  },
  { name: "Team Lead", level: 50, description: "Leads a team and can assign work.", perms: ["task.assign", "report.view"] },
  { name: "Member", level: 10, isDefault: true, description: "Standard user. Default for new sign-ups.", perms: [] },
];

async function main() {
  const passwordHash = await bcrypt.hash("password123", 12);

  // permissions
  const permByKey: Record<string, string> = {};
  for (const [key, description] of PERMISSIONS) {
    const p = await prisma.permission.upsert({
      where: { key },
      update: { description },
      create: { key, description },
    });
    permByKey[key] = p.id;
  }

  // organization branding (singleton)
  await prisma.orgSettings.upsert({
    where: { id: "org" },
    update: { primaryColor: "#0B2447", accentColor: "#C1922B" },
    create: { id: "org", name: "CAG Work Management", primaryColor: "#0B2447", accentColor: "#C1922B" },
  });

  // roles + their permissions
  const roleByName: Record<string, string> = {};
  for (const r of ROLES) {
    const role = await prisma.role.upsert({
      where: { name: r.name },
      update: { level: r.level, isSystem: true, isDefault: r.isDefault ?? false, description: r.description },
      create: { name: r.name, level: r.level, isSystem: true, isDefault: r.isDefault ?? false, description: r.description },
    });
    roleByName[r.name] = role.id;
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    for (const key of r.perms) {
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permByKey[key] } });
    }
  }

  const office = await prisma.office.upsert({
    where: { code: "COEFA-HYD" },
    update: {},
    create: { name: "CoEFA Hyderabad", code: "COEFA-HYD", city: "Hyderabad" },
  });

  // Note: designation is FREE TEXT (any title). role is a managed, assignable role.
  const people = [
    { email: "admin@cag.gov.in", fullName: "Director (Admin)", roleName: "Super Admin", cagId: "CAG-0001", wing: "Director", designation: "Director General" },
    { email: "srk@cag.gov.in", fullName: "S R K", roleName: "Department Head", cagId: "CAG-0002", wing: "SAO Commercial", designation: "Senior Audit Officer" },
    { email: "vnr@cag.gov.in", fullName: "V N R", roleName: "Team Lead", cagId: "CAG-0003", wing: "SAO Commercial", designation: "Senior Audit Officer (Commercial)" },
    { email: "ps@cag.gov.in", fullName: "P S", roleName: "Member", cagId: "CAG-0004", wing: "IS Wing", designation: "Assistant Audit Officer" },
    { email: "vk@cag.gov.in", fullName: "V K", roleName: "Member", cagId: "CAG-0005", wing: "IS Wing", designation: "Data Analyst" },
    { email: "nt@cag.gov.in", fullName: "N T", roleName: "Member", cagId: "CAG-0006", wing: "CA Consultants", designation: "Consultant" },
  ];

  const users: Record<string, string> = {};
  for (const p of people) {
    const u = await prisma.user.upsert({
      where: { email: p.email },
      update: { roleId: roleByName[p.roleName], designation: p.designation, wing: p.wing },
      create: {
        email: p.email,
        fullName: p.fullName,
        cagId: p.cagId,
        wing: p.wing,
        designation: p.designation,
        passwordHash,
        officeId: office.id,
        roleId: roleByName[p.roleName],
      },
    });
    users[p.email] = u.id;
  }

  const team = await prisma.team.upsert({
    where: { id: "seed-team-commercial" },
    update: {},
    create: {
      id: "seed-team-commercial",
      name: "Commercial Audit",
      description: "SAO Commercial working group",
      officeId: office.id,
      ownerId: users["srk@cag.gov.in"],
      members: {
        create: [
          { userId: users["srk@cag.gov.in"], roleInTeam: "lead" },
          { userId: users["vnr@cag.gov.in"], roleInTeam: "member" },
          { userId: users["nt@cag.gov.in"], roleInTeam: "member" },
        ],
      },
    },
  });

  // ---- Departments + hierarchy ----
  const DEPTS = [
    { id: "seed-dept-comm", name: "SAO Commercial", code: "COMM" },
    { id: "seed-dept-is", name: "IS Wing", code: "IS" },
    { id: "seed-dept-ca", name: "CA Consultants", code: "CA" },
    { id: "seed-dept-admin", name: "Administration", code: "ADMIN" },
  ];
  for (const d of DEPTS) {
    await prisma.department.upsert({
      where: { id: d.id },
      update: { name: d.name, code: d.code, officeId: office.id },
      create: { id: d.id, name: d.name, code: d.code, officeId: office.id },
    });
  }

  // department membership + reporting manager (who reports to whom)
  const assign = [
    { email: "srk@cag.gov.in", dept: "seed-dept-comm", mgr: "admin@cag.gov.in" },
    { email: "vnr@cag.gov.in", dept: "seed-dept-comm", mgr: "srk@cag.gov.in" },
    { email: "nt@cag.gov.in", dept: "seed-dept-ca", mgr: "srk@cag.gov.in" },
    { email: "ps@cag.gov.in", dept: "seed-dept-is", mgr: "srk@cag.gov.in" },
    { email: "vk@cag.gov.in", dept: "seed-dept-is", mgr: "ps@cag.gov.in" },
  ];
  for (const a of assign) {
    await prisma.user.update({
      where: { id: users[a.email] },
      data: { departmentId: a.dept, managerId: users[a.mgr] },
    });
  }

  // department heads
  await prisma.department.update({ where: { id: "seed-dept-comm" }, data: { headId: users["srk@cag.gov.in"] } });
  await prisma.department.update({ where: { id: "seed-dept-is" }, data: { headId: users["ps@cag.gov.in"] } });
  await prisma.department.update({ where: { id: "seed-dept-ca" }, data: { headId: users["nt@cag.gov.in"] } });

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
          officeId: office.id,
          teamId: team.id,
          primaryLeadId: users[t.pl],
          secondaryLeadId: t.sl ? users[t.sl] : null,
          currentlyWithId: users[t.pl],
          createdById: users["admin@cag.gov.in"],
          assignedDate: day(-14),
          dueDate: t.due,
          pctComplete: t.pct,
        },
      });
    }
  }

  console.log("Seed complete.");
  console.log("Roles seeded:", ROLES.map((r) => r.name).join(", "));
  console.log("Login with  admin@cag.gov.in  /  password123  (Super Admin)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
