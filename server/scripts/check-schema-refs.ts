#!/usr/bin/env node
/**
 * Schema-reference checker.
 *
 * Reads prisma/schema.prisma, then checks that field names used in Prisma
 * queries actually exist on the model. This catches the "Unknown field X for
 * select statement on model Y" class of runtime error at build time.
 *
 * It exists because that class of bug reached production three times: renaming
 * a relation (Office.tasks -> owningTasks/executingTasks) leaves every
 * `_count: { select: { tasks: true } }` silently broken until someone loads the
 * page. TypeScript does catch this, but only when the generated Prisma client
 * is up to date, and the whole failure mode is that it isn't.
 *
 * Run:  npm run check:schema-refs
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Parse the schema into model -> { scalars, relations }
// ---------------------------------------------------------------------------
interface Model {
  name: string;
  fields: Set<string>;
  /** List-valued relations, i.e. the only things _count can count. */
  listRelations: Set<string>;
}

function parseSchema(path: string): Map<string, Model> {
  const src = readFileSync(path, "utf8");
  const models = new Map<string, Model>();

  const modelBlocks = src.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm);
  for (const m of modelBlocks) {
    const [, name, body] = m;
    const fields = new Set<string>();
    const listRelations = new Set<string>();

    for (const raw of body.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("//") || line.startsWith("@@")) continue;
      const fm = line.match(/^(\w+)\s+([\w\[\]?]+)/);
      if (!fm) continue;
      const [, field, type] = fm;
      fields.add(field);
      if (type.endsWith("[]")) listRelations.add(field);
    }
    models.set(name, { name, fields, listRelations });
  }
  return models;
}

const SCHEMA = join(process.cwd(), "prisma", "schema.prisma");
const models = parseSchema(SCHEMA);

if (models.size === 0) {
  console.error("Could not parse any models from prisma/schema.prisma");
  process.exit(1);
}

// Every field name that exists anywhere, for typo detection.
const allFields = new Set<string>();
for (const m of models.values()) for (const f of m.fields) allFields.add(f);

// ---------------------------------------------------------------------------
// Scan source for _count blocks and validate them
// ---------------------------------------------------------------------------
interface Finding {
  file: string;
  line: number;
  detail: string;
}
const findings: Finding[] = [];

function checkFile(dir: string, file: string) {
  const text = readFileSync(join(dir, file), "utf8");
  const lines = text.split("\n");

  // _count: { select: { a: true, b: true } }
  const re = /_count:\s*\{\s*select:\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const keys = [...m[1].matchAll(/(\w+)\s*:/g)].map((k) => k[1]);
    if (keys.length === 0) continue;

    const line = text.slice(0, m.index).split("\n").length;

    // A _count block is valid if SOME model has every one of these as a list
    // relation. If none does, the combination cannot be right for any model.
    const fits = [...models.values()].filter((mod) => keys.every((k) => mod.listRelations.has(k)));
    if (fits.length > 0) continue;

    // Report the closest miss so the message is actionable.
    let best: { model: Model; missing: string[] } | null = null;
    for (const mod of models.values()) {
      const missing = keys.filter((k) => !mod.listRelations.has(k));
      if (!best || missing.length < best.missing.length) best = { model: mod, missing };
    }
    findings.push({
      file,
      line,
      detail:
        `_count on { ${keys.join(", ")} } matches no model.\n` +
        `      closest is ${best!.model.name}, which has no ${best!.missing.join(", ")}\n` +
        `      ${best!.model.name} can count: ${[...best!.model.listRelations].join(", ") || "(nothing)"}`,
    });
  }

  // Field names that exist in no model at all: almost always a rename left
  // behind. Only checked INSIDE a select/include block, because plain object
  // literals like res.json({ totals: ... }) are not Prisma field references.
  let depth = 0;
  let inPrismaObject = false;
  lines.forEach((ln, i) => {
    if (!inPrismaObject && /\b(select|include)\s*:\s*\{/.test(ln)) {
      inPrismaObject = true;
      depth = 0;
    }
    if (inPrismaObject) {
      depth += (ln.match(/\{/g) ?? []).length - (ln.match(/\}/g) ?? []).length;
      if (depth <= 0) {
        inPrismaObject = false;
        return;
      }
    } else {
      return;
    }

    const sel = ln.match(/^\s*(\w+):\s*(true|\{)/);
    if (!sel) return;
    const field = sel[1];
    if (allFields.has(field)) return;
    const IGNORE = new Set([
      "select", "include", "where", "data", "orderBy", "take", "skip", "cursor",
      "distinct", "_count", "_sum", "_avg", "_min", "_max", "some", "every", "none",
      "equals", "not", "in", "notIn", "lt", "lte", "gt", "gte", "contains",
      "startsWith", "endsWith", "mode", "AND", "OR", "NOT", "create", "update",
      "upsert", "connect", "disconnect", "set", "push", "increment", "decrement",
      "type", "provider", "url", "id", "by", "having", "omit",
    ]);
    if (IGNORE.has(field)) return;
    findings.push({ file, line: i + 1, detail: `"${field}" is not a field on any model in schema.prisma` });
  });
}

for (const dir of [join(process.cwd(), "src", "routes"), join(process.cwd(), "src", "services")]) {
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
  } catch {
    continue;
  }
  for (const f of files) checkFile(dir, f);
}

if (findings.length === 0) {
  console.log(`\u2713 schema refs: ${models.size} models parsed, every field reference resolves.`);
  process.exit(0);
}

console.error(`\n\u2717 schema refs: ${findings.length} reference(s) do not match prisma/schema.prisma:\n`);
for (const f of findings) {
  console.error(`  ${f.file}:${f.line}`);
  console.error(`    ${f.detail}\n`);
}
console.error("These become 'Unknown field' errors at runtime, on whichever page hits them first.\n");
process.exit(1);
