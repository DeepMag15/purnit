import fs from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { chromium } from "playwright";
import { signupWithRetry, inviteWithRetry } from "./signup-retry.mjs";
loadEnv({ path: "../../.env", quiet: true });

/**
 * Comments review — the browser half of the AUDIT (findings only, no fixes).
 *
 * The API says who *may* collaborate. This asks what each person is actually
 * offered, which is a different question and the one that caught the real bug
 * in each of the last two modules.
 *
 * What it looks at:
 *   1. Whether a Student can reach the review conversation on their own work.
 *   2. What the @mention picker actually contains on each surface — the
 *      backend accepts any project member, but every call site feeds it from
 *      a different source.
 *   3. Whether a patient chart has a comment surface at all.
 *   4. Whether comments carry domain vocabulary the way documents now do.
 *
 * Prereqs: API on :4000, web on :3000.
 */
const API = "http://localhost:4000";
const WEB = "http://localhost:3000";
const OUT = path.resolve("browser-shots");
fs.mkdirSync(OUT, { recursive: true });

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const stamp = Date.now();
const PW = "ComBrow!2026aa";
const PW2 = "ComBrow!2026bb";

const H = (t) => ({ "content-type": "application/json", authorization: `Bearer ${t}` });
const j = async (r) => { try { return await r.json(); } catch { return null; } };
const call = async (tok, m, b = {}) => {
  const r = await fetch(`${API}/api/mutations/${m}`, { method: "POST", headers: H(tok), body: JSON.stringify(b) });
  const x = await j(r);
  return { s: r.status, b: x && typeof x === "object" && "data" in x ? x.data : x };
};
const read = async (tok, s, b = {}) => {
  const r = await fetch(`${API}/api/data/${s}`, { method: "POST", headers: H(tok), body: JSON.stringify(b) });
  const x = await j(r);
  return { s: r.status, b: x && typeof x === "object" && "data" in x ? x.data : x };
};

const results = { checks: 0, findings: [], shots: [] };
const note = (t) => console.log(`        ${t}`);
const check = (ok, label) => {
  results.checks++;
  console.log(`  ${ok ? "ok  " : "!!  "} ${label}`);
  if (!ok) results.findings.push(label);
};

const db = new pg.Client({ connectionString: process.env.DIRECT_URL });
await db.connect();

let seq = 0;
async function makeTenant(industry, slug) {
  const email = `cbr-${slug}-${seq++}+${stamp}@example.com`;
  const t = await signupWithRetry(API, { email, password: PW, companyName: `ComBrow ${slug} ${stamp}`, displayName: "CBr Admin", industry });
  if (!t?.tenantId) throw new Error(`${industry} signup failed`);
  await db.query("update tenants set seats_purchased = 25, stripe_subscription_id = $2, subscription_status = 'active' where id = $1", [t.tenantId, `sub_cbr_${stamp}_${seq}`]);
  const { data } = await sb.auth.signInWithPassword({ email, password: PW });
  const admin = data.session.access_token;
  const workspaceId = (await db.query("select workspace_id from tenants where id=$1", [t.tenantId])).rows[0]?.workspace_id;
  const roleRows = (await read(admin, "roles.list")).b ?? [];
  const dept = await call(admin, "department.create", { name: "Ops", type: "general" });
  return { tenantId: t.tenantId, admin, workspaceId, deptId: dept.b?.id, roleId: (l) => roleRows.find((r) => r.label === l)?.id };
}
async function makeUser(ctx, label, roleLabel, slug) {
  const email = `cbr-${slug}+${stamp}@example.com`;
  const inv = await inviteWithRetry(call, ctx.admin, { email, displayName: label, roleId: ctx.roleId(roleLabel), departmentId: ctx.deptId });
  if (!inv?.b?.temporaryPassword) { note(`invite ${roleLabel} failed: ${inv?.s}`); return null; }
  const { data: s1 } = await sb.auth.signInWithPassword({ email, password: inv.b.temporaryPassword });
  await sb.auth.updateUser({ password: PW2 });
  await fetch(`${API}/auth/complete-first-login`, { method: "POST", headers: H(s1.session.access_token) });
  const { data: s2 } = await sb.auth.signInWithPassword({ email, password: PW2 });
  const { rows } = await db.query("select id from users where tenant_id=$1 and display_name=$2", [ctx.tenantId, label]);
  return { email, token: s2.session.access_token, id: rows[0]?.id };
}

const browser = await chromium.launch();
async function signIn(page, workspaceId, email) {
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(`${WEB}/login`, { waitUntil: "networkidle" });
      await page.getByPlaceholder("Workspace ID").fill(workspaceId);
      await page.locator('button[type="submit"]').click();
      await page.getByPlaceholder("Email").waitFor({ timeout: 20000 });
      await page.getByPlaceholder("Email").fill(email);
      await page.getByPlaceholder("Password").fill(PW2);
      await page.locator('button[type="submit"]').click();
      await page.waitForURL(/\/workspace/, { timeout: 30000 });
      return;
    } catch { await page.waitForTimeout(2000); }
  }
  throw new Error(`sign-in failed for ${email}`);
}
async function open(ctx, who, url, settle) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on("response", async (r) => {
    if (r.status() >= 400 && r.url().includes("/api/")) errors.push(`${r.status()} ${r.url().split("/api/")[1]}`);
  });
  await signIn(page, ctx.workspaceId, who.email);
  for (let a = 0; a < 3; a++) {
    await page.goto(url, { waitUntil: "networkidle" });
    if (settle) await page.locator(settle).first().waitFor({ timeout: 20000 }).catch(() => {});
    const b = (await page.textContent("body").catch(() => "")) ?? "";
    if (!/Couldn't load your workspace|Internal server error/i.test(b)) break;
    errors.length = 0;
    await page.waitForTimeout(3000);
  }
  return { page, context, errors };
}
const shot = async (page, name) => {
  const f = path.join(OUT, `comments-${name}.png`);
  await page.screenshot({ path: f, fullPage: true });
  results.shots.push(f);
};

/** Opens the comment tab and reports what the @mention picker offers. */
async function mentionPicker(page) {
  const btn = page.getByRole("button", { name: /^Mention$/i }).first();
  await btn.waitFor({ timeout: 15000 }).catch(() => {});
  if (!(await btn.isVisible().catch(() => false))) return { present: false, names: [] };
  await btn.click().catch(() => {});
  await page.waitForTimeout(1500);
  // ⚠️ The audit pass looked for [role="menu"] and found nothing, reporting an
  // empty picker on a page whose screenshot clearly showed one name. The
  // Dropdown renders plain buttons; read the panel that appears next to the
  // control instead of assuming ARIA roles that were never set.
  const names = await page
    .locator("div.max-h-56 button")
    .allTextContents()
    .catch(() => []);
  return { present: true, names: names.map((n) => n.trim()).filter(Boolean) };
}

// ===========================================================================
console.log("\n=== 1. Education — can a Student reach the conversation on their own work? ===");
{
  const ctx = await makeTenant("Education", "edu");
  const teacher = await makeUser(ctx, "CBr Teacher", "Teacher", "teacher");
  const studentUser = await makeUser(ctx, "CBr Student", "Student", "student");
  const course = await call(ctx.admin, "course.create", { name: "Algebra II", teacherId: teacher.id });
  const student = await call(ctx.admin, "student.register", { name: "Ana Diaz" });
  await call(ctx.admin, "student.linkLogin", { studentId: student.b?.id, userId: studentUser.id });
  await call(ctx.admin, "enrollment.enroll", { studentId: student.b?.id, courseId: course.b?.id });
  const asg = await call(ctx.admin, "assignment.create", { courseId: course.b?.id, title: `Quadratics ${stamp}`, maxScore: 100 });

  const TXT = "my essay\n";
  const tgt = await call(studentUser.token, "assignment.submissionTarget", { assignmentId: asg.b?.id });
  const up = await call(studentUser.token, "document.createUploadUrl", { projectId: tgt.b?.projectId, fileName: `essay-${stamp}.txt`, mimeType: "text/plain", sizeBytes: Buffer.byteLength(TXT) });
  await fetch(up.b.signedUrl, { method: "PUT", headers: { "content-type": "text/plain" }, body: TXT });
  const sub = await call(studentUser.token, "assignment.submit", { assignmentId: asg.b?.id, storagePath: up.b.path, name: `essay-${stamp}.txt`, mimeType: "text/plain", sizeBytes: Buffer.byteLength(TXT) });
  const taskId = sub.b?.taskId;
  await call(teacher.token, "comment.create", { entityType: "task", entityId: taskId, body: "Show your working on Q3." });

  // The teacher's view: the review conversation exists and is usable.
  {
    const { page, context, errors } = await open(ctx, teacher, `${WEB}/workspace/tasks/${taskId}`, "text=/Comments|Details/");
    await page.getByRole("tab", { name: /comments/i }).click().catch(async () => { await page.getByText(/^Comments$/).first().click().catch(() => {}); });
    // Wait for the thread itself, not a fixed delay — the audit pass read the
    // page mid-switch and called a working thread missing.
    await page.locator("text=/Show your working on Q3\\./").first().waitFor({ timeout: 20000 }).catch(() => {});
    const body = (await page.textContent("body")) ?? "";
    check(/Show your working on Q3\./.test(body), "the teacher sees the review conversation on the submission");
    const mp = await mentionPicker(page);
    note(`teacher's @mention picker: ${mp.present ? JSON.stringify(mp.names) : "(no control offered)"}`);
    check(
      mp.present && mp.names.some((n) => /Student/i.test(n)),
      `the teacher's @mention picker offers the student they are reviewing (offered: ${JSON.stringify(mp.names)})`,
    );
    await shot(page, "01-teacher-task-comments");
    check(errors.length === 0, `no API errors on the teacher's task page${errors.length ? ` — ${[...new Set(errors)].join(", ")}` : ""}`);
    await context.close();
  }

  // The student's view: can they even open their own submission?
  {
    const { page, context, errors } = await open(ctx, studentUser, `${WEB}/workspace/tasks/${taskId}`, "text=/Comments|Details|not found|Couldn/");
    check(!/Task not found/.test((await page.textContent("body")) ?? ""), "the STUDENT can open their own submission at all");
    await page.getByRole("tab", { name: /comments/i }).click().catch(async () => { await page.getByText(/^Comments$/).first().click().catch(() => {}); });
    await page.locator("text=/Show your working on Q3\\./").first().waitFor({ timeout: 20000 }).catch(() => {});
    const body = (await page.textContent("body")) ?? "";
    check(/Show your working on Q3\./.test(body), "the STUDENT can see their teacher's comment on their own submission");
    const sp = await mentionPicker(page);
    check(sp.present && sp.names.length > 0, `and can @mention their teacher back (offered: ${JSON.stringify(sp.names)})`);
    await shot(page, "02-student-task-comments");
    note(`student page errors: ${[...new Set(errors)].join(", ") || "none"}`);
    await context.close();
  }
}

// ===========================================================================
console.log("\n=== 2. Healthcare — does a patient chart have a comment surface? ===");
{
  const ctx = await makeTenant("Healthcare", "hc");
  const doctor = await makeUser(ctx, "CBr Doctor", "Doctor", "doctor");
  const patient = await call(ctx.admin, "patient.register", { name: "R. Patel" });
  await call(ctx.admin, "project.addMember", { projectId: patient.b?.chartProjectId, userId: doctor.id });
  await call(doctor.token, "comment.create", { entityType: "project", entityId: patient.b?.chartProjectId, body: "Post-op review booked." });

  const { page, context } = await open(ctx, doctor, `${WEB}/workspace/patients`, "text=/R. Patel/");
  await page.locator('button[title="Medical Record"]').first().click().catch(() => {});
  await page.waitForTimeout(2500);
  const body = (await page.textContent("body")) ?? "";
  check(/Post-op review booked\./.test(body), "the Doctor can see chart comments in the UI (a comment posted via API is visible)");
  const noteBox = await page.getByPlaceholder(/Write a note/i).first().isVisible().catch(() => false);
  check(noteBox, "the patient chart offers a comment surface, in clinical vocabulary (\"Write a note…\")");
  await shot(page, "03-healthcare-chart");
  await context.close();
}

// ===========================================================================
console.log("\n=== 3. Manufacturing & Finance — the @mention picker ===");
{
  const mfg = await makeTenant("Manufacturing", "mfg");
  const planner = await makeUser(mfg, "CBr Planner", "Production Planner", "planner");
  const item = await call(mfg.admin, "inventoryItem.create", { sku: `SKU-${stamp}`, name: "M6 Bolt", type: "raw_material", unitOfMeasure: "each", reorderPoint: 10 });
  await call(mfg.admin, "project.addMember", { projectId: item.b?.filesProjectId, userId: planner.id });
  const { page, context } = await open(mfg, planner, `${WEB}/workspace/inventory-items/${item.b?.id}`, "text=/Discussion|Files|Overview/");
  await page.getByRole("tab", { name: /discussion/i }).click().catch(async () => { await page.getByText(/^Discussion$/i).first().click().catch(() => {}); });
  await page.waitForTimeout(2000);
  const mp = await mentionPicker(page);
  note(`Manufacturing @mention picker: ${mp.present ? JSON.stringify(mp.names) : "(no control offered)"}`);
  check(mp.present && mp.names.length > 0, `Manufacturing offers a populated @mention control (offered: ${JSON.stringify(mp.names)})`);
  const noteBox = await page.getByPlaceholder(/Write a note/i).first().isVisible().catch(() => false);
  check(noteBox, "and uses its own vocabulary (\"Write a note…\")");
  await shot(page, "04-manufacturing-discussion");
  await context.close();
}

await browser.close();
await db.end();
console.log(`\n${"=".repeat(80)}`);
console.log(`${results.checks} checks, ${results.findings.length} finding(s)`);
for (const f of results.findings) console.log(`  !! ${f}`);
console.log(`${results.shots.length} screenshots in ${OUT}`);
fs.writeFileSync("comments-browser-result.json", JSON.stringify(results, null, 1));
