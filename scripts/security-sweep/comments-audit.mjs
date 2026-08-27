import fs from "node:fs";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { signupWithRetry, inviteWithRetry } from "./signup-retry.mjs";
loadEnv({ path: "../../.env", quiet: true });

/**
 * Comments & Collaboration module review — the findings probe.
 *
 * Reads nothing on trust. Every claim in the findings report is produced by
 * this script against a running system, because the last three modules each
 * turned up something that code reading got wrong in one direction or the
 * other — including, last time, a CI diagnosis I was confident about and
 * which the actual run disproved.
 *
 * The central questions:
 *   1. Comments re-implements the project/document visibility check inline
 *      "to avoid a circular import". The Documents review changed the real
 *      one to answer 404 for both missing and hidden. Did this copy drift?
 *   2. Does the restricted-project boundary reach comments at all — can an
 *      outsider read or post on a patient chart / a student's submission?
 *   3. @mentions: the backend allows any project member; what does each
 *      surface actually offer, and is anyone reachable who should not be?
 *   4. Notifications: does a comment notify anyone who was not @mentioned?
 *   5. People discovery: who can enumerate or DM whom.
 *
 * Prereq: API on :4000.
 */
const API = "http://localhost:4000";
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const stamp = Date.now();
const PW = "ComAudit!2026";
const PW2 = "ComAudit!2026x";

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
const finding = (id, verdict, label) => {
  findings.push({ id, verdict, label });
  console.log(`  ${verdict === "BUG" ? "!! " : "ok "} ${id}  ${label}`);
};

const db = new pg.Client({ connectionString: process.env.DIRECT_URL });
await db.connect();

let seq = 0;
async function makeTenant(industry, name) {
  const email = `com-${industry.toLowerCase()}-${seq++}+${stamp}@example.com`;
  const t = await signupWithRetry(API, { email, password: PW, companyName: `${name} ${stamp}`, displayName: "CA Admin", industry });
  if (!t?.tenantId) throw new Error(`${industry} signup failed`);
  await db.query("update tenants set seats_purchased = 25, stripe_subscription_id = $2, subscription_status = 'active' where id = $1", [t.tenantId, `sub_com_${stamp}_${seq}`]);
  const { data } = await sb.auth.signInWithPassword({ email, password: PW });
  const roleRows = (await read(data.session.access_token, "roles.list")).b ?? [];
  return {
    tenantId: t.tenantId,
    admin: data.session.access_token,
    roleId: (l) => roleRows.find((r) => r.label === l)?.id,
  };
}

async function makeUser(ctx, label, roleLabel, slug, departmentId) {
  if (!ctx.roleId(roleLabel)) return null;
  const email = `com-${slug}+${stamp}@example.com`;
  const inv = await inviteWithRetry(call, ctx.admin, { email, displayName: label, roleId: ctx.roleId(roleLabel), departmentId });
  if (!inv?.b?.temporaryPassword) { note(`invite ${roleLabel} failed: ${inv?.s}`); return null; }
  const { data: s1 } = await sb.auth.signInWithPassword({ email, password: inv.b.temporaryPassword });
  await sb.auth.updateUser({ password: PW2 });
  await fetch(`${API}/auth/complete-first-login`, { method: "POST", headers: H(s1.session.access_token) });
  const { data: s2 } = await sb.auth.signInWithPassword({ email, password: PW2 });
  const { rows } = await db.query("select id from users where tenant_id=$1 and display_name=$2", [ctx.tenantId, label]);
  return { email, token: s2.session.access_token, id: rows[0]?.id, role: roleLabel };
}

// ===========================================================================
console.log("\n=== 1. Education — comments on a student's restricted submission ===");
{
  const ctx = await makeTenant("Education", "ComAudit Edu");
  const dept = await call(ctx.admin, "department.create", { name: "Faculty", type: "general" });
  const D = dept.b?.id;
  const teacher = await makeUser(ctx, "CA Teacher", "Teacher", "teacher", D);
  const otherTeacher = await makeUser(ctx, "CA TeacherB", "Teacher", "teacher-b", D);
  const studentUser = await makeUser(ctx, "CA Student", "Student", "student", D);

  const course = await call(ctx.admin, "course.create", { name: "Algebra II", teacherId: teacher.id });
  const student = await call(ctx.admin, "student.register", { name: "Ana Diaz" });
  await call(ctx.admin, "student.linkLogin", { studentId: student.b?.id, userId: studentUser.id });
  const enrol = await call(ctx.admin, "enrollment.enroll", { studentId: student.b?.id, courseId: course.b?.id });
  const subProject = enrol.b?.submissionsProjectId;
  const asg = await call(ctx.admin, "assignment.create", { courseId: course.b?.id, title: "Quadratics essay", maxScore: 100 });

  // The student hands work in — a task + a document inside the restricted project.
  const TXT = "my essay\n";
  const tgt = await call(studentUser.token, "assignment.submissionTarget", { assignmentId: asg.b?.id });
  const up = await call(studentUser.token, "document.createUploadUrl", { projectId: tgt.b?.projectId, fileName: `essay-${stamp}.txt`, mimeType: "text/plain", sizeBytes: Buffer.byteLength(TXT) });
  await fetch(up.b.signedUrl, { method: "PUT", headers: { "content-type": "text/plain" }, body: TXT });
  const sub = await call(studentUser.token, "assignment.submit", { assignmentId: asg.b?.id, storagePath: up.b.path, name: `essay-${stamp}.txt`, mimeType: "text/plain", sizeBytes: Buffer.byteLength(TXT) });
  const taskId = sub.b?.taskId;
  const { rows: docRows } = await db.query("select id from documents where task_id=$1 and deleted_at is null", [taskId]);
  const docId = docRows[0]?.id;
  note(`submission task ${taskId ? "ok" : "MISSING"}, evidence doc ${docId ? "ok" : "MISSING"}`);

  // --- the outsider: another teacher, refused everything by the Documents review
  const cList = await read(otherTeacher.token, "comments.list", { entityType: "project", entityId: subProject });
  finding("C1", cList.s === 404 ? "ok" : "BUG", `another teacher CANNOT read comments on the submissions project (${cList.s} ${String(cList.msg).slice(0, 46)})`);
  const cPost = await call(otherTeacher.token, "comment.create", { entityType: "project", entityId: subProject, body: "prying" });
  finding("C2", cPost.s === 404 ? "ok" : "BUG", `and CANNOT post one (${cPost.s} ${String(cPost.msg).slice(0, 46)})`);
  const cTask = await read(otherTeacher.token, "comments.list", { entityType: "task", entityId: taskId });
  finding("C3", cTask.s === 404 ? "ok" : "BUG", `nor read the submission TASK's comments (${cTask.s})`);
  const cDoc = await read(otherTeacher.token, "comments.list", { entityType: "document", entityId: docId });
  finding("C4", cDoc.s === 404 ? "ok" : "BUG", `nor the evidence DOCUMENT's (${cDoc.s})`);

  // --- 404-vs-403 parity: does a hidden thing look like a missing one?
  const ghostP = await read(otherTeacher.token, "comments.list", { entityType: "project", entityId: "00000000-0000-0000-0000-000000000000" });
  finding("C5", ghostP.s === cList.s ? "ok" : "BUG", `a hidden project and a missing one answer alike (missing ${ghostP.s}, hidden ${cList.s})`);
  const ghostT = await read(otherTeacher.token, "comments.list", { entityType: "task", entityId: "00000000-0000-0000-0000-000000000000" });
  finding("C6", ghostT.s === cTask.s ? "ok" : "BUG", `same for a task (missing ${ghostT.s}, hidden ${cTask.s})`);

  // --- the people who SHOULD collaborate here
  const tPost = await call(teacher.token, "comment.create", { entityType: "task", entityId: taskId, body: "Show your working on Q3." });
  finding("C7", tPost.s === 200 || tPost.s === 201 ? "ok" : "BUG", `the teacher of record CAN comment on the submission (${tPost.s} ${String(tPost.msg).slice(0, 40)})`);
  const sPost = await call(studentUser.token, "comment.create", { entityType: "task", entityId: taskId, body: "Fixed, please re-check." });
  finding("C8", sPost.s === 200 || sPost.s === 201 ? "ok" : "BUG", `the student CAN reply on their own submission (${sPost.s} ${String(sPost.msg).slice(0, 40)})`);

  // --- did the student learn the teacher commented? (no @mention used)
  const { rows: nRows } = await db.query("select type from notifications where tenant_id=$1 and user_id=$2", [ctx.tenantId, studentUser.id]);
  const kinds = nRows.map((r) => r.type);
  finding("C9", kinds.some((k) => k.startsWith("comment")) ? "ok" : "BUG", `the student is NOTIFIED that their teacher commented (notifications: ${kinds.join(", ") || "none"})`);

  // --- @mention reach: who can the student actually mention?
  const mention = await call(studentUser.token, "comment.create", { entityType: "task", entityId: taskId, body: "@teacher please look", mentionedUserIds: [teacher.id] });
  finding("C10", (mention.b?.mentionedUserIds ?? []).includes(teacher.id) ? "ok" : "BUG", `the student CAN @mention their teacher (accepted: ${JSON.stringify(mention.b?.mentionedUserIds ?? [])})`);
  const badMention = await call(studentUser.token, "comment.create", { entityType: "task", entityId: taskId, body: "@stranger", mentionedUserIds: [otherTeacher.id] });
  finding("C11", !(badMention.b?.mentionedUserIds ?? []).includes(otherTeacher.id) ? "ok" : "BUG", `and CANNOT @mention a non-member (accepted: ${JSON.stringify(badMention.b?.mentionedUserIds ?? [])})`);

  // --- can a student enumerate the org, or DM anyone?
  const uList = await read(studentUser.token, "users.list", {});
  finding("C12", uList.s >= 400 ? "ok" : "BUG", `a Student CANNOT enumerate every user in the school (${uList.s}${Array.isArray(uList.b) ? `, ${uList.b.length} users returned` : ""})`);
  const dm = await call(studentUser.token, "conversation.createDm", { userId: otherTeacher.id });
  finding("C13", dm.s >= 400 ? "ok" : "BUG", `a Student CANNOT open a DM with a teacher who does not teach them (${dm.s} ${String(dm.msg).slice(0, 40)})`);

  // --- moderation: can anyone but the author remove a comment?
  // ⚠️ DEFERRED, not fixed. `comment.delete` is author-only, so nobody can
  // remove an inappropriate or mistaken comment they did not write. Reported
  // in the Comments findings and deliberately left out of this module's scope
  // — moderation is a policy decision, not a defect. Pinned here so the
  // behaviour is a recorded choice rather than an oversight, and so the probe
  // goes red if it ever changes silently.
  const del = await call(ctx.admin, "comment.delete", { id: tPost.b?.id });
  finding("C14", del.s === 403 ? "ok" : "BUG", `comment moderation remains author-only — DEFERRED by decision (${del.s} ${String(del.msg).slice(0, 46)})`);
}

// ===========================================================================
console.log("\n=== 2. Healthcare — comments on a patient chart ===");
{
  const ctx = await makeTenant("Healthcare", "ComAudit HC");
  const dept = await call(ctx.admin, "department.create", { name: "Ward", type: "general" });
  const D = dept.b?.id;
  const doctor = await makeUser(ctx, "CA Doctor", "Doctor", "doctor", D);
  const reception = await makeUser(ctx, "CA Reception", "Receptionist", "reception", D);

  const patient = await call(ctx.admin, "patient.register", { name: "R. Patel" });
  const chart = patient.b?.chartProjectId;
  await call(ctx.admin, "project.addMember", { projectId: chart, userId: doctor.id });

  const docPost = await call(doctor.token, "comment.create", { entityType: "project", entityId: chart, body: "Post-op review booked." });
  finding("H1", docPost.s === 200 || docPost.s === 201 ? "ok" : "BUG", `the assigned Doctor CAN comment on the chart (${docPost.s} ${String(docPost.msg).slice(0, 40)})`);
  const recRead = await read(reception.token, "comments.list", { entityType: "project", entityId: chart });
  finding("H2", recRead.s === 404 ? "ok" : "BUG", `a Receptionist CANNOT read chart comments (${recRead.s} ${String(recRead.msg).slice(0, 46)})`);
  const recPost = await call(reception.token, "comment.create", { entityType: "project", entityId: chart, body: "prying" });
  finding("H3", recPost.s === 404 ? "ok" : "BUG", `nor post one (${recPost.s} ${String(recPost.msg).slice(0, 46)})`);

  const ghost = await read(reception.token, "comments.list", { entityType: "project", entityId: "00000000-0000-0000-0000-000000000000" });
  finding("H4", ghost.s === recRead.s ? "ok" : "BUG", `a hidden chart and a missing one answer alike (missing ${ghost.s}, hidden ${recRead.s})`);
}

// ===========================================================================
console.log("\n=== 3. Cross-domain — is there a comment surface at all? ===");
{
  const rows = [];
  for (const [industry, mk] of [
    ["IT", async (c) => (await call(c.admin, "project.create", { name: "Billing rewrite", status: "active" })).b?.id],
    ["Finance", async (c) => (await call(c.admin, "client.create", { name: "Northwind Ltd" })).b?.filesProjectId],
    ["Manufacturing", async (c) => (await call(c.admin, "inventoryItem.create", { sku: `SKU-${stamp}`, name: "M6 Bolt", type: "raw_material", unitOfMeasure: "each", reorderPoint: 10 })).b?.filesProjectId],
  ]) {
    const ctx = await makeTenant(industry, `ComAudit ${industry}`);
    const pid = await mk(ctx);
    const post = await call(ctx.admin, "comment.create", { entityType: "project", entityId: pid, body: "kickoff note" });
    const list = await read(ctx.admin, "comments.list", { entityType: "project", entityId: pid });
    rows.push([industry, post.s, Array.isArray(list.b) ? list.b.length : `err ${list.s}`]);
  }
  for (const [d, s, n] of rows) finding(`D-${d}`, s === 200 || s === 201 ? "ok" : "BUG", `${d}: the backing project accepts comments (${s}, ${n} visible)`);
}

await db.end();
console.log(`\n${"=".repeat(80)}`);
const bugs = findings.filter((f) => f.verdict === "BUG");
console.log(`${findings.length} checks, ${bugs.length} finding(s)`);
for (const b of bugs) console.log(`  !! ${b.id}  ${b.label}`);
fs.writeFileSync("comments-audit-result.json", JSON.stringify(findings, null, 1));
