import { prisma } from "../src/prisma";

/**
 * Repair: office admins that were minted as Super Admins.
 *
 * The office-creation endpoint used to pick "the highest-level role granting
 * staff.manage". Super Admin grants every permission, staff.manage included,
 * and outranks Office Admin, so it won. Every office created through that path
 * got a platform operator login instead of an office one, which meant it could
 * see every office's work.
 *
 * This finds those accounts and moves them onto the real Office Admin role.
 *
 * An account is repaired when ALL of these hold:
 *   - it holds office.manage_all (so it is currently a platform role)
 *   - it is attached to an office
 *   - it was created by somebody (the true Super Admin is seeded, not created)
 *
 * That last condition is what protects your original Super Admin login. Run
 * with --dry to see what would change without touching anything.
 */

const DRY = process.argv.includes("--dry");

async function main() {
  const officeAdminRole = await prisma.role.findFirst({
    where: {
      name: "Office Admin",
      officeId: null,
      permissions: { some: { permission: { key: "staff.manage" } } },
      NOT: { permissions: { some: { permission: { key: "office.manage_all" } } } },
    },
    select: { id: true, name: true, level: true },
  });

  if (!officeAdminRole) {
    console.error('No clean "Office Admin" role found. Run `npm run seed` first, then re-run this.');
    process.exit(1);
  }

  const suspects = await prisma.user.findMany({
    where: {
      deletedAt: null,
      officeId: { not: null },
      createdById: { not: null },
      role: { permissions: { some: { permission: { key: "office.manage_all" } } } },
    },
    select: {
      id: true,
      fullName: true,
      email: true,
      office: { select: { name: true } },
      role: { select: { name: true, level: true } },
      createdBy: { select: { fullName: true } },
    },
  });

  if (!suspects.length) {
    console.log("Nothing to repair: no office account holds a platform role.");
    return;
  }

  console.log(`Found ${suspects.length} account(s) wrongly holding a platform role:\n`);
  for (const u of suspects) {
    console.log(`  ${u.fullName}  <${u.email}>`);
    console.log(`      office:  ${u.office?.name ?? "(none)"}`);
    console.log(`      role:    ${u.role?.name} (level ${u.role?.level})  ->  ${officeAdminRole.name} (level ${officeAdminRole.level})`);
    console.log(`      created by: ${u.createdBy?.fullName ?? "(unknown)"}\n`);
  }

  if (DRY) {
    console.log("Dry run. Nothing was changed. Re-run without --dry to apply.");
    return;
  }

  const { count } = await prisma.user.updateMany({
    where: { id: { in: suspects.map((u) => u.id) } },
    data: { roleId: officeAdminRole.id },
  });

  console.log(`Repaired ${count} account(s).`);
  console.log("Those users must sign out and sign in again for their new permissions to take effect.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
