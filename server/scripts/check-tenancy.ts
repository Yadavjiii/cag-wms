#!/usr/bin/env node
/**
 * Tenant-isolation checker.
 *
 * Reads every route file and flags Prisma queries against office-owned tables
 * that carry no visible office predicate. It is a lint, not a proof: it cannot
 * follow a where-clause built three functions away. What it does do is make the
 * *absence* of a scope loud at build time instead of silent at runtime, which
 * is the failure mode that actually bit us.
 *
 * Run:  npm run check:tenancy
 * Exit: 1 if anything is unscoped, so CI fails.
 *
 * To silence a deliberate cross-office query, put `platform-scope:` and a
 * reason on the line above it.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Tables that belong to exactly one office. Querying these needs a scope. */
const OFFICE_OWNED = [
  "user",
  "project",
  "projectMember",
  "task",
  "department",
  "designation",
  "role",
  "meeting",
];

/**
 * Anything here counts as evidence the office boundary was considered: either
 * an explicit predicate, or one of the load-then-authorise helpers that has
 * already thrown if the record belongs elsewhere.
 */
const SCOPE_MARKERS = [
  // explicit predicates
  "officeScope(",
  "taskOfficeScope(",
  "officeId",
  "owningOfficeId",
  "executingOfficeId",
  "headsOfficeIds",
  // visibility helpers
  "taskVisibility",
  "projectVisibility",
  "teamVisibility",
  // load-then-authorise guards, which throw before we ever reach the write
  "assertSameOffice(",
  "assertOfficeScope(",
  "loadProject(",
  "loadAssignment(",
  "loadStaff(",
  "canEdit(",
  "canDelete(",
  "canManage(",
  "canManageDept(",
  "isApprover(",
  "isGlobalAdmin",
  // deliberate, documented exceptions
  "runPlatformScope(",
  "platform-scope:",
];

/** Reads that cannot leak a list: single-row by unique key, or aggregates. */
const SAFE_METHODS = ["findUnique", "count", "aggregate", "groupBy"];

/**
 * A write keyed on the caller's own id, or on an id loaded and checked earlier
 * in the same handler, is not a boundary risk. The dangerous shape is a query
 * that returns or mutates a SET without naming an office.
 */
const SELF_PATTERNS = ["req.user!.id", "req.user?.id", "user.id }", "userId: req.user"];

const ROUTES_DIR = join(process.cwd(), "src", "routes");

interface Finding {
  file: string;
  line: number;
  snippet: string;
}

const findings: Finding[] = [];

function check(file: string) {
  const text = readFileSync(join(ROUTES_DIR, file), "utf8");
  const lines = text.split("\n");

  lines.forEach((line, i) => {
    const m = line.match(/prisma\.(\w+)\.(\w+)\(/);
    if (!m) return;

    const [, model, method] = m;
    if (!OFFICE_OWNED.includes(model)) return;
    if (SAFE_METHODS.includes(method)) return;

    // Look backwards far enough to see the handler's authorisation guard, and
    // forwards far enough to see a wrapped where clause. Import lines are
    // stripped: `import { isGlobalAdmin }` at the top of a file would otherwise
    // give every query in the first 30 lines a free pass, which is precisely
    // how a real leak slipped through the first version of this script.
    const window = lines
      .slice(Math.max(0, i - 30), i + 20)
      .filter((l) => !/^\s*import\s/.test(l))
      .join("\n");
    if (SCOPE_MARKERS.some((marker) => window.includes(marker))) return;

    const call = lines.slice(i, i + 6).join("\n");
    if (SELF_PATTERNS.some((pat) => call.includes(pat))) return;

    findings.push({ file, line: i + 1, snippet: line.trim().slice(0, 100) });
  });
}

const files = readdirSync(ROUTES_DIR).filter((f) => f.endsWith(".ts"));
files.forEach(check);

if (findings.length === 0) {
  console.log(`\u2713 tenancy: ${files.length} route files scanned, every office-owned query is scoped.`);
  process.exit(0);
}

console.error(`\n\u2717 tenancy: ${findings.length} query(ies) on office-owned tables with no visible office scope:\n`);
for (const f of findings) {
  console.error(`  ${f.file}:${f.line}`);
  console.error(`    ${f.snippet}\n`);
}
console.error("Each of these can read across the office boundary.");
console.error("Fix by adding officeScope() / taskOfficeScope() / assertSameOffice(),");
console.error("or, if it is genuinely platform-wide, add a `platform-scope: <reason>` comment above it.\n");
process.exit(1);
