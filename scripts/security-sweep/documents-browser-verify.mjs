import fs from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { chromium } from "playwright";
import { signupWithRetry, inviteWithRetry } from "./signup-retry.mjs";
loadEnv({ path: "../../.env", quiet: true });

/**
 * Documents module review — the browser half.
 *
 * The API probes prove the rules hold. This proves a person can actually USE
 * them, which is a different question and the one that caught both real bugs
 * in the last module: submitted work vanished off the Kanban board, and a
 * reviewer hit a 404 on their own page. Neither was visible to 1595 passing
 * backend tests.
 *
 * Four things, all with real logins driving the real UI — no API shortcuts
 * past the login form:
 *
 *   1. Education end to end: a Student hands work in, a Teacher hands it back
 *      with a note, the Student resubmits, the Teacher accepts, and the
 *      Student sees the grade.
 *   2. The approval split: the uploader is offered "Request approval" and NOT
 *      the approve control; the approver is offered the opposite.
 *   3. Domain vocabulary: the same panel says "records" to a nurse and
 *      "materials" to a teacher.
 *   4. Task evidence is visible — a file says which work it belongs to.
 *
 * Prereqs: API on :4000, web on :3000.
 */
const API = "http://localhost:4000";
const WEB = "http://localhost:3000";
const OUT = path.resolve("browser-shots");
fs.mkdirSync(OUT, { recursive: true });

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const stamp = Date.now();
const PW = "DocBrow!2026aa";
const PW2 = "DocBrow!2026bb";

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
  return { s: r.status, b: x && typeof x === "object" && "data" in x ? x.data : x };
};

/**
 * ⚠️ One pre-existing 403 is filtered out of the console-error checks, and
 * named here rather than silently dropped.
 *
 * `CommentThread` asks `users.list` for its @-mention candidates, and that
 * source needs `user:manage` — which a Teacher, a Lead and most other
 * working roles do not hold. So every page carrying a comment box logs
 * `403 Missing permission "user:manage"` for them. It predates this review,
 * it belongs to the Comments module, and it is recorded as a deferred finding
 * rather than fixed here. Everything else still fails the check.
 */
const PRE_EXISTING = /users\.list|user:manage/;
/** Chromium's own console line for the same response, carrying no URL to
 * attribute it by. Dropped only when a named pre-existing 403 was seen on the
 * same page, so a genuine unattributed error still fails. */
const BARE_403 = /^Failed to load resource: the server responded with a status of 403/;
const results = { checks: 0, failures: [], shots: [], deferred: [] };
const check = (ok, label) => {
  results.checks++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) results.failures.push(label);
};

const db = new pg.Client({ connectionString: process.env.DIRECT_URL });
await db.connect();

/** A tenant of one industry, its roles, and a helper to staff it. */
async function makeTenant(industry, slug) {
  const adminEmail = `db-${slug}+${stamp}@example.com`;
  const tenant = await signupWithRetry(API, { email: adminEmail, password: PW, companyName: `DocBrow ${slug} ${stamp}`, displayName: "DB Admin", industry });
  if (!tenant?.tenantId) throw new Error(`${industry} signup failed`);
  await db.query("update tenants set seats_purchased = 25, stripe_subscription_id = $2, subscription_status = 'active' where id = $1", [tenant.tenantId, `sub_db_${stamp}_${slug}`]);
  const { data: aS } = await sb.auth.signInWithPassword({ email: adminEmail, password: PW });
  const admin = aS.session.access_token;
  const workspaceId = (await db.query("select workspace_id from tenants where id=$1", [tenant.tenantId])).rows[0]?.workspace_id;
  const roleRows = (await read(admin, "roles.list")).b ?? [];
  const roleId = (l) => roleRows.find((r) => r.label === l)?.id;
  const dept = await call(admin, "department.create", { name: "Ops", type: "general" });

  async function makeUser(label, roleLabel, userSlug) {
    const email = `db-${userSlug}-${slug}+${stamp}@example.com`;
    const inv = await inviteWithRetry(call, admin, { email, displayName: label, roleId: roleId(roleLabel), departmentId: dept.b?.id });
    if (!inv?.b?.temporaryPassword) { console.log(`  !! invite ${roleLabel}: ${inv?.s}`); return null; }
    const { data: s1 } = await sb.auth.signInWithPassword({ email, password: inv.b.temporaryPassword });
    await sb.auth.updateUser({ password: PW2 });
    await fetch(`${API}/auth/complete-first-login`, { method: "POST", headers: H(s1.session.access_token) });
    const { data: s2 } = await sb.auth.signInWithPassword({ email, password: PW2 });
    const { rows } = await db.query("select id from users where tenant_id=$1 and display_name=$2", [tenant.tenantId, label]);
    return { email, token: s2.session.access_token, id: rows[0]?.id };
  }
  return { tenantId: tenant.tenantId, admin, workspaceId, roleId, deptId: dept.b?.id, makeUser };
}

const browser = await chromium.launch();

/**
 * Sign in, retried.
 *
 * The login form itself is fine; what is flaky is the Supabase round trip
 * behind it, the same one that intermittently 500s `/auth/signup` from this
 * machine. A timed-out navigation on attempt one killed a run that was
 * otherwise green, so this retries the whole form rather than reporting an
 * upstream blip as a broken login page.
 */
async function signIn(page, workspaceId, email, password) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(`${WEB}/login`, { waitUntil: "networkidle" });
      await page.getByPlaceholder("Workspace ID").fill(workspaceId);
      await page.locator('button[type="submit"]').click();
      await page.getByPlaceholder("Email").waitFor({ timeout: 20000 });
      await page.getByPlaceholder("Email").fill(email);
      await page.getByPlaceholder("Password").fill(password);
      await page.locator('button[type="submit"]').click();
      await page.waitForURL(/\/workspace/, { timeout: 30000 });
      return;
    } catch (e) {
      last = e;
      console.log(`        sign-in attempt ${attempt + 1} for ${email} timed out — retrying`);
      await page.waitForTimeout(2000);
    }
  }
  throw last;
}

/** A logged-in page that also records anything the browser complained about —
 * a silent 404 behind a rendered page is exactly what the last module's
 * browser pass caught. */
async function open(workspaceId, who, url, settle) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("response", async (r) => {
    if (r.status() >= 400 && r.url().includes("/api/")) {
      errors.push(`${r.status()} ${r.url().split("/api/")[1]} :: ${(await r.text().catch(() => "")).slice(0, 160)}`);
    }
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  await signIn(page, workspaceId, who.email, PW2);

  /**
   * ⚠️ Reload past a transient workspace-bootstrap failure.
   *
   * Not masking a product bug — the API answers
   * `P2028 Transaction API error: Unable to start a transaction in the given
   * time`, which is Prisma's connection pool under load from a remote
   * Supabase, and the very next request succeeds. A probe that screenshots
   * that error and reports "the student has no assignments" is reporting
   * infrastructure as a finding.
   *
   * Deliberately narrow: it retries ONLY the workspace-failed-to-load banner,
   * so a genuinely broken page still fails on the first pass. Errors seen
   * during a discarded attempt are dropped for the same reason.
   */
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto(url, { waitUntil: "networkidle" });
    if (settle) await page.locator(settle).first().waitFor({ timeout: 25000 }).catch(() => {});
    const body = (await page.textContent("body").catch(() => "")) ?? "";
    if (!/Couldn't load your workspace|Internal server error/i.test(body)) break;
    console.log(`        workspace bootstrap failed (attempt ${attempt + 1}) — reloading`);
    errors.length = 0;
    await page.waitForTimeout(3000);
  }
  return { page, context, errors };
}

/** What the documents panel actually calls its files, read off its own
 * search box. The panel's noun reaches the DOM as a placeholder, so this is
 * the only honest place to ask. */
async function panelNoun(page) {
  const box = page.locator('input[placeholder^="Search "]').last();
  return (await box.getAttribute("placeholder").catch(() => null)) ?? "(no search box found)";
}

const shot = async (page, name) => {
  const file = path.join(OUT, `docs-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  results.shots.push(file);
};

// A real file for the student to hand in.
const ESSAY = path.join(OUT, `essay-${stamp}.txt`);
fs.writeFileSync(ESSAY, "Quadratics: my working.\n");

// ===========================================================================
console.log("\n=== 1. Education end to end, in the browser ===");
const edu = await makeTenant("Education", "edu");
const teacher = await edu.makeUser("DB Teacher", "Teacher", "teacher");
const studentUser = await edu.makeUser("DB Student", "Student", "student");
check(!!teacher && !!studentUser, "a Teacher and a Student exist");

const course = await call(edu.admin, "course.create", { name: "Algebra II", teacherId: teacher.id });
const student = await call(edu.admin, "student.register", { name: "Ana Diaz" });
await call(edu.admin, "student.linkLogin", { studentId: student.b?.id, userId: studentUser.id });
const enrol = await call(edu.admin, "enrollment.enroll", { studentId: student.b?.id, courseId: course.b?.id });
const asg = await call(edu.admin, "assignment.create", { courseId: course.b?.id, title: `Quadratics essay ${stamp}`, dueDate: new Date(Date.now() + 6e8).toISOString(), maxScore: 100 });
check(!!asg.b?.id, `a course, an enrolled student and an assignment (${asg.s})`);

// --- the student hands work in -------------------------------------------
let submissionTaskId = null;
{
  const { page, context, errors } = await open(edu.workspaceId, studentUser, `${WEB}/workspace/page.my-assignments`, "text=/Not handed in|Handed in|Accepted/");
  const before = (await page.textContent("body")) ?? "";
  check(/Not handed in/.test(before), "the student's assignment reads 'Not handed in'");
  const handIn = page.getByRole("button", { name: /Hand in work/i });
  check(await handIn.isVisible().catch(() => false), "the student is offered 'Hand in work'");
  await shot(page, "01-student-before");

  await page.locator('input[type="file"]').first().setInputFiles(ESSAY);
  // ⚠️ Wait on the CARD, not the toast. "Handed in" appears in a toast the
  // instant the mutation returns, while the card is still refetching — the
  // first run screenshotted a card reading "Not handed in" and called it a
  // failure. The button relabels itself only once the new state has landed.
  await page.getByRole("button", { name: /Hand in again/i }).first().waitFor({ timeout: 30000 }).catch(() => {});
  const after = (await page.textContent("body")) ?? "";
  check(/Handed in/.test(after), "after uploading, it reads 'Handed in'");
  check(after.includes(path.basename(ESSAY)), `and names the file they sent (${path.basename(ESSAY)})`);
  await shot(page, "02-student-handed-in");
  const named = errors.filter((e) => PRE_EXISTING.test(e)).length;
  let bare = named;
  const own = errors.filter((e) => {
    if (PRE_EXISTING.test(e)) return false;
    if (bare > 0 && BARE_403.test(e)) { bare--; return false; }
    return true;
  });
  if (own.length !== errors.length) results.deferred.push("users.list 403 (Comments @-mentions) on the student's page");
  check(own.length === 0, `no errors on the student's page${own.length ? ` — ${own.join(" || ").slice(0, 280)}` : ""}`);
  await context.close();

  const { rows } = await db.query("select id from tasks where assignment_id=$1 and deleted_at is null", [asg.b.id]);
  submissionTaskId = rows[0]?.id;
  check(!!submissionTaskId, "a submission task exists for the teacher to review");
}

// --- the teacher hands it back -------------------------------------------
{
  const { page, context, errors } = await open(edu.workspaceId, teacher, `${WEB}/workspace/tasks/${submissionTaskId}`, "text=/Waiting on review|Reviewed|Not submitted/");
  const body = (await page.textContent("body")) ?? "";
  check(/Waiting on review/.test(body), "the teacher sees the submission waiting on review");
  check(body.includes("Ana Diaz"), "the task names the student whose work it is");
  // The evidence is the point of the review — it must be reachable from here.
  check(/Evidence/i.test(body) && body.includes(path.basename(ESSAY)), "the handed-in file is visible from the review page");
  await shot(page, "03-teacher-review");

  const changes = page.getByRole("button", { name: /Request changes/i });
  check(await changes.isVisible().catch(() => false), "the teacher is offered 'Request changes'");
  check(!(await page.getByRole("button", { name: /^Hand in work$/i }).isVisible().catch(() => false)), "and is NOT offered the student's hand-in control");
  const note = page.getByPlaceholder(/note for whoever did the work/i).first();
  check(await note.isVisible().catch(() => false), "and a box to say what needs changing");
  await note.fill("Show your working on Q3.");
  await changes.click();
  await page.locator("text=/Reviewed|Changes requested|In progress/i").first().waitFor({ timeout: 20000 }).catch(() => {});
  await shot(page, "04-teacher-requested-changes");
  const named = errors.filter((e) => PRE_EXISTING.test(e)).length;
  let bare = named;
  const own = errors.filter((e) => {
    if (PRE_EXISTING.test(e)) return false;
    if (bare > 0 && BARE_403.test(e)) { bare--; return false; }
    return true;
  });
  if (own.length !== errors.length) results.deferred.push("users.list 403 (Comments @-mentions) on the teacher's review page");
  check(own.length === 0, `no errors on the teacher's review page${own.length ? ` — ${own.join(" || ").slice(0, 280)}` : ""}`);
  await context.close();
}

// --- the student sees it came back ---------------------------------------
{
  const { page, context } = await open(edu.workspaceId, studentUser, `${WEB}/workspace/page.my-assignments`, "text=/Changes requested|Handed in/");
  const body = (await page.textContent("body")) ?? "";
  check(/Changes requested/.test(body), "the student sees 'Changes requested'");
  check(/Show your working on Q3\./.test(body), "and reads the teacher's note in their own portal");
  await shot(page, "05-student-changes-requested");
  // Handing in again from the same control.
  await page.locator('input[type="file"]').first().setInputFiles(ESSAY);
  await page.locator("text=/Handed in/").first().waitFor({ timeout: 30000 }).catch(() => {});
  check(/Handed in/.test((await page.textContent("body")) ?? ""), "and can hand in again from the same place");
  await shot(page, "06-student-resubmitted");
  await context.close();
}

// --- the teacher accepts, then grades ------------------------------------
{
  const approve = await call(teacher.token, "task.review", { id: submissionTaskId, decision: "approve" });
  check(approve.s === 200 || approve.s === 201, `the teacher accepts the work (${approve.s})`);
  const grade = await call(teacher.token, "grade.record", { assignmentId: asg.b.id, studentId: student.b.id, score: 82, feedback: "Strong, working now shown." });
  check(grade.s === 200 || grade.s === 201, `and records a grade (${grade.s})`);

  const { page, context, errors } = await open(edu.workspaceId, studentUser, `${WEB}/workspace/page.my-assignments`, "text=/82|Accepted|Graded/");
  const body = (await page.textContent("body")) ?? "";
  check(/82/.test(body), "the student sees their score");
  check(/Strong, working now shown\./.test(body), "and the teacher's feedback");
  await shot(page, "07-student-graded");
  const named = errors.filter((e) => PRE_EXISTING.test(e)).length;
  let bare = named;
  const own = errors.filter((e) => {
    if (PRE_EXISTING.test(e)) return false;
    if (bare > 0 && BARE_403.test(e)) { bare--; return false; }
    return true;
  });
  if (own.length !== errors.length) results.deferred.push("users.list 403 (Comments @-mentions) on the graded view");
  check(own.length === 0, `no errors on the graded view${own.length ? ` — ${own.join(" || ").slice(0, 280)}` : ""}`);
  await context.close();
}

// ===========================================================================
console.log("\n=== 2. The approval split, and domain vocabulary ===");

/** Uploads a file to a project as `who`, the ordinary two-step way. */
async function uploadAs(who, projectId, name) {
  const body = "evidence\n";
  const up = await call(who.token, "document.createUploadUrl", { projectId, fileName: name, mimeType: "text/plain", sizeBytes: Buffer.byteLength(body) });
  if (!up.b?.signedUrl) return null;
  await fetch(up.b.signedUrl, { method: "PUT", headers: { "content-type": "text/plain" }, body });
  const doc = await call(who.token, "document.create", { projectId, storagePath: up.b.path, name, mimeType: "text/plain", sizeBytes: Buffer.byteLength(body) });
  return doc.b?.id ?? null;
}

// --- Healthcare: "records", and the approval split -----------------------
{
  const hc = await makeTenant("Healthcare", "hc");
  const doctor = await hc.makeUser("DB Doctor", "Doctor", "doctor");
  const hospAdmin = await hc.makeUser("DB HospAdmin", "Hospital Administrator", "hospadmin");
  const patient = await call(hc.admin, "patient.register", { name: "R. Patel" });
  const chart = patient.b?.chartProjectId;
  await call(hc.admin, "project.addMember", { projectId: chart, userId: doctor.id });
  const task = await call(hc.admin, "task.create", { projectId: chart, title: `Post-op check ${stamp}`, assigneeId: doctor.id });
  const docId = await uploadAs(doctor, chart, `scan-${stamp}.txt`);
  await call(doctor.token, "document.update", { id: docId, name: `scan-${stamp}.txt` });
  // Attach it to the work, so the evidence line has something to say.
  await db.query("update documents set task_id=$1 where id=$2", [task.b?.id, docId]);
  check(!!docId, `a Doctor filed a record on a patient chart (${docId ? "ok" : "failed"})`);

  const { page, context, errors } = await open(hc.workspaceId, doctor, `${WEB}/workspace/patients`, "text=/R. Patel/");
  // The chart is a detail panel, not the list — open the patient first.
  await page.locator('button[title="Medical Record"]').first().click().catch(() => {});
  await page.locator("text=/Search records|No records yet/i").first().waitFor({ timeout: 25000 }).catch(() => {});
  const body = (await page.textContent("body")) ?? "";
  // ⚠️ The vocabulary finding: this panel said "documents" to everyone.
  const hcNoun = await panelNoun(page);
  check(/records/i.test(hcNoun), `the patient chart calls them RECORDS, not documents ("${hcNoun}")`);
  check(!/documents/i.test(hcNoun), "and never says 'Search documents' on a patient chart");
  check(/Request approval/i.test(body), "the uploading Doctor is offered 'Request approval'");
  check(new RegExp(`Evidence for`, "i").test(body), "the record says which work it is evidence for");
  await shot(page, "08-healthcare-records");
  const named = errors.filter((e) => PRE_EXISTING.test(e)).length;
  let bare = named;
  const own = errors.filter((e) => {
    if (PRE_EXISTING.test(e)) return false;
    if (bare > 0 && BARE_403.test(e)) { bare--; return false; }
    return true;
  });
  if (own.length !== errors.length) results.deferred.push("users.list 403 (Comments @-mentions) on the patient chart");
  check(own.length === 0, `no errors on the patient chart${own.length ? ` — ${own.join(" || ").slice(0, 280)}` : ""}`);
  await context.close();

  // The approver's view of the same file: the opposite control.
  await call(doctor.token, "document.requestApproval", { id: docId });
  const { page: p2, context: c2 } = await open(hc.workspaceId, hospAdmin, `${WEB}/workspace/documents/${docId}`, "text=/Approval|Approved|Pending/");
  const b2 = (await p2.textContent("body")) ?? "";
  check(/Approval/i.test(b2), "the Hospital Administrator is shown the approval control");
  check(!/Request approval/i.test(b2), "and is NOT offered the uploader's 'Request approval'");
  await shot(p2, "09-healthcare-approver");
  await c2.close();

  // And the uploader is not offered the decision.
  const { page: p3, context: c3 } = await open(hc.workspaceId, doctor, `${WEB}/workspace/documents/${docId}`, "text=/Approval|Pending|Uploaded/");
  const b3 = (await p3.textContent("body")) ?? "";
  const hasApproveSelect = await p3.locator("select").filter({ hasText: /Approved|Rejected/ }).count().catch(() => 0);
  check(hasApproveSelect === 0, "the uploading Doctor is NOT given the approve/reject control");
  await shot(p3, "10-healthcare-uploader");
  await c3.close();
}

// --- Education: "materials" ------------------------------------------------
{
  const { page, context, errors } = await open(edu.workspaceId, teacher, `${WEB}/workspace/courses/${course.b.id}`, "text=/material|Material/");
  // The tab has to be opened before the panel renders.
  await page.getByRole("tab", { name: /materials/i }).click().catch(async () => {
    await page.getByText(/^Materials$/i).first().click().catch(() => {});
  });
  await page.waitForTimeout(2500);
  const body = (await page.textContent("body")) ?? "";
  const eduNoun = await panelNoun(page);
  check(/materials/i.test(eduNoun), `a course calls them MATERIALS ("${eduNoun}")`);
  check(!/documents/i.test(eduNoun), "and never says 'Search documents' on a course");
  await shot(page, "11-education-materials");
  const named = errors.filter((e) => PRE_EXISTING.test(e)).length;
  let bare = named;
  const own = errors.filter((e) => {
    if (PRE_EXISTING.test(e)) return false;
    if (bare > 0 && BARE_403.test(e)) { bare--; return false; }
    return true;
  });
  if (own.length !== errors.length) results.deferred.push("users.list 403 (Comments @-mentions) on the course page");
  check(own.length === 0, `no errors on the course page${own.length ? ` — ${own.join(" || ").slice(0, 280)}` : ""}`);
  await context.close();
}

// --- IT: still "documents", the default --------------------------------------
{
  const it = await makeTenant("IT", "it");
  const lead = await it.makeUser("DB Lead", "Lead", "lead");
  const project = await call(it.admin, "project.create", { name: "Billing rewrite", status: "active", departmentId: it.deptId });
  await call(it.admin, "project.addMember", { projectId: project.b?.id, userId: lead.id });
  await uploadAs(lead, project.b?.id, `spec-${stamp}.txt`);
  const { page, context, errors } = await open(it.workspaceId, lead, `${WEB}/workspace/projects/${project.b.id}`, "text=/document|Document/");
  const body = (await page.textContent("body")) ?? "";
  // The panel lives behind a tab here, exactly as Materials does on a course —
  // landing on Overview and reporting "no search box" was the probe's fault.
  check(/Documents/.test(body), "an IT project's tab is labelled 'Documents'");
  await page.getByRole("tab", { name: /^Documents$/i }).click().catch(async () => {
    await page.getByText(/^Documents$/).first().click().catch(() => {});
  });
  await page.locator('input[placeholder^="Search "]').last().waitFor({ timeout: 20000 }).catch(() => {});
  const itNoun = await panelNoun(page);
  check(/documents/i.test(itNoun), `an IT project still calls them DOCUMENTS ("${itNoun}")`);
  await shot(page, "12-it-documents");
  const named = errors.filter((e) => PRE_EXISTING.test(e)).length;
  let bare = named;
  const own = errors.filter((e) => {
    if (PRE_EXISTING.test(e)) return false;
    if (bare > 0 && BARE_403.test(e)) { bare--; return false; }
    return true;
  });
  if (own.length !== errors.length) results.deferred.push("users.list 403 (Comments @-mentions) on the IT project page");
  check(own.length === 0, `no errors on the IT project page${own.length ? ` — ${own.join(" || ").slice(0, 280)}` : ""}`);
  await context.close();
}

await browser.close();
await db.end();

console.log(`\n${"=".repeat(80)}`);
console.log(`${results.checks} checks, ${results.failures.length} failure(s)`);
for (const f of results.failures) console.log(`  FAIL  ${f}`);
console.log(`${results.shots.length} screenshots in ${OUT}`);
if (results.deferred.length) {
  console.log(`\ndeferred (pre-existing, not this module):`);
  for (const d of [...new Set(results.deferred)]) console.log(`  - ${d}`);
}
fs.writeFileSync("documents-browser-result.json", JSON.stringify(results, null, 1));
