import fs from "node:fs";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
loadEnv({ path: "../../.env", quiet: true });

/**
 * The Healthcare document boundary.
 *
 * Contextual Reporting granted the Receptionist `project:read:tenant` +
 * `document:create:tenant` so they could file front-desk paperwork — and at
 * the time `project:read:tenant` returned EVERY project in the workspace.
 * Patient charts are Projects. That handed a Receptionist every clinical
 * document in the hospital.
 *
 * Charts are now restricted with `accessPermission: "patient:update"`, the
 * clinical floor: Doctor, Nurse and Hospital Administrator hold it, a
 * Receptionist does not. This proves that live, with real users and real files.
 */
const API = "http://localhost:4000";
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const stamp = Date.now();
const PW = "Clinic!2026";
const PW2 = "Clinic!2026x";

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

const adminEmail = `clinic-admin+${stamp}@example.com`;
const su = await fetch(`${API}/auth/signup`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: adminEmail, password: PW, companyName: `Clinic ${stamp}`, displayName: "CL Admin", industry: "Healthcare" }),
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
console.log(`workspace Clinic ${stamp}\n`);

console.log("setting up a clinic:");
const dept = await call(admin, "department.create", { name: "Clinical", type: "general" });
const roleRows = (await read(admin, "roles.list")).b ?? [];
const roleId = (label) => roleRows.find((r) => r.label === label)?.id;

async function makeUser(label, roleLabel, slug) {
  const email = `${slug}+${stamp}@example.com`;
  const inv = await call(admin, "user.invite", { email, displayName: label, roleId: roleId(roleLabel), departmentId: dept.b?.id });
  if (!inv.b?.temporaryPassword) {
    console.log(`  !! invite ${roleLabel}: ${inv.s} ${String(inv.msg).slice(0, 90)}`);
    return null;
  }
  const { data: s1 } = await sb.auth.signInWithPassword({ email, password: inv.b.temporaryPassword });
  await sb.auth.updateUser({ password: PW2 });
  await fetch(`${API}/auth/complete-first-login`, { method: "POST", headers: H(s1.session.access_token) });
  const { data: s2 } = await sb.auth.signInWithPassword({ email, password: PW2 });
  return s2.session.access_token;
}

const doctorTok = await makeUser("CL Doctor", "Doctor", "cl-doctor");
const nurseTok = await makeUser("CL Nurse", "Nurse", "cl-nurse");
const receptionTok = await makeUser("CL Reception", "Receptionist", "cl-reception");
check(!!doctorTok && !!nurseTok && !!receptionTok, "Doctor, Nurse and Receptionist logins created");

const doctorUserId = (await db.query("select id from users where tenant_id=$1 and display_name='CL Doctor'", [tenant.tenantId])).rows[0]?.id;
const patient = await call(admin, "patient.register", { name: "R. Patel", assignedDoctorId: doctorUserId });
check(!!patient.b?.chartProjectId, `patient registered with a chart project (${patient.s})`);

// A real clinical document on the chart.
const labs = ["test,value,reference,flag", "HbA1c,8.9,<7.0,HIGH", "eGFR,52,>60,LOW", "LDL,3.9,<3.0,HIGH"].join("\n");
const up = await call(admin, "document.createUploadUrl", {
  projectId: patient.b.chartProjectId,
  fileName: `labs-${stamp}.csv`,
  mimeType: "text/csv",
  sizeBytes: Buffer.byteLength(labs),
});
if (up.b?.signedUrl) await fetch(up.b.signedUrl, { method: "PUT", headers: { "content-type": "text/csv" }, body: labs });
const chartDoc = await call(admin, "document.create", {
  projectId: patient.b.chartProjectId,
  storagePath: up.b?.path,
  name: `labs-${stamp}.csv`,
  mimeType: "text/csv",
  sizeBytes: Buffer.byteLength(labs),
});
check(!!chartDoc.b?.id, `a clinical lab result filed on the chart (${chartDoc.s} ${String(chartDoc.msg).slice(0, 60)})`);

console.log("\nwho can reach the clinical file:");
const doctorRead = await read(doctorTok, "documents.list", { projectId: patient.b.chartProjectId });
check(doctorRead.s === 200, `the assigned Doctor can (${doctorRead.s})`);

const nurseRead = await read(nurseTok, "documents.list", { projectId: patient.b.chartProjectId });
check(nurseRead.s === 200, `a Nurse can — via patient:update, without being named on the chart (${nurseRead.s})`);

const receptionRead = await read(receptionTok, "documents.list", { projectId: patient.b.chartProjectId });
check(receptionRead.s === 403, `a Receptionist canNOT, despite holding project:read:tenant (${receptionRead.s})`);

// The file itself, not just the listing — a signed URL is the real payload.
const receptionUrl = await call(receptionTok, "document.getFileUrl", { id: chartDoc.b.id, mode: "view" });
check(receptionUrl.s === 403 || receptionUrl.s === 404, `nor can they mint a signed URL for the file (${receptionUrl.s})`);

const receptionAnalyze = await call(receptionTok, "document.analyze", { documentId: chartDoc.b.id });
check(receptionAnalyze.s === 403 || receptionAnalyze.s === 404, `nor analyse it (${receptionAnalyze.s})`);

console.log("\nand the lenses still differ for those who can:");
const doctorLens = await read(doctorTok, "document.analyses", { documentId: chartDoc.b.id });
const nurseLens = await read(nurseTok, "document.analyses", { documentId: chartDoc.b.id });
check(doctorLens.b?.availableLens?.key === "patient.clinical", `Doctor gets the clinical lens (got ${doctorLens.b?.availableLens?.key})`);
check(nurseLens.b?.availableLens?.key === "patient.careDelivery", `Nurse gets care-delivery notes, not a clinical reading (got ${nurseLens.b?.availableLens?.key})`);

const run = await call(doctorTok, "document.analyze", { documentId: chartDoc.b.id });
check(run.s === 200 || run.s === 201, `the Doctor's clinical analysis runs (${run.s} ${String(run.msg).slice(0, 100)})`);
if (run.b?.id) {
  const a = (await read(doctorTok, "document.analyses", { documentId: chartDoc.b.id })).b?.analyses?.[0];
  console.log(`\n  clinical summary: ${String(a?.summary ?? "").slice(0, 240)}`);
  for (const f of (a?.findings ?? []).slice(0, 2)) console.log(`  - [${f.severity}] ${f.label}: ${String(f.detail).slice(0, 100)}`);
}

await db.end();
console.log(`\n${"=".repeat(80)}`);
console.log(`${results.checks} checks run, ${results.failures.length} failure(s)`);
for (const f of results.failures) console.log(`  FAIL  ${f}`);
fs.writeFileSync("healthcare-boundary-result.json", JSON.stringify({ ...results, tenantName: `Clinic ${stamp}` }, null, 2));
