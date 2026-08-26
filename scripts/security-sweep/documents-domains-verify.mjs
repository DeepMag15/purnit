import fs from "node:fs";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { signupWithRetry, inviteWithRetry } from "./signup-retry.mjs";
loadEnv({ path: "../../.env", quiet: true });

/**
 * Documents module review — the whole document lifecycle, in every domain,
 * with the roles that actually do the work.
 *
 * `documents-audit.mjs` proved the restricted boundary and the approval split
 * in ONE domain each. This runs the full lifecycle in all five, because the
 * standing rule for this review is that a module must not be assumed to work
 * the same way everywhere — and Documents is the most shared surface in the
 * platform: the same panel serves an IT project, a patient's chart, a course,
 * a client and an inventory item.
 *
 * Per domain: upload → attach as task evidence → rename → replace → request
 * approval → refuse the uploader's own approval → approve as someone else →
 * delete. Plus, for the two domains that have restricted projects, the full
 * write matrix against someone who cannot read them, AI analysis included.
 *
 * Who does what is read from the tenant's own roles rather than hardcoded, so
 * this keeps testing the real blueprint rather than a copy of it that drifts.
 *
 * Prereq: API on :4000.
 */
const API = "http://localhost:4000";
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const stamp = Date.now();
const PW = "DomVerify!2026";
const PW2 = "DomVerify!2026x";

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

const TXT = "evidence body\n";
async function upload(tok, projectId, fileName, extra = {}) {
  const up = await call(tok, "document.createUploadUrl", { projectId, fileName, mimeType: "text/plain", sizeBytes: Buffer.byteLength(TXT) });
  if (!up.b?.signedUrl) return { ok: false, stage: "createUploadUrl", s: up.s, msg: up.msg };
  await fetch(up.b.signedUrl, { method: "PUT", headers: { "content-type": "text/plain" }, body: TXT });
  const doc = await call(tok, "document.create", { projectId, storagePath: up.b.path, name: fileName, mimeType: "text/plain", sizeBytes: Buffer.byteLength(TXT), ...extra });
  return { ok: !!doc.b?.id, stage: "create", s: doc.s, msg: doc.msg, id: doc.b?.id };
}

/**
 * The five domains and how each reaches a real, writable project. Four of
 * them go through a domain entity — `Project` is invisible plumbing there —
 * which is precisely why Documents has to be exercised through each of them.
 */
const DOMAINS = {
  IT: {
    worker: "Practitioner",
    workerCanUpload: false,
    // ⚠️ Given a department deliberately. IT's Manager holds
    // `document:approve:department`, not `:tenant` — a department-less
    // project (what `project.create` produces by default) puts every
    // approver out of scope, and the resulting 403 is correct rather than a
    // finding. The realistic setup is the one a real workspace has.
    async target(tok, deptId) {
      const p = await call(tok, "project.create", { name: "Billing rewrite", status: "active", departmentId: deptId });
      return { projectId: p.b?.id, s: p.s, msg: p.msg };
    },
  },
  Healthcare: {
    worker: "Nurse",
    workerCanUpload: false,
    restrictedBy: "patient:update",
    outsider: "Receptionist",
    async target(tok) { const p = await call(tok, "patient.register", { name: "R. Patel" }); return { projectId: p.b?.chartProjectId, s: p.s, msg: p.msg }; },
  },
  Education: {
    worker: "Teaching Assistant",
    workerCanUpload: false,
    async target(tok) { const c = await call(tok, "course.create", { name: "Algebra II" }); return { projectId: c.b?.materialsProjectId, s: c.s, msg: c.msg }; },
  },
  Finance: {
    worker: "Billing Clerk",
    async target(tok) { const c = await call(tok, "client.create", { name: "Northwind Ltd" }); return { projectId: c.b?.filesProjectId, s: c.s, msg: c.msg }; },
  },
  Manufacturing: {
    worker: "Warehouse Staff",
    async target(tok) {
      const i = await call(tok, "inventoryItem.create", { sku: `SKU-${stamp}`, name: "M6 Bolt", type: "raw_material", unitOfMeasure: "each", reorderPoint: 10 });
      return { projectId: i.b?.filesProjectId, s: i.s, msg: i.msg };
    },
  },
};

for (const [industry, cfg] of Object.entries(DOMAINS)) {
  console.log(`\n=== ${industry} ===`);
  const adminEmail = `dom-${industry.toLowerCase()}+${stamp}@example.com`;
  const tenant = await signupWithRetry(API, { email: adminEmail, password: PW, companyName: `Dom ${industry} ${stamp}`, displayName: "DV Admin", industry });
  if (!tenant?.tenantId) { check(`${industry}-SETUP`, false, `${industry}: signup failed`); continue; }
  const tenantId = tenant.tenantId;
  await db.query("update tenants set seats_purchased = 25, stripe_subscription_id = $2, subscription_status = 'active' where id = $1", [tenantId, `sub_dom_${stamp}_${industry}`]);
  const { data: aS } = await sb.auth.signInWithPassword({ email: adminEmail, password: PW });
  const admin = aS.session.access_token;

  const roleRows = (await read(admin, "roles.list")).b ?? [];
  const roleId = (l) => roleRows.find((r) => r.label === l)?.id;
  const dept = await call(admin, "department.create", { name: "Ops", type: "general" });
  const D = dept.b?.id;

  async function makeUser(label, roleLabel, slug) {
    if (!roleId(roleLabel)) return null;
    const e = `dom-${slug}-${industry.toLowerCase()}+${stamp}@example.com`;
    const inv = await inviteWithRetry(call, admin, { email: e, displayName: label, roleId: roleId(roleLabel), departmentId: D });
    if (!inv?.b?.temporaryPassword) { note(`invite ${roleLabel} failed: ${inv?.s}`); return null; }
    const { data: s1 } = await sb.auth.signInWithPassword({ email: e, password: inv.b.temporaryPassword });
    await sb.auth.updateUser({ password: PW2 });
    await fetch(`${API}/auth/complete-first-login`, { method: "POST", headers: H(s1.session.access_token) });
    const { data: s2 } = await sb.auth.signInWithPassword({ email: e, password: PW2 });
    const { rows } = await db.query("select id from users where tenant_id=$1 and display_name=$2", [tenantId, label]);
    return { email: e, token: s2.session.access_token, id: rows[0]?.id, role: roleLabel };
  }

  // Who actually holds what here — read from the tenant's own roles, so this
  // tests the blueprint rather than an assumption about it.
  const { rows: grantRows } = await db.query("select label, permissions from roles where tenant_id=$1", [tenantId]);
  const has = (r, p) => (r.permissions ?? []).some((g) => g.startsWith(p));
  const approverLabel = grantRows.find((r) => has(r, "document:approve") && r.label !== "Owner")?.label;

  /**
   * ⚠️ A documented design fact, recorded rather than assumed.
   *
   * The Projects review left this open: **Practitioner, Nurse and Teaching
   * Assistant hold no `document:create` at all**, so in IT, Healthcare and
   * Education the person doing the work cannot file their own evidence — it
   * has to come from someone more senior. That is a blueprint decision about
   * those domains, not a Documents bug, and this probe asserts it explicitly
   * so it stays visible instead of surfacing as a mystery 403 later.
   */
  const workerHasCreate = grantRows.some((r) => r.label === cfg.worker && has(r, "document:create"));
  check(
    `${industry}-0`,
    workerHasCreate === (cfg.workerCanUpload ?? true),
    `the ${cfg.worker} ${workerHasCreate ? "holds" : "holds NO"} document:create — ${cfg.workerCanUpload === false ? "expected, blueprint design (deferred to a domain review)" : "expected"}`,
  );

  // The uploader for the lifecycle below: someone who can create documents but
  // deliberately CANNOT approve them, or the separation test proves nothing.
  const uploaderLabel = workerHasCreate
    ? cfg.worker
    : grantRows.find((r) => has(r, "document:create") && !has(r, "document:approve") && r.label !== "Owner")?.label;
  note(`uploader: ${uploaderLabel ?? "(none)"}   document:approve held by: ${approverLabel ?? "(nobody but Owner)"}`);
  if (!uploaderLabel) { check(`${industry}-SETUP`, false, `${industry}: no role holds document:create without document:approve`); continue; }

  const worker = await makeUser("DV Worker", uploaderLabel, "worker");
  if (!worker) { check(`${industry}-SETUP`, false, `${industry}: could not create a ${uploaderLabel}`); continue; }
  cfg.worker = uploaderLabel;

  const t = await cfg.target(admin, D);
  const projectId = t.projectId;
  if (!projectId) { check(`${industry}-SETUP`, false, `${industry}: no backing project (${t.s} ${String(t.msg).slice(0, 60)})`); continue; }

  // The worker has to be able to reach it. In IT the admin owns the project;
  // in the other four the backing project is reached through the domain
  // entity's own scope, exactly as a real user would.
  await call(admin, "project.addMember", { projectId, userId: worker.id });

  // --- 1. upload, and attach to the work it is evidence for ----------------
  const task = await call(admin, "task.create", { projectId, title: "Do the thing", assigneeId: worker.id });
  const up = await upload(worker.token, projectId, `evidence-${industry}-${stamp}.txt`, task.b?.id ? { taskId: task.b.id } : {});
  check(`${industry}-1`, up.ok, `the ${cfg.worker} can upload a file (${up.stage} ${up.s} ${String(up.msg).slice(0, 55)})`);
  if (!up.id) continue;

  // --- 2. the evidence link is readable, not just writable -----------------
  const listed = await read(worker.token, "documents.list", { projectId });
  const row = (listed.b ?? []).find((d) => d.id === up.id) ?? {};
  check(`${industry}-2`, row.taskId === task.b?.id, `the file says which task it is evidence for (taskId ${row.taskId ? "set" : "missing"})`);
  check(`${industry}-3`, row.taskTitle === "Do the thing", `and names that task for a human (${JSON.stringify(row.taskTitle)})`);
  const byTask = await read(worker.token, "documents.list", { projectId, taskId: task.b?.id });
  check(`${industry}-4`, (byTask.b ?? []).some((d) => d.id === up.id), `a reviewer can filter to just that task's evidence (${(byTask.b ?? []).length} row(s))`);

  // --- 3. request approval is the UPLOADER's, and needs no approve grant ---
  check(`${industry}-5`, row.canRequestApproval === true, `the uploader is told they may request approval (canRequestApproval ${row.canRequestApproval})`);
  check(`${industry}-6`, row.canApprove === false, `and told they may NOT approve it themselves (canApprove ${row.canApprove})`);
  const req = await call(worker.token, "document.requestApproval", { id: up.id });
  check(`${industry}-7`, req.s === 200 || req.s === 201, `the uploader can request approval holding no document:approve (${req.s} ${String(req.msg).slice(0, 55)})`);
  const selfApprove = await call(worker.token, "document.setApprovalStatus", { id: up.id, status: "approved" });
  check(`${industry}-8`, selfApprove.s === 403, `the uploader CANNOT approve their own file (${selfApprove.s})`);

  // --- 4. approve is someone else's -----------------------------------------
  const approver = approverLabel ? await makeUser("DV Approver", approverLabel, "approver") : null;
  if (approver) {
    const detail = await read(approver.token, "document.detail", { id: up.id });
    check(`${industry}-9`, detail.b?.canApprove === true, `the ${approverLabel} is told they MAY approve it (canApprove ${detail.b?.canApprove})`);
    check(`${industry}-10`, detail.b?.canRequestApproval === false, `and is NOT offered the uploader's request control (canRequestApproval ${detail.b?.canRequestApproval})`);
    const ok = await call(approver.token, "document.setApprovalStatus", { id: up.id, status: "approved" });
    check(`${industry}-11`, ok.s === 200 || ok.s === 201, `the ${approverLabel} can approve it (${ok.s} ${String(ok.msg).slice(0, 55)})`);
  } else {
    const ok = await call(admin, "document.setApprovalStatus", { id: up.id, status: "approved" });
    check(`${industry}-11`, ok.s === 200 || ok.s === 201, `an approver can approve it (${ok.s})`);
  }

  // --- 5. rename and replace, by someone in scope ---------------------------
  const rename = await call(admin, "document.update", { id: up.id, name: `renamed-${stamp}.txt` });
  check(`${industry}-12`, rename.s === 200 || rename.s === 201, `an in-scope user can rename it (${rename.s} ${String(rename.msg).slice(0, 55)})`);
  const repl = await call(admin, "document.createReplaceUploadUrl", { id: up.id, fileName: "v2.txt", mimeType: "text/plain", sizeBytes: 5 });
  check(`${industry}-13`, repl.s === 200 || repl.s === 201, `and replace its contents (${repl.s} ${String(repl.msg).slice(0, 55)})`);

  // --- 6. delete -----------------------------------------------------------
  const del = await call(admin, "document.delete", { id: up.id });
  check(`${industry}-14`, del.s === 200 || del.s === 201, `and delete it (${del.s} ${String(del.msg).slice(0, 55)})`);

  // --- 7. the restricted boundary, where the domain has one ----------------
  if (!cfg.restrictedBy) continue;
  console.log(`\n  --- ${industry}: the restricted boundary (${cfg.outsider} holds no ${cfg.restrictedBy}) ---`);
  const outsider = await makeUser("DV Outsider", cfg.outsider, "outsider");
  if (!outsider) { check(`${industry}-R0`, false, `could not create a ${cfg.outsider}`); continue; }
  const outsiderGrants = grantRows.find((r) => r.label === cfg.outsider)?.permissions ?? [];
  note(`${cfg.outsider} holds: ${outsiderGrants.filter((g) => g.startsWith("document:")).join(", ") || "(no document grants)"}`);

  // A file inside the restricted chart, put there by someone who may.
  const inner = await upload(admin, projectId, `chart-${stamp}.txt`);
  if (!inner.id) { check(`${industry}-R0`, false, `could not seed the restricted project (${inner.stage} ${inner.s})`); continue; }

  const rList = await read(outsider.token, "documents.list", { projectId });
  check(`${industry}-R1`, rList.s === 404, `the ${cfg.outsider} cannot LIST it (${rList.s})`);
  const rDetail = await read(outsider.token, "document.detail", { id: inner.id });
  check(`${industry}-R2`, rDetail.s === 404, `cannot OPEN it (${rDetail.s})`);
  const rUrl = await call(outsider.token, "document.getFileUrl", { id: inner.id, mode: "download" });
  check(`${industry}-R3`, rUrl.s === 404, `cannot DOWNLOAD it (${rUrl.s})`);
  /**
   * ⚠️ Two different gates can refuse a write here, and they are not
   * interchangeable — so this reports which one fired rather than accepting
   * any refusal.
   *
   *   - **Missing the grant entirely** → 403 from the controller's
   *     `requiredPermission` check, before any document is looked up. Leaks
   *     nothing: every caller without the grant gets it for every document.
   *     Healthcare's Receptionist is this case — they hold `document:create`
   *     and no `document:update`/`delete` at all.
   *   - **Holding the grant but not reaching the project** → must be 404,
   *     because a 403 there would confirm the file exists. This is the case
   *     the review actually fixed, and `documents-audit.mjs` exercises it in
   *     Education, where a Teacher holds `document:update:tenant` and no
   *     `student:update`.
   *
   * Defense in depth is the reason Healthcare cannot reach the second case:
   * the only role lacking the chart gate also lacks the write grants.
   */
  const holds = (a) => outsiderGrants.some((g) => g.startsWith(`document:${a}`));
  const verdictFor = (r, action) => {
    const needs404 = holds(action);
    return {
      ok: needs404 ? r.s === 404 : r.s === 403 || r.s === 404,
      why: needs404 ? `holds document:${action}, so must be 404` : `holds no document:${action} — refused at the permission gate`,
    };
  };
  const rRename = await call(outsider.token, "document.update", { id: inner.id, name: "tampered.txt" });
  const vRename = verdictFor(rRename, "update");
  check(`${industry}-R4`, vRename.ok, `cannot RENAME it (${rRename.s}; ${vRename.why})`);
  const rRepl = await call(outsider.token, "document.createReplaceUploadUrl", { id: inner.id, fileName: "x.txt", mimeType: "text/plain", sizeBytes: 5 });
  const vRepl = verdictFor(rRepl, "update");
  check(`${industry}-R5`, vRepl.ok, `cannot REPLACE it (${rRepl.s}; ${vRepl.why})`);
  const rDel = await call(outsider.token, "document.delete", { id: inner.id });
  const vDel = verdictFor(rDel, "delete");
  check(`${industry}-R6`, vDel.ok, `cannot DELETE it (${rDel.s}; ${vDel.why})`);
  const rPlant = await upload(outsider.token, projectId, `planted-${stamp}.txt`);
  check(`${industry}-R7`, !rPlant.ok && rPlant.s === 404, `cannot PLANT a new file in it (${rPlant.stage} ${rPlant.s})`);
  const rReq = await call(outsider.token, "document.requestApproval", { id: inner.id });
  check(`${industry}-R8`, rReq.s === 404, `cannot request approval on it (${rReq.s})`);
  const rApprove = await call(outsider.token, "document.setApprovalStatus", { id: inner.id, status: "approved" });
  check(`${industry}-R9`, rApprove.s === 403 || rApprove.s === 404, `cannot approve it (${rApprove.s})`);
  // The cheapest way to read a file you cannot open is to ask the AI to
  // summarise it — so the analysis path must sit behind the same gate.
  const rAnalyze = await call(outsider.token, "document.analyze", { documentId: inner.id });
  check(`${industry}-R10`, rAnalyze.s === 403 || rAnalyze.s === 404, `cannot ask the AI to ANALYSE it (${rAnalyze.s})`);
  // And the work itself, not just the file — a task in a restricted project
  // names its subject in the title.
  const rTasks = await read(outsider.token, "tasks.list", {});
  const taskRows = Array.isArray(rTasks.b) ? rTasks.b : null;
  check(
    `${industry}-R11`,
    taskRows === null ? rTasks.s >= 400 : !taskRows.some((x) => x.id === task.b?.id),
    taskRows === null
      ? `and is refused tasks.list outright (${rTasks.s} — holds no task:read)`
      : `and does not see the restricted project's TASKS (${taskRows.length} row(s) visible, none of them it)`,
  );
}

await db.end();
console.log(`\n${"=".repeat(80)}`);
const bugs = findings.filter((f) => f.verdict === "BUG");
console.log(`${findings.length} checks, ${bugs.length} finding(s)`);
for (const b of bugs) console.log(`  !! ${b.id}  ${b.label}`);
fs.writeFileSync("documents-domains-result.json", JSON.stringify(findings, null, 1));
