import fs from "node:fs";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
loadEnv({ path: "../../.env", quiet: true });

/**
 * Module review, Projects — the regression check.
 *
 * Excluding backing projects from `projects.list` and `project.detail` is only
 * correct if everything that legitimately depends on those projects keeps
 * working. Three things do, and each would fail silently rather than loudly:
 *
 *   - Task creation, which needs a real `projectId` and now gets it from the
 *     domain entity (Patient / Course / Client / Item) instead of a dropdown
 *     reading "Chart: J. Chen".
 *   - Documents on a backing project — the whole reason the pattern exists.
 *   - `project.members`, which replaced `project.detail` for @-mention
 *     candidates and assignee pickers precisely because detail now excludes
 *     backing projects.
 */
const API = "http://localhost:4000";
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const stamp = Date.now();
const PW = "Workflow!2026";

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

/** industry -> { setup(tok) -> {label, source, field}, } */
const DOMAINS = {
  Healthcare: {
    target: { source: "patients.list", field: "chartProjectId", label: "Patient" },
    async setup(tok) {
      await call(tok, "patient.register", { name: "R. Patel" });
    },
  },
  Education: {
    target: { source: "courses.list", field: "materialsProjectId", label: "Course" },
    async setup(tok) {
      await call(tok, "course.create", { name: "Algebra II" });
    },
  },
  Finance: {
    target: { source: "clients.list", field: "filesProjectId", label: "Client" },
    async setup(tok) {
      await call(tok, "client.create", { name: "Northwind Ltd" });
    },
  },
};

for (const [industry, cfg] of Object.entries(DOMAINS)) {
  console.log(`\n${industry}`);
  const email = `wf-${industry.toLowerCase()}+${stamp}@example.com`;
  const su = await fetch(`${API}/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PW, companyName: `Workflow ${industry} ${stamp}`, displayName: "WF Admin", industry }),
  });
  const tenant = await j(su);
  if (!tenant?.tenantId) {
    check(false, `${industry}: signup failed`);
    continue;
  }
  await db.query("update tenants set seats_purchased = 10 where id = $1", [tenant.tenantId]);
  const { data } = await sb.auth.signInWithPassword({ email, password: PW });
  const tok = data.session.access_token;

  await cfg.setup(tok);

  // 1. The picker's own source now supplies both the label and the projectId.
  const targets = await read(tok, cfg.target.source, {});
  const row = (Array.isArray(targets.b) ? targets.b : [])[0];
  const projectId = row?.[cfg.target.field];
  check(!!projectId, `${cfg.target.label} list supplies a backing projectId (${cfg.target.source}.${cfg.target.field})`);
  check(!/^(Chart|Materials|Files|Submissions|Student file):/.test(String(row?.name ?? "")), `the ${cfg.target.label} shows its own name, not a plumbing label (got "${row?.name}")`);

  // 2. A task actually attaches to it.
  const task = await call(tok, "task.create", { projectId, title: `Follow-up ${stamp}` });
  check(task.s === 200 || task.s === 201, `task.create attaches to the ${cfg.target.label}'s project (${task.s} ${String(task.msg).slice(0, 70)})`);
  const list = await read(tok, "tasks.list", {});
  check((Array.isArray(list.b) ? list.b : []).some((t) => t.id === task.b?.id), "the new task appears in tasks.list");

  // 3. The Tasks page is reachable in this domain.
  const page = await fetch(`${API}/api/workspace/pages/page.tasks`, { headers: H(tok) });
  check(page.status === 200, `page.tasks is reachable (${page.status})`);

  // 4. Documents on the backing project still work — the whole point of it.
  const docs = await read(tok, "documents.list", { projectId });
  check(docs.s === 200, `documents.list still works on the backing project (${docs.s})`);

  // 5. project.members works where project.detail no longer does.
  const members = await read(tok, "project.members", { projectId });
  check(members.s === 200, `project.members resolves on a backing project (${members.s})`);
  const detail = await read(tok, "project.detail", { id: projectId });
  check(detail.s === 404, `project.detail REFUSES a backing project — no IT project UI over domain data (${detail.s})`);

  // 6. And the leak itself.
  const projects = await read(tok, "projects.list", {});
  check((Array.isArray(projects.b) ? projects.b : []).length === 0, `projects.list shows no plumbing (${(projects.b ?? []).length} rows)`);
}

// IT must be entirely unchanged.
console.log("\nIT (must be unchanged)");
const itEmail = `wf-it+${stamp}@example.com`;
const itSu = await fetch(`${API}/auth/signup`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: itEmail, password: PW, companyName: `Workflow IT ${stamp}`, displayName: "WF Admin", industry: "IT" }),
});
const itTenant = await j(itSu);
await db.query("update tenants set seats_purchased = 10 where id = $1", [itTenant.tenantId]);
const { data: itData } = await sb.auth.signInWithPassword({ email: itEmail, password: PW });
const itTok = itData.session.access_token;

const proj = await call(itTok, "project.create", { name: "Billing rewrite", status: "active" });
check(proj.s === 200 || proj.s === 201, `an IT admin can still create a project (${proj.s})`);
const itList = await read(itTok, "projects.list", {});
check((Array.isArray(itList.b) ? itList.b : []).length === 1, `projects.list still returns it (${(itList.b ?? []).length} row)`);
const itDetail = await read(itTok, "project.detail", { id: proj.b?.id });
check(itDetail.s === 200, `project.detail still works for a real project (${itDetail.s})`);
const itTask = await call(itTok, "task.create", { projectId: proj.b?.id, title: "Ship it" });
check(itTask.s === 200 || itTask.s === 201, `task.create still works in IT (${itTask.s})`);

await db.end();
console.log(`\n${"=".repeat(80)}`);
console.log(`${results.checks} checks run, ${results.failures.length} failure(s)`);
for (const f of results.failures) console.log(`  FAIL  ${f}`);
fs.writeFileSync("tasks-workflow-result.json", JSON.stringify(results, null, 2));
