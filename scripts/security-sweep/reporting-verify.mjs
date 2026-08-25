import fs from "node:fs";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
loadEnv({ path: "../../.env", quiet: true });

/**
 * Contextual Reporting — live verification.
 *
 * Builds a real Education workspace with a Teacher, a Teaching Assistant, a
 * Registrar and a Student, uploads ONE real CSV report to a course, and checks
 * the thing the whole feature rests on: four people opening the same file get
 * four different analyses, chosen by the permissions they already had.
 *
 * Then the boundaries: a report you cannot reach cannot be analysed, and no
 * role can reach another's documents by direct API call.
 */
const API = "http://localhost:4000";
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const stamp = Date.now();
const PW = "Report!2026";
const PW2 = "Report!2026x";

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

// ---- workspace + people -----------------------------------------------------
const adminEmail = `report-admin+${stamp}@example.com`;
const su = await fetch(`${API}/auth/signup`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: adminEmail, password: PW, companyName: `Reporting ${stamp}`, displayName: "RP Admin", industry: "Education" }),
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
console.log(`workspace Reporting ${stamp}\n`);

console.log("setting up:");
const dept = await call(admin, "department.create", { name: "Faculty", type: "general" });
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

const teacherTok = await makeUser("RP Teacher", "Teacher", "rp-teacher");
const taTok = await makeUser("RP TA", "Teaching Assistant", "rp-ta");
const registrarTok = await makeUser("RP Registrar", "Registrar", "rp-registrar");
const studentTok = await makeUser("RP Student", "Student", "rp-student");
check(!!teacherTok && !!taTok && !!registrarTok && !!studentTok, "four real logins created (Teacher, TA, Registrar, Student)");

const teacherUserId = (await db.query("select id from users where tenant_id=$1 and display_name='RP Teacher'", [tenant.tenantId])).rows[0]?.id;
const studentUserId = (await db.query("select id from users where tenant_id=$1 and display_name='RP Student'", [tenant.tenantId])).rows[0]?.id;

const course = await call(admin, "course.create", { name: "Algebra II", description: "Term 1", teacherId: teacherUserId });
const student = await call(admin, "student.register", { name: "Ada Lovelace" });
check(!!course.b?.materialsProjectId, "course created with a materials project");
check(!!student.b?.filesProjectId, "student registered WITH a files project (new anchor)");

await call(admin, "student.linkLogin", { studentId: student.b.id, userId: studentUserId });
const enrol = await call(admin, "enrollment.enroll", { studentId: student.b.id, courseId: course.b.id });
check(!!enrol.b?.submissionsProjectId, "enrolment created a private submissions project (new anchor)");

// ---- one real report, uploaded to the course --------------------------------
const csv = [
  "student,attendance_pct,quiz1,quiz2,midterm,notes",
  "Ada Lovelace,92,78,81,74,steady",
  "Grace Hopper,61,55,48,41,missed 4 classes",
  "Alan Turing,97,95,98,96,",
  "Katherine Johnson,88,72,69,58,dropped after midterm review",
  "Ada Byron,45,40,38,35,at risk - repeated absence",
].join("\n");

const upload = await call(admin, "document.createUploadUrl", {
  projectId: course.b.materialsProjectId,
  fileName: `term1-class-report-${stamp}.csv`,
  mimeType: "text/csv",
  sizeBytes: Buffer.byteLength(csv),
});
check(!!upload.b?.signedUrl || !!upload.b?.token, `upload URL issued (${upload.s} ${String(upload.msg).slice(0, 70)})`);

if (upload.b?.signedUrl) {
  const put = await fetch(upload.b.signedUrl, { method: "PUT", headers: { "content-type": "text/csv" }, body: csv });
  check(put.ok, `report bytes uploaded to storage (${put.status})`);
}

const doc = await call(admin, "document.create", {
  projectId: course.b.materialsProjectId,
  storagePath: upload.b?.path,
  name: `term1-class-report-${stamp}.csv`,
  mimeType: "text/csv",
  sizeBytes: Buffer.byteLength(csv),
});
check(!!doc.b?.id, `report registered as a document in the course (${doc.s} ${String(doc.msg).slice(0, 70)})`);

// ---- the point: four roles, one file, four readings -------------------------
console.log("\nthe same report, opened by four different roles:");
const seen = {};
for (const [label, tok] of [
  ["Teacher", teacherTok],
  ["Teaching Assistant", taTok],
  ["Registrar", registrarTok],
  ["Student", studentTok],
]) {
  const view = await read(tok, "document.analyses", { documentId: doc.b.id });
  if (view.s !== 200) {
    console.log(`  ${label.padEnd(19)} cannot reach this document (${view.s})`);
    seen[label] = null;
    continue;
  }
  seen[label] = view.b?.availableLens?.key ?? null;
  console.log(`  ${label.padEnd(19)} lens: ${seen[label] ?? "none"}  canAnalyze: ${view.b?.canAnalyze}`);
}

check(seen.Teacher === "course.classPerformance", `Teacher gets class performance (got ${seen.Teacher})`);
check(seen["Teaching Assistant"] === "course.classOverview", `TA gets a cohort overview, not the teacher's reading (got ${seen["Teaching Assistant"]})`);
check(seen.Registrar === "course.enrolmentCompliance", `Registrar gets enrolment compliance, never grades (got ${seen.Registrar})`);
check(new Set([seen.Teacher, seen["Teaching Assistant"], seen.Registrar]).size === 3, "three staff roles, three genuinely different readings of one file");
// A Student cannot reach a course-materials document at all: that project is
// owned by the Admin who created the course, and a Student holds only
// project:read:own. Their reporting surface is their OWN submission, checked
// below — not a lens on somebody else's file.
check(seen.Student === null, "a Student is refused a course-materials document outright, not given a weaker lens");

// ---- a real analysis actually runs ------------------------------------------
console.log("\nrunning a real analysis as the Teacher:");
const run = await call(teacherTok, "document.analyze", { documentId: doc.b.id });
check(run.s === 200 || run.s === 201, `analysis completed (${run.s} ${String(run.msg).slice(0, 120)})`);
if (run.b?.id) {
  const after = await read(teacherTok, "document.analyses", { documentId: doc.b.id });
  const a = after.b?.analyses?.[0];
  check(!!a?.summary, "it produced a summary");
  check(Array.isArray(a?.findings) && a.findings.length > 0, `it produced findings (${a?.findings?.length ?? 0})`);
  check(a?.lensKey === "course.classPerformance", "the stored analysis records which lens produced it");
  if (a) {
    console.log(`\n  summary: ${String(a.summary).slice(0, 220)}`);
    for (const f of (a.findings ?? []).slice(0, 3)) console.log(`  - [${f.severity}] ${f.label}: ${String(f.detail).slice(0, 110)}`);
  }
  // A colleague who cannot commission an analysis can still read one.
  const taView = await read(taTok, "document.analyses", { documentId: doc.b.id });
  check((taView.b?.analyses?.length ?? 0) > 0, "a TA can READ the analysis the Teacher ran on a document they share");
}

// ---- the student's own surface: submit work, then check it ------------------
console.log("\nthe Student's own surface — submitting work to their private project:");
const essay = [
  "Algebra II — Problem Set 3",
  "Ada Lovelace",
  "",
  "Q1. Solve x^2 - 5x + 6 = 0.",
  "Factorising: (x-2)(x-3) = 0, so x = 2 or x = 3.",
  "",
  "Q2. Sketch y = x^2 - 4x + 3.",
  "Vertex at x = 2, y = -1. Roots at x = 1 and x = 3. Opens upward.",
  "",
  "Q3. I wasn't sure how to start this one so I left it blank.",
].join("\n");

const subUpload = await call(studentTok, "document.createUploadUrl", {
  projectId: enrol.b.submissionsProjectId,
  fileName: `problem-set-3-${stamp}.txt`,
  mimeType: "text/plain",
  sizeBytes: Buffer.byteLength(essay),
});
check(!!subUpload.b?.signedUrl, `a Student can upload to their own submissions project (${subUpload.s} ${String(subUpload.msg).slice(0, 70)})`);

if (subUpload.b?.signedUrl) {
  await fetch(subUpload.b.signedUrl, { method: "PUT", headers: { "content-type": "text/plain" }, body: essay });
  const subDoc = await call(studentTok, "document.create", {
    projectId: enrol.b.submissionsProjectId,
    storagePath: subUpload.b.path,
    name: `problem-set-3-${stamp}.txt`,
    mimeType: "text/plain",
    sizeBytes: Buffer.byteLength(essay),
  });
  check(!!subDoc.b?.id, `the submission is registered as a document (${subDoc.s} ${String(subDoc.msg).slice(0, 70)})`);

  if (subDoc.b?.id) {
    const studentLens = await read(studentTok, "document.analyses", { documentId: subDoc.b.id });
    const teacherLens = await read(teacherTok, "document.analyses", { documentId: subDoc.b.id });
    check(studentLens.b?.availableLens?.key === "submission.selfCheck", `the Student gets "check my work" on their own submission (got ${studentLens.b?.availableLens?.key})`);
    check(teacherLens.b?.availableLens?.key === "submission.teacherReview", `the Teacher gets marking notes on the SAME file (got ${teacherLens.b?.availableLens?.key})`);

    const selfCheck = await call(studentTok, "document.analyze", { documentId: subDoc.b.id });
    check(selfCheck.s === 200 || selfCheck.s === 201, `the Student's own analysis runs (${selfCheck.s} ${String(selfCheck.msg).slice(0, 110)})`);
    if (selfCheck.b?.id) {
      const sa = (await read(studentTok, "document.analyses", { documentId: subDoc.b.id })).b?.analyses?.[0];
      console.log(`\n  student self-check: ${String(sa?.summary ?? "").slice(0, 220)}`);
    }
  }
}

// ---- boundaries --------------------------------------------------------------
console.log("\nboundaries:");
// ⚠️ The boundary that was BROKEN when Contextual Reporting first shipped, and
// is now fixed. `project:read:tenant` used to return every project in the
// workspace, so a TA, a Registrar or any staff member could read every
// student's private submissions and every patient's clinical documents. A
// restricted project is now reachable only by its owner, its members, or a
// caller holding its declared accessPermission.
const taOnSubmission = await read(taTok, "documents.list", { projectId: enrol.b.submissionsProjectId });
check(taOnSubmission.s === 403, `a TA canNOT read a student's private submissions, despite project:read:tenant (${taOnSubmission.s})`);

const registrarOnSubmission = await read(registrarTok, "documents.list", { projectId: enrol.b.submissionsProjectId });
check(registrarOnSubmission.s === 403, `nor can a Registrar (${registrarOnSubmission.s})`);

const studentOwnSubmission = await read(studentTok, "documents.list", { projectId: enrol.b.submissionsProjectId });
check(studentOwnSubmission.s === 200, `the Student still reaches their OWN submissions (${studentOwnSubmission.s})`);

const teacherOnSubmission = await read(teacherTok, "documents.list", { projectId: enrol.b.submissionsProjectId });
check(teacherOnSubmission.s === 200, `the marking Teacher still reaches it, as a member (${teacherOnSubmission.s})`);

const teacherOnStudentFile = await read(teacherTok, "documents.list", { projectId: student.b.filesProjectId });
check(teacherOnStudentFile.s === 403, `a Teacher canNOT read registrar student-file paperwork (${teacherOnStudentFile.s})`);

// Analysis on a document you cannot reach is refused, by direct API call.
const fakeAnalyze = await call(studentTok, "document.analyze", { documentId: "00000000-0000-4000-8000-000000000001" });
check(fakeAnalyze.s === 404 || fakeAnalyze.s === 403, `analysing an unreachable document is refused (${fakeAnalyze.s})`);

// The student file anchor belongs to the Registrar, and a Student must not reach it.
const studentFileByStudent = await read(studentTok, "documents.list", { projectId: student.b.filesProjectId });
check(studentFileByStudent.s === 403, `a Student cannot read their own registrar file (${studentFileByStudent.s})`);

const registrarFile = await read(registrarTok, "documents.list", { projectId: student.b.filesProjectId });
check(registrarFile.s === 200, `a Registrar CAN reach the student file anchor (${registrarFile.s})`);

await db.end();
console.log(`\n${"=".repeat(80)}`);
console.log(`${results.checks} checks run, ${results.failures.length} failure(s)`);
for (const f of results.failures) console.log(`  FAIL  ${f}`);
fs.writeFileSync("reporting-result.json", JSON.stringify({ ...results, tenantName: `Reporting ${stamp}` }, null, 2));
