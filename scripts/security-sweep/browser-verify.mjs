import fs from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { chromium } from "playwright";
loadEnv({ path: "../../.env", quiet: true });

/**
 * Browser verification — the layer every phase of this project has disclosed
 * as unverified.
 *
 * Every previous phase ended with "no browser-automation tool exists in this
 * environment, so the visual layer still needs the user's own check". That was
 * true of the tooling, not of the possibility: Playwright installs and drives
 * headless Chromium from here perfectly well.
 *
 * This signs in as two REAL roles and drives the real UI — no API shortcuts
 * past the login form — then captures what each one actually sees. The
 * screenshots are the artifact; the assertions below are what makes a green
 * run mean something.
 *
 * Prereqs: API on :4000, web on :3000 (`pnpm --filter @purnit/web start`).
 */
const API = "http://localhost:4000";
const WEB = "http://localhost:3000";
const OUT = path.resolve("browser-shots");
fs.mkdirSync(OUT, { recursive: true });

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const stamp = Date.now();
const PW = "Browser!2026";
const PW2 = "Browser!2026x";

const H = (t) => ({ "content-type": "application/json", authorization: `Bearer ${t}` });
const j = async (r) => {
  try {
    return await r.json();
  } catch {
    return null;
  }
};
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

// ---- a workspace with a real, analysed report -------------------------------
const db = new pg.Client({ connectionString: process.env.DIRECT_URL });
await db.connect();

const adminEmail = `browser-admin+${stamp}@example.com`;
const su = await fetch(`${API}/auth/signup`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: adminEmail, password: PW, companyName: `Browser ${stamp}`, displayName: "BR Admin", industry: "Education" }),
});
const tenant = await j(su);
if (!tenant?.tenantId) {
  console.log("signup failed:", JSON.stringify(tenant).slice(0, 200));
  process.exit(1);
}
await db.query(
  "update tenants set seats_purchased = 20, subscription_status='pending_payment', plan_id=(select id from plans where key='professional') where id = $1",
  [tenant.tenantId],
);
const { data: aS } = await sb.auth.signInWithPassword({ email: adminEmail, password: PW });
const admin = aS.session.access_token;
const workspaceId = (await db.query("select workspace_id from tenants where id=$1", [tenant.tenantId])).rows[0]?.workspace_id;
console.log(`workspace Browser ${stamp} (${workspaceId})\n`);

console.log("setting up:");
const dept = await call(admin, "department.create", { name: "Faculty", type: "general" });
const roleRows = (await read(admin, "roles.list")).b ?? [];
const roleId = (label) => roleRows.find((r) => r.label === label)?.id;

async function makeUser(label, roleLabel, slug) {
  const email = `${slug}+${stamp}@example.com`;
  const inv = await call(admin, "user.invite", { email, displayName: label, roleId: roleId(roleLabel), departmentId: dept.b?.id });
  if (!inv.b?.temporaryPassword) return null;
  const { data: s1 } = await sb.auth.signInWithPassword({ email, password: inv.b.temporaryPassword });
  await sb.auth.updateUser({ password: PW2 });
  await fetch(`${API}/auth/complete-first-login`, { method: "POST", headers: H(s1.session.access_token) });
  const { data: s2 } = await sb.auth.signInWithPassword({ email, password: PW2 });
  return { email, token: s2.session.access_token };
}

const teacher = await makeUser("BR Teacher", "Teacher", "br-teacher");
const ta = await makeUser("BR TA", "Teaching Assistant", "br-ta");
check(!!teacher && !!ta, "Teacher and Teaching Assistant logins created");

const teacherUserId = (await db.query("select id from users where tenant_id=$1 and display_name='BR Teacher'", [tenant.tenantId])).rows[0]?.id;
const course = await call(admin, "course.create", { name: "Algebra II", description: "Term 1", teacherId: teacherUserId });

const csv = [
  "student,attendance_pct,quiz1,quiz2,midterm,notes",
  "Ada Lovelace,92,78,81,74,steady",
  "Grace Hopper,61,55,48,41,missed 4 classes",
  "Alan Turing,97,95,98,96,",
  "Ada Byron,45,40,38,35,at risk - repeated absence",
].join("\n");
const up = await call(admin, "document.createUploadUrl", {
  projectId: course.b.materialsProjectId,
  fileName: `term1-report-${stamp}.csv`,
  mimeType: "text/csv",
  sizeBytes: Buffer.byteLength(csv),
});
if (up.b?.signedUrl) await fetch(up.b.signedUrl, { method: "PUT", headers: { "content-type": "text/csv" }, body: csv });
const doc = await call(admin, "document.create", {
  projectId: course.b.materialsProjectId,
  storagePath: up.b?.path,
  name: `term1-report-${stamp}.csv`,
  mimeType: "text/csv",
  sizeBytes: Buffer.byteLength(csv),
});
check(!!doc.b?.id, `report uploaded to the course (${doc.s})`);

// Try to pre-run one analysis so the tab has real content. Deliberately NOT a
// hard requirement: the lens name — which is what this verification is about —
// comes from the registry and renders whether or not an analysis exists. The
// AI provider's daily quota is a real thing that runs out, and a UI check must
// not be hostage to it.
const pre = await call(teacher.token, "document.analyze", { documentId: doc.b.id });
const hasAnalysis = pre.s === 200 || pre.s === 201;
console.log(`  ${hasAnalysis ? "ok  " : "note"}  analysis pre-run: ${pre.s} ${hasAnalysis ? "" : String(pre.msg).slice(0, 90)}`);
if (!hasAnalysis) console.log("        (the Insights tab is still verified — the lens name does not depend on a completed analysis)");
await db.end();

// ---- drive the real UI ------------------------------------------------------
const browser = await chromium.launch();

async function signIn(page, email, password) {
  await page.goto(`${WEB}/login`, { waitUntil: "networkidle" });
  // The real two-step login form (workspace, then credentials), not a token
  // injected into storage — if sign-in is broken this must fail rather than
  // route around it. Located by placeholder because the inputs carry no
  // name/id attribute.
  await page.getByPlaceholder("Workspace ID").fill(workspaceId);
  await page.locator('button[type="submit"]').click();
  await page.getByPlaceholder("Email").waitFor({ timeout: 20000 });
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/workspace/, { timeout: 30000 });
}

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  results.shots.push(file);
  console.log(`     → ${file}`);
}

console.log("\ndriving the real UI:");
for (const [label, who] of [
  ["teacher", teacher],
  ["ta", ta],
]) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  try {
    await signIn(page, who.email, PW2);
    check(true, `${label}: signed in through the real login form`);
    await shot(page, `${label}-01-dashboard`);

    await page.goto(`${WEB}/workspace/documents/${doc.b.id}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    const title = await page.textContent("h1").catch(() => "");
    check(!!title && title.includes("term1-report"), `${label}: the document page renders its title (got "${String(title).slice(0, 40)}")`);
    await shot(page, `${label}-02-document`);

    // ⚠️ `role="tab"`, not a text match. A plain getByText("Insights") hit the
    // SIDEBAR's Insights nav group instead and merely expanded it, leaving
    // Overview selected — the screenshot is what caught it, which is rather
    // the point of checking the browser rather than the API.
    await page.getByRole("tab", { name: "Insights" }).click();
    await page.waitForSelector('[role="tab"][aria-selected="true"]', { timeout: 10000 });
    // Wait for the panel to actually RESOLVE, not for a guessed number of
    // milliseconds. A fixed 2s wait screenshotted skeleton loaders and read as
    // "no lens shown" — a timing artifact reported as a product failure.
    await page
      .locator("text=/Analysed for you as|No analysis yet|isn't part of your role|Couldn't load|shaped by what you work on/")
      .first()
      .waitFor({ timeout: 25000 })
      .catch(() => {});

    const selectedTab = await page.locator('[role="tab"][aria-selected="true"]').textContent();
    check(selectedTab?.trim() === "Insights", `${label}: the Insights tab is actually selected (got "${selectedTab?.trim()}")`);

    const body = (await page.textContent("body")) ?? "";
    // The lens NAME is the whole point — two roles must not see the same label.
    const lens = /Class performance/i.test(body) ? "Class performance" : /Class overview/i.test(body) ? "Class overview" : null;
    check(!!lens, `${label}: a lens name is shown on screen (got ${lens ?? "none"})`);
    console.log(`     lens on screen: ${lens}`);
    results[`${label}Lens`] = lens;
    await shot(page, `${label}-03-insights`);

    check(consoleErrors.length === 0, `${label}: no console errors${consoleErrors.length ? ` — ${consoleErrors.slice(0, 2).join(" | ").slice(0, 160)}` : ""}`);
  } catch (err) {
    check(false, `${label}: ${String(err).slice(0, 180)}`);
    await shot(page, `${label}-ERROR`);
  } finally {
    await context.close();
  }
}

check(
  !!results.teacherLens && !!results.taLens && results.teacherLens !== results.taLens,
  `the two roles see DIFFERENT lens names on screen (${results.teacherLens} vs ${results.taLens})`,
);

await browser.close();
console.log(`\n${"=".repeat(80)}`);
console.log(`${results.checks} checks run, ${results.failures.length} failure(s)`);
for (const f of results.failures) console.log(`  FAIL  ${f}`);
console.log(`\nscreenshots in ${OUT}`);
fs.writeFileSync("browser-result.json", JSON.stringify({ ...results, tenantName: `Browser ${stamp}` }, null, 2));
