import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
loadEnv({ path: "../../.env", quiet: true });

/**
 * Projects ecosystem review — the two claims worth checking rather than
 * asserting from code:
 *
 *   1. Do the project METRICS still count backing plumbing? Module review 1
 *      filtered the project-shaped *data sources*, but the metrics live in a
 *      separate file and call `projectsWhere` directly. `AnalyticsDashboard`
 *      auto-appends every widget a role may see, so a Healthcare admin holding
 *      `project:read` would get "Active Projects" counting patient charts.
 *
 *   2. Can the person who uploads a document also approve it?
 *      `document.setApprovalStatus` requires `document:update` — the same
 *      grant as editing — which would make the review step decorative.
 */
const API = "http://localhost:4000";
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const stamp = Date.now();
const PW = "Ecosystem!2026";

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

const db = new pg.Client({ connectionString: process.env.DIRECT_URL });
await db.connect();

async function makeWorkspace(industry) {
  const email = `eco-${industry.toLowerCase()}+${stamp}@example.com`;
  const su = await fetch(`${API}/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PW, companyName: `Eco ${industry} ${stamp}`, displayName: "EC Admin", industry }),
  });
  const t = await j(su);
  if (!t?.tenantId) return null;
  await db.query("update tenants set seats_purchased = 10 where id = $1", [t.tenantId]);
  const { data } = await sb.auth.signInWithPassword({ email, password: PW });
  return { tenantId: t.tenantId, tok: data.session.access_token };
}

// ---- claim 1: do project metrics count plumbing? ---------------------------
console.log("CLAIM 1 — do the project METRICS count backing plumbing?\n");
for (const [industry, setup] of [
  ["Healthcare", async (tok) => { await call(tok, "patient.register", { name: "R. Patel" }); await call(tok, "patient.register", { name: "J. Chen" }); }],
  ["Education", async (tok) => { await call(tok, "course.create", { name: "Algebra II" }); }],
]) {
  const ws = await makeWorkspace(industry);
  if (!ws) { console.log(`  ${industry}: signup failed`); continue; }
  await setup(ws.tok);

  const list = await read(ws.tok, "projects.list", {});
  const dash = await read(ws.tok, "analytics.dashboard", {});
  const widgets = Array.isArray(dash.b?.widgets) ? dash.b.widgets : [];
  const active = widgets.find((w) => w.key === "projects.activeCount");
  const atRisk = widgets.find((w) => w.key === "projects.atRisk");

  console.log(`  ${industry}`);
  console.log(`    projects.list (already fixed):      ${(list.b ?? []).length} row(s)`);
  console.log(`    projects.activeCount widget:        ${active ? `PRESENT, value = ${JSON.stringify(active.value)}` : "absent"}`);
  console.log(`    projects.atRisk widget:             ${atRisk ? `PRESENT, ${Array.isArray(atRisk.value) ? atRisk.value.length : "?"} entr(y/ies)` : "absent"}`);
  if (Array.isArray(atRisk?.value)) for (const e of atRisk.value.slice(0, 3)) console.log(`       -> ${JSON.stringify(e).slice(0, 90)}`);
  console.log("");
}

// ---- claim 2: can an uploader approve their own document? ------------------
console.log("\nCLAIM 2 — can the person who uploads a document approve it themselves?\n");
const it = await makeWorkspace("IT");
if (it) {
  const proj = await call(it.tok, "project.create", { name: "Billing rewrite", status: "active" });
  const body = "quarterly report\nline,value\na,1\n";
  const up = await call(it.tok, "document.createUploadUrl", {
    projectId: proj.b.id,
    fileName: `report-${stamp}.csv`,
    mimeType: "text/csv",
    sizeBytes: Buffer.byteLength(body),
  });
  if (up.b?.signedUrl) await fetch(up.b.signedUrl, { method: "PUT", headers: { "content-type": "text/csv" }, body });
  const doc = await call(it.tok, "document.create", {
    projectId: proj.b.id,
    storagePath: up.b?.path,
    name: `report-${stamp}.csv`,
    mimeType: "text/csv",
    sizeBytes: Buffer.byteLength(body),
  });
  const pending = await call(it.tok, "document.setApprovalStatus", { id: doc.b.id, status: "pending" });
  const approve = await call(it.tok, "document.setApprovalStatus", { id: doc.b.id, status: "approved" });
  console.log(`  the SAME user uploaded it, then set pending (${pending.s}) and approved (${approve.s})`);
  console.log(`  => self-approval is ${approve.s === 200 || approve.s === 201 ? "POSSIBLE — the review step is decorative" : "blocked"}`);

  // And is there any review state on a Task at all?
  const task = await call(it.tok, "task.create", { projectId: proj.b.id, title: "Do the thing" });
  const submit = await call(it.tok, "task.updateStatus", { id: task.b.id, status: "in_review" });
  console.log(`\n  task.updateStatus to "in_review": ${submit.s} — status is free text, so it is ${submit.s < 300 ? "ACCEPTED but means nothing to any other code" : "rejected"}`);
}

await db.end();
console.log("\n(throwaway workspaces named 'Eco *')");
