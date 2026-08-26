import fs from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { chromium } from "playwright";
loadEnv({ path: "../../.env", quiet: true });

/**
 * Projects ecosystem review — the review step in the browser.
 *
 * The API proves the rules; this proves a person can actually use them, and
 * that the controls appear for the right person. Two real logins drive the
 * real UI: the assignee submits, the reviewer decides, and neither is offered
 * the other's control.
 *
 * Prereqs: API on :4000, web on :3000.
 */
const API = "http://localhost:4000";
const WEB = "http://localhost:3000";
const OUT = path.resolve("browser-shots");
fs.mkdirSync(OUT, { recursive: true });

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const stamp = Date.now();
const PW = "Review!2026aa";
const PW2 = "Review!2026bb";

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

const results = { checks: 0, failures: [], shots: [] };
const check = (ok, label) => {
  results.checks++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) results.failures.push(label);
};

const db = new pg.Client({ connectionString: process.env.DIRECT_URL });
await db.connect();

const adminEmail = `rev-admin+${stamp}@example.com`;
const su = await fetch(`${API}/auth/signup`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: adminEmail, password: PW, companyName: `Review ${stamp}`, displayName: "RV Admin", industry: "IT" }),
});
const tenant = await j(su);
if (!tenant?.tenantId) { console.log("signup failed"); process.exit(1); }
await db.query("update tenants set seats_purchased = 20 where id = $1", [tenant.tenantId]);
const { data: aS } = await sb.auth.signInWithPassword({ email: adminEmail, password: PW });
const admin = aS.session.access_token;
const workspaceId = (await db.query("select workspace_id from tenants where id=$1", [tenant.tenantId])).rows[0]?.workspace_id;

const dept = await call(admin, "department.create", { name: "Ops", type: "engineering" });
const roleRows = (await read(admin, "roles.list")).b ?? [];
const roleId = (label) => roleRows.find((r) => r.label === label)?.id;

async function makeUser(label, roleLabel, slug) {
  const email = `rev-${slug}+${stamp}@example.com`;
  const inv = await call(admin, "user.invite", { email, displayName: label, roleId: roleId(roleLabel), departmentId: dept.b?.id });
  if (!inv.b?.temporaryPassword) { console.log(`  !! invite ${roleLabel}: ${inv.s} ${String(inv.msg).slice(0, 80)}`); return null; }
  const { data: s1 } = await sb.auth.signInWithPassword({ email, password: inv.b.temporaryPassword });
  await sb.auth.updateUser({ password: PW2 });
  await fetch(`${API}/auth/complete-first-login`, { method: "POST", headers: H(s1.session.access_token) });
  const { data: s2 } = await sb.auth.signInWithPassword({ email, password: PW2 });
  return { email, token: s2.session.access_token };
}

const worker = await makeUser("RV Worker", "Practitioner", "worker");
const lead = await makeUser("RV Lead", "Lead", "lead");
check(!!worker && !!lead, "a Practitioner and a Lead, both in Ops");

const workerId = (await db.query("select id from users where tenant_id=$1 and display_name='RV Worker'", [tenant.tenantId])).rows[0]?.id;
const project = await call(admin, "project.create", { name: "Billing rewrite", status: "active" });
await call(admin, "project.addMember", { projectId: project.b.id, userId: workerId });
const task = await call(admin, "task.create", { projectId: project.b.id, title: `Migrate the ledger ${stamp}`, assigneeId: workerId });
check(!!task.b?.id, `work assigned (${task.s})`);
await db.end();

const browser = await chromium.launch();

async function signIn(page, email, password) {
  await page.goto(`${WEB}/login`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("Workspace ID").fill(workspaceId);
  await page.locator('button[type="submit"]').click();
  await page.getByPlaceholder("Email").waitFor({ timeout: 20000 });
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/workspace/, { timeout: 30000 });
}

async function open(who, label) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  // Name the failing call — "Failed to load resource: 404" alone sent me
  // guessing last time.
  page.on("response", async (r) => {
    if (r.status() >= 400 && r.url().includes("/api/")) {
      let which = "";
      try { which = JSON.parse(r.request().postData() ?? "{}") && r.url().split("/api/")[1]; } catch { /* ignore */ }
      errors.push(`${r.status()} ${which} :: ${(await r.text().catch(() => "")).slice(0, 200)}`);
    }
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  await signIn(page, who.email, PW2);
  await page.goto(`${WEB}/workspace/tasks/${task.b.id}`, { waitUntil: "networkidle" });
  // Wait for the panel to resolve rather than a guessed timeout — a fixed wait
  // screenshotted skeleton loaders last time and read as "control missing".
  await page.locator("text=/Not submitted|Waiting on review|Reviewed/").first().waitFor({ timeout: 25000 }).catch(() => {});
  const file = path.join(OUT, `review-${label}.png`);
  await page.screenshot({ path: file, fullPage: true });
  results.shots.push(file);
  return { page, context, errors };
}

console.log("\nthe assignee's view:");
{
  const { page, context, errors } = await open(worker, "01-worker-before");
  const body = (await page.textContent("body")) ?? "";
  check(/Not submitted/.test(body), "the panel shows the task is not submitted");
  const submit = page.getByRole("button", { name: "Submit for review" });
  check(await submit.isVisible().catch(() => false), "the assignee is offered 'Submit for review'");
  check(!(await page.getByRole("button", { name: "Approve" }).isVisible().catch(() => false)), "the assignee is NOT offered 'Approve'");

  await submit.click();
  await page.locator("text=/Waiting on review/").first().waitFor({ timeout: 20000 }).catch(() => {});
  const after = (await page.textContent("body")) ?? "";
  check(/Waiting on review/.test(after), "after submitting, the panel says it is waiting on review");
  check(/Someone else has to review this/.test(after), "and tells them they cannot finish it themselves");
  await page.screenshot({ path: path.join(OUT, "review-02-worker-submitted.png"), fullPage: true });
  check(errors.length === 0, `no console errors${errors.length ? ` — ${errors.join(" || ").slice(0, 300)}` : ""}`);
  await context.close();
}

console.log("\nthe board:");
{
  // A submitted task used to vanish from the board entirely — "in_review" had
  // no column, so its cards filtered out of all three. The worst possible
  // moment to lose sight of a piece of work.
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await signIn(page, lead.email, PW2);
  await page.goto(`${WEB}/workspace/page.tasks`, { waitUntil: "networkidle" });
  await page.locator(`text=/Migrate the ledger ${stamp}/`).first().waitFor({ timeout: 25000 }).catch(() => {});
  const body = (await page.textContent("body")) ?? "";
  check(/In review/.test(body), "the board has an 'In review' column");
  check(new RegExp(`Migrate the ledger ${stamp}`).test(body), "the submitted task is still visible on the board");
  // dnd-kit marks a live draggable with aria-roledescription; a locked column's
  // cards carry none, which is the difference between "you may move this" and
  // "a reviewer decides this".
  const dragHandles = await page.locator(`[aria-roledescription]:has-text("Migrate the ledger ${stamp}")`).count();
  check(dragHandles === 0, `and is not draggable while it waits on a decision (${dragHandles} drag handles)`);
  const shot = path.join(OUT, "review-05-board.png");
  await page.screenshot({ path: shot, fullPage: true });
  results.shots.push(shot);
  await context.close();
}


console.log("\nthe reviewer's view:");
{
  const { page, context, errors } = await open(lead, "03-lead-pending");
  const body = (await page.textContent("body")) ?? "";
  check(/Waiting on review/.test(body), "the Lead sees it waiting on review");
  check(await page.getByRole("button", { name: "Approve" }).isVisible().catch(() => false), "the Lead is offered 'Approve'");
  check(await page.getByRole("button", { name: "Request changes" }).isVisible().catch(() => false), "and 'Request changes'");
  check(!(await page.getByRole("button", { name: "Submit for review" }).isVisible().catch(() => false)), "the Lead is NOT offered 'Submit for review'");

  await page.getByRole("button", { name: "Approve" }).click();
  await page.locator("text=/Reviewed/").first().waitFor({ timeout: 20000 }).catch(() => {});
  const after = (await page.textContent("body")) ?? "";
  check(/Reviewed/.test(after), "after approving, the panel shows it reviewed");
  await page.screenshot({ path: path.join(OUT, "review-04-lead-approved.png"), fullPage: true });
  check(errors.length === 0, `no console errors${errors.length ? ` — ${errors.join(" || ").slice(0, 300)}` : ""}`);
  await context.close();
}

const final = await read(admin, "task.detail", { id: task.b.id });
check(final.b?.status === "done", `the task ended up done (${final.b?.status})`);

await browser.close();
console.log(`\n${"=".repeat(80)}`);
console.log(`${results.checks} checks run, ${results.failures.length} failure(s)`);
for (const f of results.failures) console.log(`  FAIL  ${f}`);
console.log(`\nscreenshots in ${OUT}`);
fs.writeFileSync("review-browser-result.json", JSON.stringify(results, null, 2));
