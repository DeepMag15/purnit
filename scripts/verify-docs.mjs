import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Documentation integrity check — ARCHITECTURE.md / CHANGELOG.md / CONTEXT.md
 * against the actual implementation.
 *
 * ⚠️ Why this exists. ARCHITECTURE.md §1.1 makes keeping these three files in
 * sync a permanent requirement, and a rule nobody can check is a preference.
 * Every assertion below is derived from source — a count is re-derived from
 * the spec that owns it, a claimed mutation is looked up in the file that
 * exports it — so the docs cannot quietly drift the way they already have
 * twice:
 *
 *   - `student.register`'s "deliberately NO backing Project", untrue once
 *     Contextual Reporting added one;
 *   - `myAssignments.list`'s "this platform has no student submission model",
 *     untrue once the Documents review added one;
 *   - §15.1 rule 4's "29 mutations and ~40 data sources", actually 33 and 55.
 *
 * Two kinds of check live here. The **generic** ones (declared-exception
 * counts, table integrity, CHANGELOG heading levels) apply to every future
 * module and should keep working untouched. The **per-module** ones pin facts
 * a specific review established; add to them as modules land, and treat a
 * failure as either a doc that went stale or a feature that was removed —
 * both worth knowing.
 *
 * Run from anywhere:  node scripts/verify-docs.mjs
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const A = read("ARCHITECTURE.md");
const C = read("CHANGELOG.md");
const X = read("CONTEXT.md");
const CL = read("CLAUDE.md");

let fail = 0;
const check = (ok, label) => {
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
};

// --- generic: declared authorization exceptions are a countable claim ----
const spec = read("apps/api/src/mutations/authorization-invariants.spec.ts");
function countBlock(name) {
  const i = spec.indexOf(`const ${name}`);
  if (i < 0) throw new Error(`${name} not found in the spec`);
  const start = spec.indexOf("{", i);
  let depth = 0, end = -1;
  for (let k = start; k < spec.length; k++) {
    if (spec[k] === "{") depth++;
    else if (spec[k] === "}") { depth--; if (depth === 0) { end = k; break; } }
  }
  return (spec.slice(start, end).match(/^\s{2}"[^"]+":/gm) || []).length;
}
const nMut = countBlock("OWNERSHIP_SCOPED_MUTATIONS");
const nSrc = countBlock("OWNERSHIP_SCOPED_DATA_SOURCES");
check(A.includes(`${nMut} mutations and ${nSrc} data sources`), `§15.1 rule 4 states the real counts (${nMut} / ${nSrc})`);

// --- generic: ARCHITECTURE's own section count, claimed in CONTEXT §66 ---
const sections = (A.match(/^## \d+\. /gm) || []).length;
check(X.includes(`Full technical design (${sections} sections)`), `CONTEXT's document map states the real section count (${sections})`);

// --- generic: every module-table row is still a well-formed row ----------
const L = A.split("\n");
const start = L.findIndex((l) => l.startsWith("| Module | Data sources |"));
const badRows = [];
for (let i = start + 2; i < L.length && L[i].startsWith("|"); i++) {
  const structural = (L[i].match(/\|/g) || []).length - (L[i].match(/\\\|/g) || []).length;
  if (structural !== 6) badRows.push(`${i + 1}(${structural} pipes)`);
}
check(badRows.length === 0, `every §9.1 module-table row is well formed${badRows.length ? " — bad: " + badRows.join(", ") : ""}`);

// --- generic: CHANGELOG entries sit at a consistent heading level --------
const odd = (C.match(/^### Session \d+ \(cont/gm) || []).length;
check(odd === 0, "no CHANGELOG entry uses a mismatched '### … (cont.)' heading");

// --- generic: the documentation rule itself is present in both places ----
check(/### 1\.1 Documentation discipline/.test(A), "ARCHITECTURE §1.1 (documentation discipline) exists");
check(/\[1\.1 Documentation discipline\]/.test(A), "the table of contents links to §1.1");
check(/Documentation discipline/.test(CL) && /ARCHITECTURE\.md §1\.1/.test(CL), "CLAUDE.md carries the rule and points at §1.1");

// --- per-module: Documents review, 2026-08-26 ---------------------------
for (const [sym, file, name] of [
  ["documentRequestApprovalMutation", "apps/api/src/modules/documents/documents.mutations.ts", "document.requestApproval"],
  ["assignmentSubmitMutation", "apps/api/src/modules/enrollments/submissions.mutations.ts", "assignment.submit"],
  ["assignmentSubmissionTargetMutation", "apps/api/src/modules/enrollments/submissions.mutations.ts", "assignment.submissionTarget"],
]) {
  check(read(file).includes(`export const ${sym}`), `${name} exists in code`);
  check(spec.includes(`"${name}"`), `${name} is a declared ownership exception`);
  check(A.includes(name), `${name} appears in ARCHITECTURE`);
}

const proj = read("apps/api/src/modules/projects/projects.data-sources.ts");
const tasks = read("apps/api/src/modules/tasks/tasks.data-sources.ts");
const docs = read("apps/api/src/modules/documents/documents.mutations.ts");
check(proj.includes("export function restrictedProjectGate"), "restrictedProjectGate is exported for reuse");
check(proj.includes("export async function assertProjectReachable"), "assertProjectReachable exists");
check(tasks.includes("restrictedProjectGate"), "tasksWhere applies the restricted gate");
check((tasks.match(/return gate\(where\)/g) || []).length === 3, "the gate is applied at all three tasksWhere returns");
check(docs.includes("assertProjectReachable"), "document writes check project reachability");
check(/tasksWhere` now applies the restricted-project gate/.test(A), "the Tasks module row records the gate (not just Documents')");
check(/z\.enum\(\["approved", "rejected"\]\)/.test(docs), "setApprovalStatus no longer accepts 'pending'");
check(/decision above has been reversed/.test(A), "the Education row marks its reversed deferral as reversed");

const mig = read("apps/api/prisma/migrations/20260826170000_student_submissions/migration.sql");
check(/ADD COLUMN "assignment_id"/.test(mig), "the migration adds tasks.assignment_id");
check(/CREATE UNIQUE INDEX/.test(mig) && /WHERE "assignment_id" IS NOT NULL/.test(mig), "it is a partial unique index");
check(A.includes("assignment_id") && A.includes("partial unique index"), "§8.2 records the column and the index");

for (const t of ["assertProjectReachable", "requestApproval", "assignment.submit"]) {
  check(X.includes(t), `CONTEXT mentions ${t}`);
}

console.log(`\n${fail === 0 ? "all checks passed" : `${fail} CHECK(S) FAILED`}`);
process.exit(fail ? 1 : 0);
