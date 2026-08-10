#!/usr/bin/env node
/**
 * Diagnostic. Answers "is my database in the state the app expects?" without
 * making you read Prisma stack traces.
 *
 *   npm run doctor
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
let problems = 0;

function ok(msg: string) {
  console.log(`  \u2713 ${msg}`);
}
function bad(msg: string, fix: string) {
  problems++;
  console.log(`  \u2717 ${msg}`);
  console.log(`      fix: ${fix}`);
}

async function main() {
  console.log("\nCAG WMS doctor\n");

  // --- schema present? ---
  console.log("Schema");
  try {
    await prisma.$queryRaw`SELECT 1`;
    ok("Database reachable");
  } catch {
    bad("Cannot reach the database", "check DATABASE_URL in server/.env");
  }
  try {
    await prisma.$queryRaw`SELECT 1 FROM Designation LIMIT 1`;
    ok("Designation table exists");
  } catch {
    bad("Designation table missing", "npx prisma migrate deploy");
  }
  try {
    await prisma.$queryRaw`SELECT owningOfficeId FROM Task LIMIT 1`;
    ok("Task.owningOfficeId exists");
  } catch {
    bad("Task still has the old officeId column", "npx prisma migrate deploy");
  }
  try {
    await prisma.$queryRaw`SELECT 1 FROM Team LIMIT 1`;
    bad("Team table still exists", "npx prisma migrate deploy (the v2 migration drops it)");
  } catch {
    ok("Team table is gone, as expected");
  }

  // Everything below uses raw SQL on purpose. The typed client is generated
  // from the schema, so it throws the moment schema and database disagree,
  // which is exactly the situation a doctor has to be able to report on.
  const num = async (sql: string): Promise<number | null> => {
    try {
      const rows = await prisma.$queryRawUnsafe<{ n: bigint | number }[]>(sql);
      return Number(rows[0]?.n ?? 0);
    } catch {
      return null;
    }
  };

  // --- roles ---
  console.log("\nRoles & permissions");
  const templates = await num("SELECT COUNT(*) AS n FROM Role WHERE officeId IS NULL");
  if (templates === null) bad("Role table has no officeId column", "npx prisma migrate deploy");
  else if (templates === 0) bad("No role templates", "npm run seed");
  else ok(`${templates} role templates`);

  const roleless = await num("SELECT COUNT(*) AS n FROM User WHERE roleId IS NULL");
  if (roleless === null) bad("Cannot read User.roleId", "npx prisma migrate deploy");
  else if (roleless > 0) bad(`${roleless} account(s) have NO ROLE and can do nothing`, "npm run seed (it repairs these)");
  else ok("Every account has a role");

  const supers = await num(`SELECT COUNT(DISTINCT u.id) AS n FROM User u
      JOIN RolePermission rp ON rp.roleId = u.roleId
      JOIN Permission p ON p.id = rp.permissionId
      WHERE p.\`key\` = 'office.manage_all'`);
  if (supers === null) bad("Cannot read permissions", "npx prisma migrate deploy");
  else if (supers === 0) bad("No account holds office.manage_all", "npm run seed");
  else ok(`${supers} account(s) can administer the platform`);

  // --- designations ---
  console.log("\nDesignations");
  const desigs = await num("SELECT COUNT(*) AS n FROM Designation");
  if (desigs === null) bad("Designation table missing", "npx prisma migrate deploy");
  else if (desigs === 0) bad("No designations", "npm run seed");
  else ok(`${desigs} designations`);

  // --- data ---
  console.log("\nData");
  const offices = await num("SELECT COUNT(*) AS n FROM Office");
  const users = await num("SELECT COUNT(*) AS n FROM User");
  const projects = await num("SELECT COUNT(*) AS n FROM Project");
  const tasks = await num("SELECT COUNT(*) AS n FROM Task");
  ok(`${offices ?? "?"} offices, ${users ?? "?"} users, ${projects ?? "?"} projects, ${tasks ?? "?"} work items`);

  const orphanTasks = await num("SELECT COUNT(*) AS n FROM Task WHERE owningOfficeId IS NULL");
  if (orphanTasks !== null && orphanTasks > 0) bad(`${orphanTasks} work item(s) have no owning office`, "npm run seed");
  else if (orphanTasks === 0) ok("Every work item has an owning office");

  const noOffice = await num("SELECT COUNT(*) AS n FROM User WHERE officeId IS NULL");
  if (noOffice !== null && noOffice > 0) bad(`${noOffice} user(s) belong to no office and will see nothing`, "assign them from the Staff screen");
  else if (noOffice === 0) ok("Every user belongs to an office");

  console.log(problems === 0 ? "\nAll good.\n" : `\n${problems} problem(s) found.\n`);
  process.exit(problems === 0 ? 0 : 1);
}

main()
  .catch((e) => {
    console.error("\nDoctor could not connect or query:\n", e instanceof Error ? e.message : e);
    console.error("\nUsually this means DATABASE_URL is wrong, or `npx prisma generate` has not been run.\n");
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
