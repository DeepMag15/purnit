import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
loadEnv({ path: "../../.env", quiet: true });

/**
 * Module review, Projects — what `projects.list` actually returns in each
 * domain, and what that means for the surfaces that consume it.
 *
 * Read-only apart from creating a throwaway workspace per domain. The question
 * is not "is this permitted" (Stage E settled that) but "is this the right
 * thing to show a person in this domain at all".
 */
const API = "http://localhost:4000";
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const stamp = Date.now();
const PW = "Audit!2026";

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

const db = new pg.Client({ connectionString: process.env.DIRECT_URL });
await db.connect();

/** Domain -> the entity that creates a backing project, and how. */
const SETUP = {
  Healthcare: async (tok) => {
    await call(tok, "patient.register", { name: "R. Patel" });
    await call(tok, "patient.register", { name: "J. Chen" });
  },
  Education: async (tok) => {
    await call(tok, "course.create", { name: "Algebra II" });
    await call(tok, "student.register", { name: "Ada Lovelace" });
  },
  Finance: async (tok) => {
    await call(tok, "client.create", { name: "Northwind Ltd" });
  },
  Manufacturing: async (tok) => {
    await call(tok, "inventoryItem.create", { name: "M6 Bolt", sku: `SKU-${stamp}`, unit: "each", reorderPoint: 10 });
  },
  IT: async (tok) => {
    await call(tok, "project.create", { name: "Billing rewrite", status: "active" });
  },
};

console.log("What `projects.list` returns to a domain admin, per domain:\n");
for (const [industry, setup] of Object.entries(SETUP)) {
  const email = `audit-${industry.toLowerCase()}+${stamp}@example.com`;
  const su = await fetch(`${API}/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PW, companyName: `Audit ${industry} ${stamp}`, displayName: "AU Admin", industry }),
  });
  const tenant = await j(su);
  if (!tenant?.tenantId) {
    console.log(`${industry}: signup failed`);
    continue;
  }
  await db.query("update tenants set seats_purchased = 10 where id = $1", [tenant.tenantId]);
  const { data } = await sb.auth.signInWithPassword({ email, password: PW });
  const tok = data.session.access_token;

  await setup(tok);
  const list = await read(tok, "projects.list", {});
  const rows = Array.isArray(list.b) ? list.b : [];

  // Does the blueprint even expose a Projects page to this role?
  const boot = await j(await fetch(`${API}/api/workspace/bootstrap`, { headers: H(tok) }));
  const navIds = [];
  (function walk(items) {
    for (const i of items ?? []) {
      if (i.pageId) navIds.push(i.pageId);
      if (i.children) walk(i.children);
    }
  })(boot.navigation);
  const hasProjectsNav = navIds.includes("page.projects");
  const pageStatus = (await fetch(`${API}/api/workspace/pages/page.projects`, { headers: H(tok) })).status;

  console.log(`${industry}`);
  console.log(`  nav has Projects: ${hasProjectsNav ? "yes" : "NO"}   page.projects by direct URL: ${pageStatus}`);
  console.log(`  projects.list -> ${list.s}, ${rows.length} row(s):`);
  for (const p of rows) console.log(`     "${p.name}"`);
  console.log("");
}

await db.end();
console.log("(throwaway workspaces named 'Audit *' — tear down with teardown.mjs 'Audit %')");
