import fs from "node:fs";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { signupWithRetry } from "./signup-retry.mjs";
loadEnv({ path: "../../.env", quiet: true });

/**
 * Documents module review — the findings probe.
 *
 * Reads nothing on trust. Every claim in the findings report is produced by
 * this script against a running system, because the last two modules both
 * turned up a "fix" that was already correct and a test that passed for the
 * wrong reason.
 *
 * The central question: the restricted-project boundary (2026-08-26) is
 * enforced in `projectsWhere`, and every document READ goes through it. Every
 * document WRITE goes through `isRowInScope` on the project row instead, which
 * has never heard of `restricted`. If that is right, a person can rename,
 * replace, delete and plant files in a project they cannot open.
 *
 * Prereq: API on :4000.
 */
const API = "http://localhost:4000";
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const stamp = Date.now();
const PW = "DocAudit!2026";
const PW2 = "DocAudit!2026x";

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
/** Section 2 records what an UNREACHABLE project answers, so section 3's V1
 * can hold it against what a non-existent one answers. */
let hiddenStatus = null;
const note = (label, detail) => { console.log(`  ${label}`); if (detail) console.log(`        ${detail}`); };
const finding = (id, verdict, label) => {
  findings.push({ id, verdict, label });
  console.log(`  ${verdict === "BUG" ? "!! " : "ok "} ${id}  ${label}`);
};

const db = new pg.Client({ connectionString: process.env.DIRECT_URL });
await db.connect();

let tenantSeq = 0;
async function makeTenant(industry, name) {
  // Unique per call, not per industry — section 1 and section 2 both make an
  // Education tenant, and a reused address silently fails signup.
  const email = `doc-${industry.toLowerCase()}-${tenantSeq++}+${stamp}@example.com`;
  const t = await signupWithRetry(API, { email, password: PW, companyName: `${name} ${stamp}`, displayName: "DA Admin", industry });
  if (!t?.tenantId) throw new Error(`${industry} signup failed`);
  // A trial tenant is capped at its plan's maxSeats (3), not seats_purchased —
  // seats_purchased only governs once a subscription exists. Give it one so
  // the probe can create the four people it needs.
  await db.query(
    "update tenants set seats_purchased = 25, stripe_subscription_id = $2, subscription_status = 'active' where id = $1",
    [t.tenantId, `sub_probe_${stamp}_${tenantSeq}`],
  );
  const { data } = await sb.auth.signInWithPassword({ email, password: PW });
  return { tenantId: t.tenantId, admin: data.session.access_token };
}

async function makeUser(ctx, label, roleLabel, slug, departmentId) {
  const email = `doc-${slug}+${stamp}@example.com`;
  const inv = await call(ctx.admin, "user.invite", { email, displayName: label, roleId: ctx.roleId(roleLabel), departmentId });
  if (!inv.b?.temporaryPassword) { console.log(`     !! invite ${roleLabel}: ${inv.s} ${JSON.stringify(inv.msg ?? inv.b).slice(0, 160)}`); return null; }
  const { data: s1 } = await sb.auth.signInWithPassword({ email, password: inv.b.temporaryPassword });
  await sb.auth.updateUser({ password: PW2 });
  await fetch(`${API}/auth/complete-first-login`, { method: "POST", headers: H(s1.session.access_token) });
  const { data: s2 } = await sb.auth.signInWithPassword({ email, password: PW2 });
  return { email, token: s2.session.access_token };
}

const TXT = "submission body\n";
async function upload(tok, projectId, fileName, extra = {}) {
  const up = await call(tok, "document.createUploadUrl", { projectId, fileName, mimeType: "text/plain", sizeBytes: Buffer.byteLength(TXT) });
  if (!up.b?.signedUrl) return { ok: false, stage: "createUploadUrl", s: up.s, msg: up.msg };
  await fetch(up.b.signedUrl, { method: "PUT", headers: { "content-type": "text/plain" }, body: TXT });
  const doc = await call(tok, "document.create", { projectId, storagePath: up.b.path, name: fileName, mimeType: "text/plain", sizeBytes: Buffer.byteLength(TXT), ...extra });
  return { ok: !!doc.b?.id, stage: "create", s: doc.s, msg: doc.msg, id: doc.b?.id };
}

// ===========================================================================
// 1. Who holds what — the grant map that decides whether the bypass matters
// ===========================================================================
console.log("\n=== 1. document:* grants vs the restricted projects' accessPermission ===");
for (const [industry, gate] of [["Healthcare", "patient:update"], ["Education", "student:update"]]) {
  const ctx = await makeTenant(industry, `DocAudit ${industry}`);
  // roles.permissions is a materialized string[] of "resource:action:scope"
  // (the extends-chain is already resolved into it at provisioning time).
  const { rows: raw } = await db.query("select label, permissions from roles where tenant_id = $1 order by label", [ctx.tenantId]);
  const rows = raw.map((r) => {
    const perms = Array.isArray(r.permissions) ? r.permissions : [];
    return {
      label: r.label,
      doc_grants: perms.filter((g) => g.startsWith("document:")),
      holds_gate: perms.some((g) => g.startsWith(gate + ":")),
    };
  });
  console.log(`\n  ${industry}  (restricted-chart/file gate = ${gate})`);
  for (const r of rows) {
    if (!r.doc_grants || r.doc_grants.length === 0) continue;
    const writes = r.doc_grants.filter((g) => /^document:(update|delete|create|approve)/.test(g));
    if (writes.length === 0) continue;
    const flag = r.holds_gate ? "     " : "  <-- ";
    console.log(`   ${flag}${r.label.padEnd(24)} ${writes.join(", ")}${r.holds_gate ? "" : "   (does NOT hold " + gate + ")"}`);
  }
  ctx.industry = industry;
}

// ===========================================================================
// 2. The write bypass, Education: a student's submissions
// ===========================================================================
console.log("\n=== 2. Education — the restricted write boundary ===");
{
  const ctx = await makeTenant("Education", "DocAudit Edu2");
  const roleRows = (await read(ctx.admin, "roles.list")).b ?? [];
  ctx.roleId = (l) => roleRows.find((r) => r.label === l)?.id;

  const eduDept = await call(ctx.admin, "department.create", { name: "Faculty", type: "general" });
  const D = eduDept.b?.id;
  const teacherA = await makeUser(ctx, "DA TeacherA", "Teacher", "teacher-a", D);
  const teacherB = await makeUser(ctx, "DA TeacherB", "Teacher", "teacher-b", D);
  const registrar = await makeUser(ctx, "DA Registrar", "Registrar", "registrar", D);
  const studentUser = await makeUser(ctx, "DA Student", "Student", "student", D);

  const teacherAId = (await db.query("select id from users where tenant_id=$1 and display_name='DA TeacherA'", [ctx.tenantId])).rows[0]?.id;
  const studentUserId = (await db.query("select id from users where tenant_id=$1 and display_name='DA Student'", [ctx.tenantId])).rows[0]?.id;

  const course = await call(ctx.admin, "course.create", { name: "Algebra II", teacherId: teacherAId });
  const student = await call(ctx.admin, "student.register", { name: "R. Patel" });
  const link = await call(ctx.admin, "student.linkLogin", { studentId: student.b?.id, userId: studentUserId });
  const enrol = await call(ctx.admin, "enrollment.enroll", { studentId: student.b?.id, courseId: course.b?.id });
  note(`link login ${link.s} ${String(link.msg).slice(0, 60)}`);
  const subProject = enrol.b?.submissionsProjectId;
  note(`course ${course.s}, student ${student.s}, enrollment ${enrol.s}, submissions project ${subProject ? "created" : "MISSING"}`);
  if (!subProject) { console.log("  cannot continue Education probe"); }
  else {
    // The student puts real work there (the only actor who legitimately can).
    const own = await upload(studentUser.token, subProject, `essay-${stamp}.txt`);
    finding("E0", own.ok ? "ok" : "BUG", `the student can upload to their own submissions (${own.stage} ${own.s} ${String(own.msg).slice(0, 60)})`);
    const docId = own.id;

    // --- reads: the boundary that was fixed on 2026-08-26 -------------------
    const listB = await read(teacherB.token, "documents.list", { projectId: subProject });
    hiddenStatus = listB.s;
    finding("E1", listB.s === 404 ? "ok" : "BUG", `another teacher CANNOT list the submissions (${listB.s})`);
    if (docId) {
      const urlB = await call(teacherB.token, "document.getFileUrl", { id: docId, mode: "download" });
      finding("E2", urlB.s === 404 ? "ok" : "BUG", `another teacher CANNOT download the file (${urlB.s})`);
      const detailB = await read(teacherB.token, "document.detail", { id: docId });
      finding("E3", detailB.s === 404 ? "ok" : "BUG", `another teacher CANNOT open the document (${detailB.s})`);

      // --- writes: the same boundary, or not ------------------------------
      const renameB = await call(teacherB.token, "document.update", { id: docId, name: `tampered-${stamp}.txt` });
      finding("E4", renameB.s === 404 ? "ok" : "BUG", `another teacher CANNOT rename it (${renameB.s} ${String(renameB.msg).slice(0, 50)})`);

      const replaceB = await call(teacherB.token, "document.createReplaceUploadUrl", { id: docId, fileName: "x.txt", mimeType: "text/plain", sizeBytes: 5 });
      finding("E5", replaceB.s === 404 ? "ok" : "BUG", `another teacher CANNOT mint a REPLACE upload URL (${replaceB.s})`);

      const delAdmin = await call(ctx.admin, "document.delete", { id: docId });
      finding("E6", delAdmin.s === 404 ? "ok" : "BUG", `the School Administrator CANNOT delete a submission they cannot read (${delAdmin.s})`);
    }
    const plantB = await upload(teacherB.token, subProject, `planted-${stamp}.txt`);
    finding("E7", !plantB.ok ? "ok" : "BUG", `another teacher CANNOT plant a file in the submissions (${plantB.stage} ${plantB.s})`);
    const plantR = await upload(registrar.token, subProject, `planted-reg-${stamp}.txt`);
    finding("E8", !plantR.ok ? "ok" : "BUG", `the Registrar CANNOT plant a file in the submissions (${plantR.stage} ${plantR.s})`);

    // --- is the submissions project used by anything at all? --------------
    const { rows: subRows } = await db.query(
      "select count(*)::int as n from documents where project_id = $1 and deleted_at is null", [subProject]);
    note(`submissions project now holds ${subRows[0].n} document(s) — of which the student uploaded ${own.ok ? 1 : 0}`);
  }
}

// ===========================================================================
// 3. The approval gate: can the person who uploads still REQUEST approval?
// ===========================================================================
console.log("\n=== 3. Approval — request vs decide ===");
{
  const ctx = await makeTenant("IT", "DocAudit IT");
  const roleRows = (await read(ctx.admin, "roles.list")).b ?? [];
  ctx.roleId = (l) => roleRows.find((r) => r.label === l)?.id;
  const dept = await call(ctx.admin, "department.create", { name: "Ops", type: "engineering" });
  const lead = await makeUser(ctx, "DA Lead", "Lead", "it-lead", dept.b?.id);

  // (a) a project the ADMIN owns, with the Lead added as a real member.
  const proj = await call(ctx.admin, "project.create", { name: "Billing rewrite", status: "active" });
  const leadId = (await db.query("select id from users where tenant_id=$1 and display_name='DA Lead'", [ctx.tenantId])).rows[0]?.id;
  await call(ctx.admin, "project.addMember", { projectId: proj.b.id, userId: leadId });
  const { rows: gr } = await db.query("select permissions from roles where tenant_id=$1 and label='Lead'", [ctx.tenantId]);
  const leadDocGrants = (gr[0]?.permissions ?? []).filter((g) => g.startsWith("document:"));
  note(`the Lead holds: ${leadDocGrants.join(", ") || "(no document grants)"}`);

  const memberUp = await upload(lead.token, proj.b.id, `member-${stamp}.txt`);
  finding("D1", memberUp.ok ? "ok" : "BUG", `a project MEMBER can upload to that project (${memberUp.stage} ${memberUp.s} ${String(memberUp.msg).slice(0, 55)})`);

  // (b) a project the Lead owns themselves — so the approval probe can run
  //     with an uploader who is not the approver.
  const ownProj = await call(lead.token, "project.create", { name: "Lead's own work", status: "active" });
  const up = ownProj.b?.id ? await upload(lead.token, ownProj.b.id, `report-${stamp}.txt`) : { ok: false, stage: "project.create", s: ownProj.s, msg: ownProj.msg };
  note(`the Lead uploads to a project they own (${up.stage} ${up.s} ${String(up.msg).slice(0, 50)})`);
  const approvalProjectId = ownProj.b?.id ?? proj.b.id;
  if (up.id) {
    const req = await call(lead.token, "document.requestApproval", { id: up.id });
    finding("A1", req.s === 200 || req.s === 201 ? "ok" : "BUG", `the uploader can REQUEST approval on their own document (${req.s} ${String(req.msg).slice(0, 70)})`);
    const self = await call(lead.token, "document.setApprovalStatus", { id: up.id, status: "approved" });
    finding("A2", self.s === 403 ? "ok" : "BUG", `the uploader CANNOT approve their own document (${self.s})`);
    const byAdmin = await call(ctx.admin, "document.setApprovalStatus", { id: up.id, status: "approved" });
    finding("A3", byAdmin.s === 200 || byAdmin.s === 201 ? "ok" : "BUG", `a document:approve holder can approve it (${byAdmin.s})`);

    const detail = await read(ctx.admin, "document.detail", { id: up.id });
    const keys = Object.keys(detail.b ?? {});
    finding("A4", keys.includes("canApprove") ? "ok" : "BUG", `document.detail tells the UI who may approve (returns: ${keys.join(", ")})`);
    const listed = await read(ctx.admin, "documents.list", { projectId: approvalProjectId });
    const row = (listed.b ?? [])[0] ?? {};
    finding("A5", "taskId" in row ? "ok" : "BUG", `documents.list says which task a file is evidence for (row keys: ${Object.keys(row).join(", ")})`);
  }

  // --- does a document read distinguish "absent" from "hidden"? -----------
  // Rewritten alongside the fix: this used to compare a missing project
  // against one the Lead can SEE and call 404 a bug, which only read
  // correctly while a hidden project answered 403.
  const ghost = await read(lead.token, "documents.list", { projectId: "00000000-0000-0000-0000-000000000000" });
  const visible = await read(lead.token, "documents.list", { projectId: proj.b.id });
  note(`documents.list -> missing ${ghost.s}, visible ${visible.s}, hidden ${hiddenStatus ?? "n/a"}`);
  finding(
    "V1",
    ghost.s === 404 && hiddenStatus === 404 ? "ok" : "BUG",
    `a missing project and a hidden one look the same (missing ${ghost.s}, hidden ${hiddenStatus ?? "not probed"})`,
  );
}

await db.end();
console.log(`\n${"=".repeat(80)}`);
const bugs = findings.filter((f) => f.verdict === "BUG");
console.log(`${findings.length} checks, ${bugs.length} confirmed finding(s)`);
for (const f of bugs) console.log(`  !! ${f.id}  ${f.label}`);
fs.writeFileSync("documents-audit-result.json", JSON.stringify(findings, null, 2));
