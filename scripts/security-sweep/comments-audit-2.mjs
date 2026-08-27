import fs from "node:fs";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { signupWithRetry, inviteWithRetry } from "./signup-retry.mjs";
loadEnv({ path: "../../.env", quiet: true });

/**
 * Comments review, pass 2 — re-testing what pass 1 could not actually decide.
 *
 * ⚠️ Three results in `comments-audit.mjs` were not what they looked like, and
 * this exists to settle them rather than report them as they stood:
 *
 *   - **C11 "passed vacuously."** "The student cannot @mention a non-member"
 *     was recorded as ok — but the comment itself was refused 403 before any
 *     mention was resolved, so the check proved nothing. Re-run as the
 *     teacher, who can actually post.
 *   - **C13 passed for the wrong reason.** `conversation.createDm` takes
 *     `otherUserId`; the probe sent `userId`, so the 400 was schema
 *     validation, not an authorization refusal. Re-run with the real shape.
 *   - **C10 was a consequence of C8, not its own finding.** The student could
 *     not comment at all, so of course no mention landed.
 *
 * It also answers the questions pass 1 raised: exactly which surfaces a
 * Student can reach, who gets notified when nobody is @mentioned, and how far
 * @mention reach extends on an ordinary project.
 *
 * Prereq: API on :4000.
 */
const API = "http://localhost:4000";
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const stamp = Date.now();
const PW = "ComB!2026aa";
const PW2 = "ComB!2026bb";

const H = (t) => ({ "content-type": "application/json", authorization: `Bearer ${t}` });
const j = async (r) => { try { return await r.json(); } catch { return null; } };
const call = async (tok, m, b = {}) => {
  const r = await fetch(`${API}/api/mutations/${m}`, { method: "POST", headers: H(tok), body: JSON.stringify(b) });
  const x = await j(r);
  return { s: r.status, b: x && typeof x === "object" && "data" in x ? x.data : x, msg: typeof x?.message === "string" ? x.message : JSON.stringify(x?.message ?? "") };
};
const read = async (tok, s, b = {}) => {
  const r = await fetch(`${API}/api/data/${s}`, { method: "POST", headers: H(tok), body: JSON.stringify(b) });
  const x = await j(r);
  return { s: r.status, b: x && typeof x === "object" && "data" in x ? x.data : x, msg: typeof x?.message === "string" ? x.message : "" };
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
  const email = `cb-${industry.toLowerCase()}-${seq++}+${stamp}@example.com`;
  const t = await signupWithRetry(API, { email, password: PW, companyName: `${name} ${stamp}`, displayName: "CB Admin", industry });
  if (!t?.tenantId) throw new Error(`${industry} signup failed`);
  await db.query("update tenants set seats_purchased = 25, stripe_subscription_id = $2, subscription_status = 'active' where id = $1", [t.tenantId, `sub_cb_${stamp}_${seq}`]);
  const { data } = await sb.auth.signInWithPassword({ email, password: PW });
  const roleRows = (await read(data.session.access_token, "roles.list")).b ?? [];
  return { tenantId: t.tenantId, admin: data.session.access_token, roleId: (l) => roleRows.find((r) => r.label === l)?.id };
}
async function makeUser(ctx, label, roleLabel, slug, departmentId) {
  const email = `cb-${slug}+${stamp}@example.com`;
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
console.log("\n=== Education — what a Student can actually reach ===");
const ctx = await makeTenant("Education", "ComB Edu");
const dept = await call(ctx.admin, "department.create", { name: "Faculty", type: "general" });
const D = dept.b?.id;
const teacher = await makeUser(ctx, "CB Teacher", "Teacher", "teacher", D);
const otherTeacher = await makeUser(ctx, "CB TeacherB", "Teacher", "teacher-b", D);
const studentUser = await makeUser(ctx, "CB Student", "Student", "student", D);
const classmate = await makeUser(ctx, "CB Student2", "Student", "student-2", D);

const course = await call(ctx.admin, "course.create", { name: "Algebra II", teacherId: teacher.id });
const student = await call(ctx.admin, "student.register", { name: "Ana Diaz" });
await call(ctx.admin, "student.linkLogin", { studentId: student.b?.id, userId: studentUser.id });
const enrol = await call(ctx.admin, "enrollment.enroll", { studentId: student.b?.id, courseId: course.b?.id });
const subProject = enrol.b?.submissionsProjectId;
const asg = await call(ctx.admin, "assignment.create", { courseId: course.b?.id, title: "Quadratics essay", maxScore: 100 });

const TXT = "my essay\n";
const tgt = await call(studentUser.token, "assignment.submissionTarget", { assignmentId: asg.b?.id });
const up = await call(studentUser.token, "document.createUploadUrl", { projectId: tgt.b?.projectId, fileName: `essay-${stamp}.txt`, mimeType: "text/plain", sizeBytes: Buffer.byteLength(TXT) });
await fetch(up.b.signedUrl, { method: "PUT", headers: { "content-type": "text/plain" }, body: TXT });
const sub = await call(studentUser.token, "assignment.submit", { assignmentId: asg.b?.id, storagePath: up.b.path, name: `essay-${stamp}.txt`, mimeType: "text/plain", sizeBytes: Buffer.byteLength(TXT) });
const taskId = sub.b?.taskId;
const { rows: docRows } = await db.query("select id from documents where task_id=$1 and deleted_at is null", [taskId]);
const docId = docRows[0]?.id;

// --- which of the three comment surfaces is the student allowed on? -------
// They hold `project:read:own` and NO task:read at all, so this is expected
// to be inconsistent — the point is to record exactly how.
const sProj = await call(studentUser.token, "comment.create", { entityType: "project", entityId: subProject, body: "note on my folder" });
finding("S1", sProj.s === 200 || sProj.s === 201 ? "ok" : "BUG", `student CAN comment on their own submissions PROJECT (${sProj.s} ${sProj.msg.slice(0, 40)})`);
const sTask = await call(studentUser.token, "comment.create", { entityType: "task", entityId: taskId, body: "reply to my teacher" });
finding("S2", sTask.s === 200 || sTask.s === 201 ? "ok" : "BUG", `student CAN comment on their own submission TASK (${sTask.s} ${sTask.msg.slice(0, 46)})`);
const sDoc = await call(studentUser.token, "comment.create", { entityType: "document", entityId: docId, body: "note on my file" });
finding("S3", sDoc.s === 200 || sDoc.s === 201 ? "ok" : "BUG", `student CAN comment on their own evidence DOCUMENT (${sDoc.s} ${sDoc.msg.slice(0, 40)})`);
const sTaskRead = await read(studentUser.token, "comments.list", { entityType: "task", entityId: taskId });
finding("S4", sTaskRead.s === 200 ? "ok" : "BUG", `student CAN READ the review conversation on their own work (${sTaskRead.s} ${sTaskRead.msg.slice(0, 40)})`);

// --- C11 re-run: the mention boundary, tested by someone who CAN post ----
const tMention = await call(teacher.token, "comment.create", { entityType: "task", entityId: taskId, body: "@outsider", mentionedUserIds: [otherTeacher.id] });
const accepted = tMention.b?.mentionedUserIds ?? [];
finding("M1", tMention.s < 400 && !accepted.includes(otherTeacher.id) ? "ok" : "BUG", `a non-member @mention is dropped, tested by someone who can post (posted ${tMention.s}, accepted ${JSON.stringify(accepted)})`);
const tMention2 = await call(teacher.token, "comment.create", { entityType: "task", entityId: taskId, body: "@student", mentionedUserIds: [studentUser.id] });
finding("M2", (tMention2.b?.mentionedUserIds ?? []).includes(studentUser.id) ? "ok" : "BUG", `a real member @mention IS accepted (accepted ${JSON.stringify(tMention2.b?.mentionedUserIds ?? [])})`);
const { rows: mentionNotif } = await db.query("select type from notifications where tenant_id=$1 and user_id=$2 and type='comment.mention'", [ctx.tenantId, studentUser.id]);
finding("M3", mentionNotif.length > 0 ? "ok" : "BUG", `an @mention produces a notification (${mentionNotif.length})`);

// --- the notification gap: a comment with NO mention ---------------------
await db.query("delete from notifications where tenant_id=$1 and user_id=$2", [ctx.tenantId, studentUser.id]);
await call(teacher.token, "comment.create", { entityType: "task", entityId: taskId, body: "Please show your working on Q3." });
const { rows: plainNotif } = await db.query("select type from notifications where tenant_id=$1 and user_id=$2", [ctx.tenantId, studentUser.id]);
finding("N1", plainNotif.length > 0 ? "ok" : "BUG", `the assignee is notified of a comment on their work WITHOUT being @mentioned (${plainNotif.length ? plainNotif.map((r) => r.type).join(", ") : "no notification"})`);

// --- C13 re-run: DM reach, with the schema the mutation actually takes ---
const dmTeacher = await call(studentUser.token, "conversation.createDm", { otherUserId: otherTeacher.id });
finding("P1", dmTeacher.s >= 400 ? "ok" : "BUG", `a Student CANNOT DM a teacher who does not teach them (${dmTeacher.s} ${dmTeacher.msg.slice(0, 46)})`);
const dmClassmate = await call(studentUser.token, "conversation.createDm", { otherUserId: classmate.id });
finding("P2", dmClassmate.s >= 400 ? "ok" : "BUG", `a Student CANNOT DM another Student (${dmClassmate.s} ${dmClassmate.msg.slice(0, 46)})`);
/**
 * ⚠️ This assertion was wrong when first written, and the correction is the
 * interesting part.
 *
 * It asserted a Student cannot DM the School Administrator, and the system
 * allowed it (201). Chasing the mechanism rather than "fixing" it: the admin
 * is reachable because `student.register` sets `ownerId: ctx.userId` on the
 * student's own file project, so the staff member who **holds this student's
 * record** is connected to them. That is the school office, and "connected to
 * their enrolment" is exactly the rule's own wording — a student being able to
 * message the office that enrolled them is the intended behaviour, not a leak.
 *
 * What actually needs proving is the negative below: that this is a real
 * relationship and not "any administrator".
 */
const adminId = (await db.query("select id from users where tenant_id=$1 and display_name='CB Admin'", [ctx.tenantId])).rows[0]?.id;
const dmAdmin = await call(studentUser.token, "conversation.createDm", { otherUserId: adminId });
finding("P3", dmAdmin.s < 400 ? "ok" : "BUG", `a Student CAN reach the staff member who holds their record (${dmAdmin.s} ${dmAdmin.msg.slice(0, 40)})`);

// The negative: staff with no connection to this learner at all. Registrar
// registered nobody here and teaches nothing.
const stranger = await makeUser(ctx, "CB Registrar", "Registrar", "registrar", D);
if (stranger) {
  const dmStranger = await call(studentUser.token, "conversation.createDm", { otherUserId: stranger.id });
  finding("P4", dmStranger.s >= 400 ? "ok" : "BUG", `a Student CANNOT DM unconnected staff, so the rule is a real relationship and not "any admin" (${dmStranger.s} ${dmStranger.msg.slice(0, 40)})`);
  const dmBack = await call(stranger.token, "conversation.createDm", { otherUserId: studentUser.id });
  finding("P5", dmBack.s >= 400 ? "ok" : "BUG", `and that unconnected staff member CANNOT open one to the student either — the rule is symmetric (${dmBack.s} ${dmBack.msg.slice(0, 40)})`);
}

// --- people discovery: what each role can enumerate ----------------------
for (const [who, tok] of [["Student", studentUser.token], ["Teacher", teacher.token]]) {
  const u = await read(tok, "users.list", {});
  finding(`U-${who}`, u.s >= 400 ? "ok" : "BUG", `${who} is refused users.list (${u.s}${Array.isArray(u.b) ? ` — ${u.b.length} users returned` : ""})`);
}

await db.end();
console.log(`\n${"=".repeat(80)}`);
const bugs = findings.filter((f) => f.verdict === "BUG");
console.log(`${findings.length} checks, ${bugs.length} finding(s)`);
for (const b of bugs) console.log(`  !! ${b.id}  ${b.label}`);
fs.writeFileSync("comments-audit-2-result.json", JSON.stringify(findings, null, 1));
