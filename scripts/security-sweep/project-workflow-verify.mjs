import fs from "node:fs";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
loadEnv({ path: "../../.env", quiet: true });

/**
 * Projects ecosystem review — the delivery workflow, end to end, with real
 * people.
 *
 *   Project → Task → Assignment → work → evidence → SUBMIT → REVIEW → done
 *
 * Before this a person was given work, did it, and marked it done themselves.
 * The three properties that make the new step mean anything are checked here
 * against a running system, not asserted:
 *
 *   1. Only the assignee submits.
 *   2. Never the assignee decides — even holding the review grant.
 *   3. A submitted task cannot be walked out of review by the ordinary
 *      status route, which is the one an assignee already has.
 */
const API = "http://localhost:4000";
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const stamp = Date.now();
const PW = "Workflow!2026";
const PW2 = "Workflow!2026x";

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
  return { s: r.status, b: x && typeof x === "object" && "data" in x ? x.data : x, msg: x?.message ?? "" };
};

const results = { checks: 0, failures: [] };
const check = (ok, label) => {
  results.checks++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) results.failures.push(label);
};

const db = new pg.Client({ connectionString: process.env.DIRECT_URL });
await db.connect();

/** industry -> the worker role, the reviewer role, and how to make a target. */
const DOMAINS = {
  IT: { worker: "Practitioner", reviewer: "Lead", async target(tok) { const p = await call(tok, "project.create", { name: "Billing rewrite", status: "active" }); return p.b?.id; } },
  Healthcare: { worker: "Nurse", reviewer: "Doctor", async target(tok) { const p = await call(tok, "patient.register", { name: "R. Patel" }); return p.b?.chartProjectId; } },
  Education: { worker: "Teaching Assistant", reviewer: "Teacher", async target(tok) { const c = await call(tok, "course.create", { name: "Algebra II" }); return c.b?.materialsProjectId; } },
  Finance: { worker: "Billing Clerk", reviewer: "Accountant", async target(tok) { const c = await call(tok, "client.create", { name: "Northwind Ltd" }); return c.b?.filesProjectId; } },
  Manufacturing: { worker: "Warehouse Staff", reviewer: "Production Planner", async target(tok) { const i = await call(tok, "inventoryItem.create", { sku: `SKU-${stamp}`, name: "M6 Bolt", type: "raw_material", unitOfMeasure: "each", reorderPoint: 10 }); return i.b?.filesProjectId; } },
};

for (const [industry, cfg] of Object.entries(DOMAINS)) {
  console.log(`\n${industry}  (worker: ${cfg.worker} → reviewer: ${cfg.reviewer})`);
  const adminEmail = `flow-${industry.toLowerCase()}+${stamp}@example.com`;
  const su = await fetch(`${API}/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: adminEmail, password: PW, companyName: `Flow ${industry} ${stamp}`, displayName: "FL Admin", industry }),
  });
  const tenant = await j(su);
  if (!tenant?.tenantId) { check(false, `${industry}: signup failed`); continue; }
  await db.query("update tenants set seats_purchased = 20 where id = $1", [tenant.tenantId]);
  const { data: aS } = await sb.auth.signInWithPassword({ email: adminEmail, password: PW });
  const admin = aS.session.access_token;

  const dept = await call(admin, "department.create", { name: "Ops", type: "general" });
  const roleRows = (await read(admin, "roles.list")).b ?? [];
  const roleId = (label) => roleRows.find((r) => r.label === label)?.id;

  async function makeUser(label, roleLabel, slug) {
    const email = `flow-${slug}-${industry.toLowerCase()}+${stamp}@example.com`;
    const inv = await call(admin, "user.invite", { email, displayName: label, roleId: roleId(roleLabel), departmentId: dept.b?.id });
    if (!inv.b?.temporaryPassword) { console.log(`     !! invite ${roleLabel}: ${inv.s} ${String(inv.msg).slice(0, 70)}`); return null; }
    const { data: s1 } = await sb.auth.signInWithPassword({ email, password: inv.b.temporaryPassword });
    await sb.auth.updateUser({ password: PW2 });
    await fetch(`${API}/auth/complete-first-login`, { method: "POST", headers: H(s1.session.access_token) });
    const { data: s2 } = await sb.auth.signInWithPassword({ email, password: PW2 });
    return s2.session.access_token;
  }

  const workerTok = await makeUser("FL Worker", cfg.worker, "worker");
  const reviewerTok = await makeUser("FL Reviewer", cfg.reviewer, "reviewer");
  if (!workerTok || !reviewerTok) { check(false, `${industry}: could not create both roles`); continue; }

  const workerId = (await db.query("select id from users where tenant_id=$1 and display_name='FL Worker'", [tenant.tenantId])).rows[0]?.id;
  const projectId = await cfg.target(admin);
  if (!projectId) { check(false, `${industry}: no target project`); continue; }

  // Make the worker a member so they can be assigned, then assign the work.
  await call(admin, "project.addMember", { projectId, userId: workerId }).catch(() => {});
  const task = await call(admin, "task.create", { projectId, title: `Field work ${stamp}`, assigneeId: workerId });
  check(!!task.b?.id, `work assigned to the ${cfg.worker} (${task.s} ${String(task.msg).slice(0, 60)})`);
  if (!task.b?.id) continue;

  // --- evidence attaches to the WORK, not loosely to the project ------------
  const body = `report for ${stamp}\nmetric,value\nthroughput,84\n`;
  const up = await call(workerTok, "document.createUploadUrl", { projectId, fileName: `evidence-${stamp}.csv`, mimeType: "text/csv", sizeBytes: Buffer.byteLength(body) });
  let evidenceOk = false;
  if (up.b?.signedUrl) {
    await fetch(up.b.signedUrl, { method: "PUT", headers: { "content-type": "text/csv" }, body });
    const doc = await call(workerTok, "document.create", { projectId, storagePath: up.b.path, name: `evidence-${stamp}.csv`, mimeType: "text/csv", sizeBytes: Buffer.byteLength(body), taskId: task.b.id });
    evidenceOk = !!doc.b?.id;
    if (evidenceOk) {
      const forTask = await read(workerTok, "documents.list", { projectId, taskId: task.b.id });
      check(Array.isArray(forTask.b) && forTask.b.length === 1, `evidence is filed against the task, not loose on the project (${(forTask.b ?? []).length})`);
    }
  }
  if (evidenceOk) {
    check(true, `the ${cfg.worker} attached evidence to their own task`);
  } else if (up.s === 403) {
    // Not a failure: Nurse / Teaching Assistant / Practitioner hold no
    // document:create by deliberate blueprint design. Recorded so the gap is
    // visible rather than silently passing.
    console.log(`  note  the ${cfg.worker} holds no document:create — evidence must come from someone senior in this domain`);
  } else {
    check(false, `the ${cfg.worker} attached evidence to their own task (${up.s} ${String(up.msg).slice(0, 60)})`);
  }

  // --- 3. the assignee cannot skip the reviewer -----------------------------
  const submitByOther = await call(reviewerTok, "task.submitForReview", { id: task.b.id });
  check(submitByOther.s === 403, `only the assignee may submit — the ${cfg.reviewer} is refused (${submitByOther.s})`);

  const submit = await call(workerTok, "task.submitForReview", { id: task.b.id, note: "done, evidence attached" });
  check(submit.s === 200 || submit.s === 201, `the ${cfg.worker} submits their own work (${submit.s} ${String(submit.msg).slice(0, 60)})`);

  const sneak = await call(workerTok, "task.updateStatus", { id: task.b.id, status: "done" });
  check(sneak.s === 400, `once submitted, the assignee cannot mark it done themselves (${sneak.s})`);

  // --- 2. never the assignee decides ---------------------------------------
  const selfReview = await call(workerTok, "task.review", { id: task.b.id, decision: "approve" });
  check(selfReview.s === 403, `the ${cfg.worker} cannot review their own work (${selfReview.s})`);

  const changes = await call(reviewerTok, "task.review", { id: task.b.id, decision: "request_changes", note: "add the QC numbers" });
  check(changes.s === 200 || changes.s === 201, `the ${cfg.reviewer} can request changes (${changes.s} ${String(changes.msg).slice(0, 70)})`);
  check(changes.b?.status === "in_progress", `requesting changes returns it to the worker (status ${changes.b?.status})`);

  await call(workerTok, "task.submitForReview", { id: task.b.id, note: "QC numbers added" });
  const approve = await call(reviewerTok, "task.review", { id: task.b.id, decision: "approve" });
  check(approve.b?.status === "done", `the ${cfg.reviewer} approves and the task is done (status ${approve.b?.status})`);

  // --- document approval is no longer self-serve ----------------------------
  if (evidenceOk) {
    const docs = await read(reviewerTok, "documents.list", { projectId, taskId: task.b.id });
    const docId = (docs.b ?? [])[0]?.id;
    if (docId) {
      const selfApprove = await call(workerTok, "document.setApprovalStatus", { id: docId, status: "approved" });
      check(selfApprove.s === 403, `the uploader cannot approve their own document (${selfApprove.s})`);
      // Task review and document approval are deliberately different
      // authorities: an Accountant reviews the WORK, the Director approves the
      // document of record. document:approve sits at the supervisory tier
      // alongside document:delete, which is the admin in every domain.
      const realApprove = await call(admin, "document.setApprovalStatus", { id: docId, status: "approved" });
      check(realApprove.s === 200 || realApprove.s === 201, `someone holding document:approve can approve it (${realApprove.s} ${String(realApprove.msg).slice(0, 60)})`);
    }
  }

  // --- progress rolls up ----------------------------------------------------
  const dash = await read(admin, "analytics.dashboard", {});
  const widgets = Array.isArray(dash.b?.widgets) ? dash.b.widgets : [];
  const progress = widgets.find((w) => w.key === "projects.progress");
  const active = widgets.find((w) => w.key === "projects.activeCount");
  if (industry === "IT") {
    check(!!progress && Array.isArray(progress.rows) && progress.rows.length > 0, `project progress is reported (${JSON.stringify(progress?.rows ?? []).slice(0, 80)})`);
  } else {
    check(!active || active.value === 0, `no project widgets count domain plumbing (activeCount = ${active?.value ?? "absent"})`);
    check(!progress || (Array.isArray(progress.rows) && progress.rows.length === 0), `project progress shows no plumbing (${(progress?.rows ?? []).length} entries)`);
  }
}

await db.end();
console.log(`\n${"=".repeat(80)}`);
console.log(`${results.checks} checks run, ${results.failures.length} failure(s)`);
for (const f of results.failures) console.log(`  FAIL  ${f}`);
fs.writeFileSync("project-workflow-result.json", JSON.stringify(results, null, 2));
