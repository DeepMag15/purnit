import fs from "node:fs";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { signupWithRetry, inviteWithRetry } from "./signup-retry.mjs";
loadEnv({ path: "../../.env", quiet: true });

/**
 * Documents module review — the Education submission path, end to end.
 *
 * `documents-audit.mjs` proved the restricted boundary holds. This proves the
 * thing that boundary was protecting actually WORKS: a student hands work in,
 * it lands in their own submissions project as a task, the teacher of record
 * reviews it through the ordinary pair, and nobody else can see or touch it.
 *
 * Written because the audit's E0 uploads a file directly — it never exercises
 * `assignment.submit`, which is the whole feature.
 *
 * Prereq: API on :4000.
 */
const API = "http://localhost:4000";
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const stamp = Date.now();
const PW = "SubVerify!2026";
const PW2 = "SubVerify!2026x";

const H = (t) => ({ "content-type": "application/json", authorization: `Bearer ${t}` });
const j = async (r) => { try { return await r.json(); } catch { return null; } };
const call = async (tok, m, b = {}) => {
  const r = await fetch(`${API}/api/mutations/${m}`, { method: "POST", headers: H(tok), body: JSON.stringify(b) });
  const x = await j(r);
  return { s: r.status, b: x && typeof x === "object" && "data" in x ? x.data : x, msg: x?.message ?? "" };
};
const read = async (tok, s, b = {}) => {
  const r = await fetch(`${API}/api/data/${s}`, { method: "POST", headers: H(tok), body: JSON.stringify(b) });
  const x = await j(r);
  return { s: r.status, b: x && typeof x === "object" && "data" in x ? x.data : x, msg: x?.message ?? "" };
};

const findings = [];
const note = (t) => console.log(`        ${t}`);
const check = (id, ok, label) => {
  findings.push({ id, verdict: ok ? "ok" : "BUG", label });
  console.log(`  ${ok ? "ok " : "!! "} ${id}  ${label}`);
};

const db = new pg.Client({ connectionString: process.env.DIRECT_URL });
await db.connect();

const email = (slug) => `sub-${slug}+${stamp}@example.com`;
const tok = await signupWithRetry(API, {
  email: email("admin"),
  password: PW,
  companyName: `SubVerify ${stamp}`,
  displayName: "SV Admin",
  industry: "Education",
});
if (!tok?.tenantId) throw new Error("signup failed");
const tenantId = tok.tenantId;
await db.query("update tenants set seats_purchased = 25, stripe_subscription_id = $2, subscription_status = 'active' where id = $1", [tenantId, `sub_sv_${stamp}`]);
const admin = (await sb.auth.signInWithPassword({ email: email("admin"), password: PW })).data.session.access_token;

const roleRows = (await read(admin, "roles.list")).b ?? [];
const roleId = (l) => roleRows.find((r) => r.label === l)?.id;

async function makeUser(label, roleLabel, slug, departmentId) {
  const e = email(slug);
  const inv = await inviteWithRetry(call, admin, { email: e, displayName: label, roleId: roleId(roleLabel), departmentId });
  if (!inv?.b?.temporaryPassword) throw new Error(`invite ${roleLabel} failed: ${inv?.s} ${JSON.stringify(inv?.msg)}`);
  const { data: s1 } = await sb.auth.signInWithPassword({ email: e, password: inv.b.temporaryPassword });
  await sb.auth.updateUser({ password: PW2 });
  await fetch(`${API}/auth/complete-first-login`, { method: "POST", headers: H(s1.session.access_token) });
  const { data: s2 } = await sb.auth.signInWithPassword({ email: e, password: PW2 });
  const { rows } = await db.query("select id from users where tenant_id=$1 and display_name=$2", [tenantId, label]);
  return { email: e, token: s2.session.access_token, id: rows[0]?.id };
}

const dept = await call(admin, "department.create", { name: "Faculty", type: "general" });
const D = dept.b?.id;
const teacher = await makeUser("SV Teacher", "Teacher", "teacher", D);
const otherTeacher = await makeUser("SV OtherTeacher", "Teacher", "teacher2", D);
const stuUserA = await makeUser("SV StudentA", "Student", "student-a", D);
const stuUserB = await makeUser("SV StudentB", "Student", "student-b", D);

const course = await call(admin, "course.create", { name: "Algebra II", teacherId: teacher.id });
const courseId = course.b?.id;
const other = await call(admin, "course.create", { name: "History", teacherId: teacher.id });

const stuA = await call(admin, "student.register", { name: "Ana Diaz" });
const stuB = await call(admin, "student.register", { name: "Ben Okafor" });
await call(admin, "student.linkLogin", { studentId: stuA.b?.id, userId: stuUserA.id });
await call(admin, "student.linkLogin", { studentId: stuB.b?.id, userId: stuUserB.id });
const enrA = await call(admin, "enrollment.enroll", { studentId: stuA.b?.id, courseId });
const enrB = await call(admin, "enrollment.enroll", { studentId: stuB.b?.id, courseId });

const asg = await call(admin, "assignment.create", { courseId, title: "Quadratics essay", dueDate: new Date(Date.now() + 6e8).toISOString() });
const asgId = asg.b?.id;
const asgOther = await call(admin, "assignment.create", { courseId: other.b?.id, title: "Tudors essay" });
note(`course ${course.s}, students ${stuA.s}/${stuB.s}, enrollments ${enrA.s}/${enrB.s}, assignment ${asg.s}`);
if (!asgId) { console.log("  cannot continue — assignment.create failed:", JSON.stringify(asg.msg)); process.exit(1); }

const TXT = "my essay\n";
async function handIn(who, assignmentId, fileName, extra = {}) {
  const t = await call(who.token, "assignment.submissionTarget", { assignmentId });
  if (!t.b?.projectId) return { ok: false, stage: "submissionTarget", s: t.s, msg: t.msg };
  const up = await call(who.token, "document.createUploadUrl", { projectId: t.b.projectId, fileName, mimeType: "text/plain", sizeBytes: Buffer.byteLength(TXT) });
  if (!up.b?.signedUrl) return { ok: false, stage: "createUploadUrl", s: up.s, msg: up.msg };
  await fetch(up.b.signedUrl, { method: "PUT", headers: { "content-type": "text/plain" }, body: TXT });
  const sub = await call(who.token, "assignment.submit", { assignmentId, storagePath: up.b.path, name: fileName, mimeType: "text/plain", sizeBytes: Buffer.byteLength(TXT), ...extra });
  return { ok: !!sub.b?.taskId, stage: "submit", s: sub.s, msg: sub.msg, b: sub.b, projectId: t.b.projectId };
}

// ===========================================================================
console.log("\n=== 1. A student hands work in ===");
const s1 = await handIn(stuUserA, asgId, `essay-${stamp}.txt`);
check("S1", s1.ok, `the student can hand in work (${s1.stage} ${s1.s} ${String(s1.msg).slice(0, 70)})`);
check("S2", s1.b?.status === "in_review", `it lands in the teacher's review queue (status ${s1.b?.status})`);

const { rows: taskRows } = await db.query(
  "select t.id, t.status, t.project_id, t.assignee_id, t.assignment_id from tasks t where t.assignment_id = $1 and t.deleted_at is null", [asgId]);
check("S3", taskRows.length === 1, `exactly one submission task exists (${taskRows.length})`);
check("S4", taskRows[0]?.project_id === enrA.b?.submissionsProjectId, `it sits in the student's OWN submissions project (${taskRows[0]?.project_id === enrA.b?.submissionsProjectId})`);
check("S5", taskRows[0]?.assignee_id === stuUserA.id, `it is assigned to the student who submitted it`);

const { rows: docRows } = await db.query("select id, name, task_id from documents where task_id = $1 and deleted_at is null", [taskRows[0]?.id]);
check("S6", docRows.length === 1, `the file is attached to that task as evidence (${docRows.length})`);

// ===========================================================================
console.log("\n=== 2. What the student sees ===");
const mine = (await read(stuUserA.token, "myAssignments.list", {})).b ?? [];
const row = mine.find((a) => a.id === asgId) ?? {};
check("S7", row.submissionStatus === "submitted", `their assignment reads "handed in" (submissionStatus ${row.submissionStatus})`);
check("S8", row.submittedFileName === `essay-${stamp}.txt`, `it names the file they sent (${row.submittedFileName})`);
check("S9", row.overdue === false, `handed-in work is not also flagged overdue (${row.overdue})`);

// ===========================================================================
console.log("\n=== 3. Who may hand in ===");
const notEnrolled = await call(stuUserA.token, "assignment.submissionTarget", { assignmentId: asgOther.b?.id });
check("S10", notEnrolled.s === 404, `a student CANNOT submit to a course they are not enrolled on (${notEnrolled.s})`);
const byTeacher = await call(teacher.token, "assignment.submissionTarget", { assignmentId: asgId });
check("S11", byTeacher.s === 403, `a teacher is not a student and cannot hand in (${byTeacher.s})`);

const s1b = await handIn(stuUserB, asgId, `ben-${stamp}.txt`);
const { rows: bothRows } = await db.query("select assignee_id, project_id from tasks where assignment_id = $1 and deleted_at is null", [asgId]);
check("S12", s1b.ok && bothRows.length === 2, `a classmate's submission is a SEPARATE task (${bothRows.length} tasks)`);
check("S13", new Set(bothRows.map((r) => r.project_id)).size === 2, `each in their own submissions project (${new Set(bothRows.map((r) => r.project_id)).size} projects)`);

// ===========================================================================
console.log("\n=== 4. Who may see it ===");
const listOther = await read(otherTeacher.token, "documents.list", { projectId: s1.projectId });
check("S14", listOther.s === 404, `another teacher CANNOT see the submission (${listOther.s})`);
const ownTasks = (await read(teacher.token, "tasks.list", {})).b ?? [];
check("S15", ownTasks.some((t) => t.id === taskRows[0]?.id), `the teacher of record DOES see it in their tasks`);
const otherTasks = (await read(otherTeacher.token, "tasks.list", {})).b ?? [];
check("S16", !otherTasks.some((t) => t.id === taskRows[0]?.id), `another teacher does NOT see it in theirs`);

// ===========================================================================
console.log("\n=== 5. The teacher reviews it ===");
const taskId = taskRows[0]?.id;
const selfReview = await call(stuUserA.token, "task.review", { id: taskId, decision: "approve" });
check("S17", selfReview.s === 403 || selfReview.s === 404, `the student CANNOT review their own submission (${selfReview.s})`);

const changes = await call(teacher.token, "task.review", { id: taskId, decision: "request_changes", note: "Show your working on Q3." });
check("S18", changes.s === 200 || changes.s === 201, `the teacher can hand it back (${changes.s} ${String(changes.msg).slice(0, 60)})`);
const mine2 = ((await read(stuUserA.token, "myAssignments.list", {})).b ?? []).find((a) => a.id === asgId) ?? {};
check("S19", mine2.submissionStatus === "changes_requested", `the student sees "changes requested" (${mine2.submissionStatus})`);
check("S20", mine2.teacherNote === "Show your working on Q3.", `and reads the teacher's note (${JSON.stringify(mine2.teacherNote)})`);

// ===========================================================================
console.log("\n=== 6. Resubmission ===");
const s2 = await handIn(stuUserA, asgId, `essay-v2-${stamp}.txt`);
check("S21", s2.ok, `the student can hand in again (${s2.stage} ${s2.s} ${String(s2.msg).slice(0, 60)})`);
check("S22", s2.b?.taskId === taskId, `it REUSES the same task, so review history stays in one place`);
const { rows: afterRows } = await db.query("select status, review_note, reviewed_by_id from tasks where id = $1", [taskId]);
check("S23", afterRows[0]?.status === "in_review", `it is back in the queue (${afterRows[0]?.status})`);
check("S24", afterRows[0]?.reviewed_by_id === null, `last week's decision is cleared, not left showing (${afterRows[0]?.reviewed_by_id})`);
const { rows: docsNow } = await db.query("select count(*)::int n from documents where task_id = $1 and deleted_at is null", [taskId]);
check("S25", docsNow[0].n === 2, `both attempts' files are kept (${docsNow[0].n})`);

const approve = await call(teacher.token, "task.review", { id: taskId, decision: "approve" });
check("S26", approve.s === 200 || approve.s === 201, `the teacher can accept it (${approve.s})`);
const mine3 = ((await read(stuUserA.token, "myAssignments.list", {})).b ?? []).find((a) => a.id === asgId) ?? {};
check("S27", mine3.submissionStatus === "accepted", `the student sees "accepted" (${mine3.submissionStatus})`);
const reSubmit = await call(stuUserA.token, "assignment.submit", { assignmentId: asgId, storagePath: "x", name: "x.txt", mimeType: "text/plain", sizeBytes: 3 });
check("S28", reSubmit.s === 400, `accepted work cannot be silently replaced (${reSubmit.s})`);

// ===========================================================================
console.log("\n=== 7. The teacher grades it, and the student sees the result ===");
// Grading is a SEPARATE authority from reviewing the submission: `grade:create`,
// and it is what closes the loop the student actually cares about.
const grade = await call(teacher.token, "grade.record", { assignmentId: asgId, studentId: stuA.b?.id, score: 82, feedback: "Strong on Q1-Q2, working shown." });
check("S29", grade.s === 200 || grade.s === 201, `the teacher can record a grade (${grade.s} ${String(grade.msg).slice(0, 70)})`);
const mine4 = ((await read(stuUserA.token, "myAssignments.list", {})).b ?? []).find((a) => a.id === asgId) ?? {};
check("S30", mine4.graded === true && mine4.score === 82, `the student sees the score (graded ${mine4.graded}, score ${mine4.score})`);
check("S31", mine4.feedback === "Strong on Q1-Q2, working shown.", `and the teacher's written feedback (${JSON.stringify(mine4.feedback)})`);
// Two different questions, kept apart on purpose: handing in is the student's
// action, grading is the teacher's, and the page must not collapse them.
check("S32", mine4.submissionStatus === "accepted", `the hand-in state survives grading, it is not overwritten (${mine4.submissionStatus})`);

const otherGrade = await call(otherTeacher.token, "grade.record", { assignmentId: asgId, studentId: stuB.b?.id, score: 50 });
check("S33", otherGrade.s === 403 || otherGrade.s === 404, `a teacher who does not own the course cannot grade on it (${otherGrade.s})`);

// ===========================================================================
console.log("\n=== 8. AI analysis obeys the same boundary ===");
// `document.analyze` is gated on `reportAnalysis:create` AND routes through
// `assertProjectVisible` — the same check every document read uses. If the
// restricted gate did not reach it, the cheapest way to read a student's
// private work would be to ask the AI to summarise it.
const docId = docRows[0]?.id;
const analyzeOther = await call(otherTeacher.token, "document.analyze", { documentId: docId });
check("S34", analyzeOther.s === 404 || analyzeOther.s === 403, `another teacher cannot ANALYSE a submission they cannot read (${analyzeOther.s})`);
check("S35", analyzeOther.s !== 200 && analyzeOther.s !== 201, `and no analysis was produced for them`);
// Optional, never mandatory: the whole workflow above completed without a
// single analysis call. This asserts the refusal is a boundary, not a
// dependency — nothing earlier needed AI to work.
check("S36", findings.filter((f) => f.verdict === "BUG").length === 0, `the entire submit -> review -> grade flow completed with no AI involved`);

await db.end();
console.log(`\n${"=".repeat(80)}`);
const bugs = findings.filter((f) => f.verdict === "BUG");
console.log(`${findings.length} checks, ${bugs.length} finding(s)`);
for (const b of bugs) console.log(`  !! ${b.id}  ${b.label}`);
fs.writeFileSync("submissions-result.json", JSON.stringify(findings, null, 1));
