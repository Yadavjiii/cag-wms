import { prisma } from "../src/prisma";

/**
 * Who can see across every office?
 *
 * `office.manage_all` is the permission that lifts the office boundary. Anyone
 * holding it sees every office's staff, work and reports. There should be
 * exactly one such account: the platform operator.
 *
 * Read-only. It changes nothing, it only tells you what is there.
 */

async function main() {
  const holders = await prisma.user.findMany({
    where: {
      deletedAt: null,
      role: { permissions: { some: { permission: { key: "office.manage_all" } } } },
    },
    orderBy: [{ createdAt: "asc" }],
    select: {
      id: true,
      fullName: true,
      email: true,
      isActive: true,
      createdAt: true,
      lastLoginAt: true,
      office: { select: { name: true } },
      role: { select: { name: true, level: true } },
      createdBy: { select: { fullName: true } },
    },
  });

  console.log(`\nAccounts that can see across every office: ${holders.length}\n`);

  for (const u of holders) {
    const seeded = !u.createdBy;
    console.log(`  ${u.fullName}  <${u.email}>`);
    console.log(`      role:     ${u.role?.name} (level ${u.role?.level})`);
    console.log(`      office:   ${u.office?.name ?? "(not attached to an office)"}`);
    console.log(`      active:   ${u.isActive ? "yes" : "no"}`);
    console.log(`      created:  ${seeded ? "by the seed (this is the original operator)" : `by ${u.createdBy?.fullName}`}`);
    console.log(`      last in:  ${u.lastLoginAt ? u.lastLoginAt.toISOString().slice(0, 16).replace("T", " ") : "never"}`);
    console.log("");
  }

  if (holders.length <= 1) {
    console.log("That is the expected state: one platform operator.\n");
    return;
  }

  console.log("More than one account holds platform scope.");
  console.log("Anything created by the seed is legitimate. For the rest, decide per account:");
  console.log("  - still needed  -> leave it");
  console.log("  - a leftover    -> move it to another role on the Roles page, or delete the account\n");

  const officeAdmin = await prisma.role.findFirst({
    where: { name: "Office Admin", officeId: null },
    select: { id: true },
  });
  if (officeAdmin) {
    console.log("To demote one by hand, in MySQL Workbench:");
    console.log(`  UPDATE User SET roleId = '${officeAdmin.id}' WHERE email = 'the@address.here';\n`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
