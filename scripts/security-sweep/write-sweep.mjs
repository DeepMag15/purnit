import fs from "node:fs";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { buildPayload, NO_EXECUTE } from "./tmp-payloads.mjs";
loadEnv({ path: "../../.env", quiet: true });

/**
 * Role-Based Workspaces, Stage E — the WRITE half of the verification sweep.
 *
 * The read sweep proved a role cannot *see* what it shouldn't. This proves it
 * cannot *do* what it shouldn't, for all 105 permission-gated mutations across
 * all 25 roles in all 5 domains.
 *
 * The one thing that makes this testable: `MutationsController` parses
 * `inputSchema` BEFORE calling `checkRequiredPermission`, so a call with an
 * empty body returns 400 (validation) and never reaches the gate. Every
 * mutation therefore needs a schema-valid payload just to reach the decision
 * under test — synthesised here from each schema's JSON Schema form.
 *
 * The assertion is exact rather than "did it fail": `checkRequiredPermission`
 * throws `ForbiddenException('Missing permission "x:y"')`, so a refusal counts
 * as a *gate* refusal only when the message says so. An inner scope check that
 * legitimately 403s with its own message is not the thing under test and must
 * not be allowed to look like a pass.
 */
const API = "http://localhost:4000";
const MAP = JSON.parse(fs.readFileSync("mutation-map.json", "utf8"));
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const PW = "StageE!2026";
const PW2 = "StageE!2026x";

const rawFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  let lastErr;
  for (let i = 0; i < 4; i++) {
    try {
      return await rawFetch(url, opts);
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw lastErr;
};
const H = (t) => ({ "content-type": "application/json", authorization: `Bearer ${t}` });

// ---- roles + expected permissions from the seeded blueprints ---------------
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

// Reuse the workspaces the read sweep just created — same users, same
// passwords — rather than standing up another 25 accounts.
const stampRow = await db.query(
  "select max(substring(name from 'StageE .* ([0-9]+)$')) s from tenants where name like 'StageE %'",
);
const STAMP = stampRow.rows[0].s;
if (!STAMP) {
  console.log("no StageE tenants found — run the read sweep first");
  process.exit(1);
}
// Everything the database is needed for has now been read. Closing here rather
// than at the end of the run: a 25-role sweep is ~30 minutes of HTTP during
// which this connection would sit idle, and Supabase drops idle connections —
// which killed the first attempt with ECONNRESET partway through Healthcare.
await db.end();
console.log(`reusing StageE workspaces from stamp ${STAMP}\n`);

const results = { checks: 0, failures: [], notExecuted: [] };
const check = (ok, label) => {
  results.checks++;
  if (!ok) results.failures.push(label);
};

/**
 * Rate limiting is 300/min per authenticated user (Go-Live Phase 04). A role's
 * ~105 calls run well inside that, but a 429 would register as "not refused"
 * and manufacture a false leak, so wait it out rather than trusting the margin.
 */
const call = async (tok, m, b) => {
  let r;
  for (let i = 0; i < 5; i++) {
    r = await fetch(`${API}/api/mutations/${m}`, { method: "POST", headers: H(tok), body: JSON.stringify(b) });
    if (r.status !== 429) break;
    await new Promise((res) => setTimeout(res, 12000));
  }
  let body;
  try {
    body = await r.json();
  } catch {
    body = null;
  }
  const msg =
    typeof body?.message === "string"
      ? body.message
      : Array.isArray(body?.message)
        ? JSON.stringify(body.message).slice(0, 120)
        : "";
  return { s: r.status, msg };
};
const isGateRefusal = (r) => r.s === 403 && r.msg.includes("Missing permission");

const GATED = Object.entries(MAP).filter(([, v]) => v.requiredPermission);
const payloads = Object.fromEntries(GATED.map(([n, v]) => [n, buildPayload(n, v.schema)]));

for (const [industry, def] of Object.entries(BP)) {
  console.log(`${"=".repeat(94)}\n${industry}\n${"=".repeat(94)}`);
  for (const role of def.roles) {
    const slug = role.id.replace("role.", "");
    const email = `stagee-${industry.toLowerCase()}-${slug}+${STAMP}@example.com`;
    const { data, error } = await sb.auth.signInWithPassword({
      email,
      password: role.id === "role.admin" ? PW : PW2,
    });
    if (error) {
      console.log(`  !! sign-in ${role.id}: ${error.message}`);
      continue;
    }
    const tok = data.session.access_token;
    const perms = new Set(resolvePerms(def.roles, role.id).map((x) => x.split(":").slice(0, 2).join(":")));

    const wrongAllow = [];
    const wrongDeny = [];
    const inconclusive = [];
    let notRun = 0;
    for (const [name, v] of GATED) {
      const held = perms.has(v.requiredPermission);
      if (held && NO_EXECUTE.has(name)) {
        notRun++;
        continue;
      }
      const r = await call(tok, name, payloads[name]);
      if (!held && !isGateRefusal(r)) {
        // A 400 means the payload was rejected by `inputSchema.parse`, which
        // runs BEFORE the gate — so the gate was never reached and this call
        // tested nothing. Counted apart from a leak: reporting "not refused"
        // here would be the sweep lying about its own coverage.
        if (r.s === 400) inconclusive.push(`${name} [${v.requiredPermission}] ${r.msg.slice(0, 70)}`);
        else wrongAllow.push(`${name} needs ${v.requiredPermission} got ${r.s} ${r.msg.slice(0, 50)}`);
      }
      if (held && isGateRefusal(r)) {
        wrongDeny.push(`${name} holds ${v.requiredPermission} but was refused`);
      }
    }
    check(wrongAllow.length === 0, `${industry}/${role.id}: NOT REFUSED without the permission — ${wrongAllow.join(" | ")}`);
    check(wrongDeny.length === 0, `${industry}/${role.id}: refused despite holding the permission — ${wrongDeny.join(" | ")}`);
    check(inconclusive.length === 0, `${industry}/${role.id}: payload never reached the gate (untested) — ${inconclusive.join(" | ")}`);
    if (notRun) results.notExecuted.push(`${industry}/${role.id}: ${notRun} side-effecting mutation(s) not executed on the authorised path`);

    console.log(
      `  ${role.label.padEnd(24)} perms ${String(perms.size).padStart(3)}  |  ` +
        `refused-without: ${wrongAllow.length === 0 ? "all" : `${wrongAllow.length} LEAK`}  |  ` +
        `allowed-with: ${wrongDeny.length === 0 ? "all" : `${wrongDeny.length} BLOCKED`}  |  ` +
        `untested: ${inconclusive.length}  |  not executed: ${notRun}`,
    );
  }
  console.log("");
}

console.log("=".repeat(94));
console.log(`${results.checks} checks run, ${results.failures.length} failure(s)`);
for (const f of results.failures) console.log(`  FAIL  ${f}`);
fs.writeFileSync("write-sweep-result.json", JSON.stringify(results, null, 2));
