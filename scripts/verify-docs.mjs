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

/**
 * ⚠️ CONTEXT.md and CHANGELOG.md are **not tracked in git** — they are
 * internal working documents kept locally (see README). So this script has to
 * run in two situations that look identical to it:
 *
 *   - on a working machine, where both files exist and every check applies;
 *   - in a fresh clone or CI, where they legitimately do not exist.
 *
 * Missing is therefore SKIPPED, never a failure. A stale check that fires on
 * a clean checkout would train you to ignore this script's output, which is
 * the exact failure mode it exists to prevent. Absence is reported plainly so
 * nobody mistakes a skipped run for a passing one.
 */
const readOptional = (p) => {
  try {
    return read(p);
  } catch {
    return null;
  }
};

const A = read("ARCHITECTURE.md");
const CL = read("CLAUDE.md");
const C = readOptional("CHANGELOG.md");
const X = readOptional("CONTEXT.md");

const skipped = [];
const skip = (label) => {
  skipped.push(label);
  console.log(`skip  ${label}`);
};

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
if (X) check(X.includes(`Full technical design (${sections} sections)`), `CONTEXT's document map states the real section count (${sections})`);
else skip("CONTEXT's document-map section count (CONTEXT.md not present — untracked working doc)");

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
if (C) {
  const odd = (C.match(/^### Session \d+ \(cont/gm) || []).length;
  check(odd === 0, "no CHANGELOG entry uses a mismatched '### … (cont.)' heading");
} else skip("CHANGELOG heading levels (CHANGELOG.md not present — untracked working doc)");

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

if (X) {
  for (const t of ["assertProjectReachable", "requestApproval", "assignment.submit"]) {
    check(X.includes(t), `CONTEXT mentions ${t}`);
  }
} else skip("CONTEXT's record of the Documents module (CONTEXT.md not present — untracked working doc)");

// --- per-module: Comments & Collaboration review, 2026-08-26 ------------
const comments = read("apps/api/src/modules/comments/comments.mutations.ts");
const reach = read("apps/api/src/modules/collaboration/collaboration-reach.ts");
const chat = read("apps/api/src/modules/chat/chat.mutations.ts");
const thread = read("apps/web/src/modules/comments/CommentThread.tsx");

check(comments.includes("assertProjectVisible"), "Comments uses the SHARED visibility gate, not its own copy");
check(!/Not allowed to comment on this/.test(comments), "Comments no longer answers 403 for a hidden target (the existence leak)");
check(comments.includes("isProjectOwnerOrMember"), "the comment ownership floor exists");
check(comments.includes('type: "comment.created"'), "a comment notifies the work's owner, not only @mentions");
check(read("apps/api/src/modules/tasks/tasks.data-sources.ts").includes("assertProjectVisible"), "task.detail carries the same ownership floor");

check(reach.includes("export async function canReachUser"), "the collaboration boundary exists");
check(chat.includes("canReachUser"), "conversation.createDm enforces it");
check(spec.includes('"people.directory"') && spec.includes('"comments.mentionCandidates"'), "both new ungated sources are declared exceptions");

check(!/mentionCandidates: MentionCandidate\[\]/.test(thread), "mentionCandidates is no longer a caller-supplied prop");
check(thread.includes('"comments.mentionCandidates"'), "CommentThread sources its own mention list");
check(read("apps/web/src/modules/patients/PatientsWorkspace.tsx").includes("CommentThread"), "Healthcare has a comment surface");
check(!read("apps/web/src/modules/chat/ChatWorkspace.tsx").includes('"users.list"'), "Chat no longer calls the user:manage-gated users.list");

console.log(
  `\n${fail === 0 ? "all checks passed" : `${fail} CHECK(S) FAILED`}` +
    (skipped.length ? `  (${skipped.length} skipped — see above)` : ""),
);
process.exit(fail ? 1 : 0);
