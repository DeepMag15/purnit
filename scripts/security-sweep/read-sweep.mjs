import fs from "node:fs";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
loadEnv({ path: "../../.env", quiet: true });

/**
 * Role-Based Workspaces, Stage E — the full verification sweep.
 *
 * For every role in every domain, against the RUNNING API with real users:
 *   1. the navigation the API delivers matches what pruning should produce
 *   2. every page NOT in that role's nav is refused by direct URL (404)
 *   3. every page that IS in their nav is reachable (200)
 *   4. sensitive data sources are refused by direct API call
 *
 * Point 2 is the one that matters: hiding a nav item is presentation, and
 * this is what proves the server refuses regardless.
 */
const API = "http://localhost:4000";
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };

/** The dev server restarts on file changes, which resets in-flight
 * connections. Retry transient network failures so a 25-role sweep isn't
 * abandoned halfway through. */
const rawFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  let lastErr;
  for (let i = 0; i < 4; i++) {
    try { return await rawFetch(url, opts); } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 1500)); }
  }
  throw lastErr;
};
const H = (t) => ({ "content-type": "application/json", authorization: `Bearer ${t}` });
const stamp = Date.now();
const PW = "StageE!2026", PW2 = "StageE!2026x";

// ---- expected navigation, computed from the seeded blueprints -------------
const db = new pg.Client({ connectionString: process.env.DIRECT_URL });
await db.connect();
const bpRows = await db.query(`select industry, definition from blueprints order by industry`);
const BP = Object.fromEntries(bpRows.rows.map((r) => [r.industry, r.definition]));

function resolvePerms(roles, id, seen = new Set()) {
  const r = roles.find((x) => x.id === id);
  if (!r || seen.has(id)) return [];
  seen.add(id);
  const out = new Set(r.extends ? resolvePerms(roles, r.extends, new Set(seen)) : []);
  for (const p of r.permissions ?? []) {
    if (p.startsWith("+")) out.add(p.slice(1));
    else if (p.startsWith("-")) out.delete(p.slice(1));
    else out.add(p);
  }
  return [...out];
}
function prune(items, perms) {
  const out = [];
  for (const it of items ?? []) {
    if (it.requiredPermission && !perms.has(it.requiredPermission)) continue;
    if (it.children) {
      const kids = prune(it.children, perms);
      if (!it.pageId && kids.length === 0) continue;
      out.push({ ...it, children: kids });
    } else out.push(it);
  }
  return out;
}
const pageIds = (items, acc = []) => { for (const i of items ?? []) { if (i.pageId) acc.push(i.pageId); if (i.children) pageIds(i.children, acc); } return acc; };

// Sensitive data sources that must be refused when the role lacks the grant.
// `*.capabilities` sources are deliberately absent: they return only booleans
// about the CALLER'S OWN grants, so gating one on the grant it reports would
// be circular. Verified across all 37 ungated sources — each is a capability
// probe, ownership-scoped, tenant reference data, or scope-checked in-resolver.
const GUARDED = [
  ["analytics.dashboard", "analytics:read"],
  ["auditLogs.list", "audit:read"],
  ["roles.listDetailed", "role:manage"],
  ["billing.capabilities", "billing:manage"],
  ["tasks.list", "task:read"],
  ["users.list", "user:manage"],
];

const call = async (tok, m, b) => { const r = await fetch(`${API}/api/mutations/${m}`, { method: "POST", headers: H(tok), body: JSON.stringify(b) }); const x = await j(r); return { s: r.status, b: (x && typeof x === "object" && "data" in x) ? x.data : x }; };
const read = async (tok, s, b = {}) => { const r = await fetch(`${API}/api/data/${s}`, { method: "POST", headers: H(tok), body: JSON.stringify(b) }); const x = await j(r); return { s: r.status, b: (x && typeof x === "object" && "data" in x) ? x.data : x }; };

const results = { checks: 0, failures: [] };
const check = (ok, label) => { results.checks++; if (!ok) results.failures.push(label); };

for (const [industry, def] of Object.entries(BP)) {
  const allPages = Object.keys(def.pages ?? {});
  console.log(`\n${"=".repeat(92)}\n${industry}\n${"=".repeat(92)}`);

  // --- a throwaway workspace, with enough seats for every role -------------
  const adminEmail = `stagee-${industry.toLowerCase()}-admin+${stamp}@example.com`;
  const su = await fetch(`${API}/auth/signup`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: adminEmail, password: PW, companyName: `StageE ${industry} ${stamp}`, displayName: "SE Admin", industry }) });
  const tenant = await j(su);
  if (!tenant.tenantId) { console.log(`  !! signup failed: ${JSON.stringify(tenant).slice(0, 120)}`); continue; }
  await db.query(`update tenants set seats_purchased = 30, subscription_status='pending_payment',
    plan_id=(select id from plans where key='professional') where id = $1`, [tenant.tenantId]);

  const { data: aS } = await sb.auth.signInWithPassword({ email: adminEmail, password: PW });
  const adminTok = aS.session.access_token;
  const dept = await call(adminTok, "department.create", { name: "Ops", type: "engineering" });
  const departmentId = dept.b?.id;
  const roleRows = (await read(adminTok, "roles.list")).b ?? [];

  // --- one real user per non-admin role ------------------------------------
  const people = [{ roleId: "role.admin", label: "Company Admin", token: adminTok }];
  for (const role of def.roles) {
    if (role.id === "role.admin") continue;
    const rid = roleRows.find((r) => r.label === role.label)?.id;
    if (!rid) { console.log(`  !! no materialized role for ${role.id}`); continue; }
    const email = `stagee-${industry.toLowerCase()}-${role.id.replace("role.", "")}+${stamp}@example.com`;
    const inv = await call(adminTok, "user.invite", { email, displayName: `SE ${role.label}`, roleId: rid, departmentId });
    const temp = inv.b?.temporaryPassword;
    if (!temp) { console.log(`  !! invite ${role.id}: ${inv.s} ${JSON.stringify(inv.b).slice(0, 90)}`); continue; }
    const { data: s1, error: e1 } = await sb.auth.signInWithPassword({ email, password: temp });
    if (e1) { console.log(`  !! sign-in ${role.id}: ${e1.message}`); continue; }
    await sb.auth.updateUser({ password: PW2 });
    await fetch(`${API}/auth/complete-first-login`, { method: "POST", headers: H(s1.session.access_token) });
    const { data: s2 } = await sb.auth.signInWithPassword({ email, password: PW2 });
    people.push({ roleId: role.id, label: role.label, token: s2.session.access_token });
  }

  // --- verify each role -----------------------------------------------------
  for (const p of people) {
    const perms = new Set(resolvePerms(def.roles, p.roleId).map((x) => x.split(":").slice(0, 2).join(":")));
    const expected = pageIds(prune(def.navigation, perms));

    const boot = await j(await fetch(`${API}/api/workspace/bootstrap`, { headers: H(p.token) }));
    const actual = pageIds(boot.navigation);

    const navMatches = JSON.stringify(actual) === JSON.stringify(expected);
    check(navMatches, `${industry}/${p.roleId}: nav mismatch — expected [${expected}] got [${actual}]`);

    // Every page NOT in their nav must be refused by direct URL.
    const withheld = allPages.filter((pg) => !actual.includes(pg));
    let leaked = [];
    for (const pg of withheld) {
      const r = await fetch(`${API}/api/workspace/pages/${pg}`, { headers: H(p.token) });
      if (r.status !== 404) leaked.push(`${pg}=${r.status}`);
    }
    check(leaked.length === 0, `${industry}/${p.roleId}: withheld pages REACHABLE via direct URL — ${leaked.join(", ")}`);

    // Every page IN their nav must actually load.
    let broken = [];
    for (const pg of actual) {
      const r = await fetch(`${API}/api/workspace/pages/${pg}`, { headers: H(p.token) });
      if (r.status !== 200) broken.push(`${pg}=${r.status}`);
    }
    check(broken.length === 0, `${industry}/${p.roleId}: permitted pages NOT loading — ${broken.join(", ")}`);

    // Guarded data sources: refused unless the role holds the grant.
    let dsLeaked = [];
    for (const [src, perm] of GUARDED) {
      const r = await read(p.token, src, {});
      const allowed = perms.has(perm);
      if (!allowed && r.s === 200) dsLeaked.push(`${src} (needs ${perm})`);
    }
    check(dsLeaked.length === 0, `${industry}/${p.roleId}: data sources REACHABLE without the grant — ${dsLeaked.join(", ")}`);

    console.log(
      `  ${p.label.padEnd(24)} nav ${String(actual.length).padStart(2)}  ${navMatches ? "match" : "MISMATCH"}  |  ` +
        `withheld ${String(withheld.length).padStart(2)} all 404: ${leaked.length === 0 ? "yes" : "NO"}  |  ` +
        `permitted all 200: ${broken.length === 0 ? "yes" : "NO"}  |  guarded sources blocked: ${dsLeaked.length === 0 ? "yes" : "NO"}`,
    );
  }
}

await db.end();
console.log(`\n${"=".repeat(92)}`);
console.log(`${results.checks} checks run, ${results.failures.length} failure(s)`);
for (const f of results.failures) console.log(`  FAIL  ${f}`);
fs.writeFileSync("read-sweep-result.json", JSON.stringify(results, null, 2));
