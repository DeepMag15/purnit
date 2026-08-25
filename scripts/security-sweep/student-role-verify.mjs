import fs from "node:fs";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
loadEnv({ path: "../../.env", quiet: true });

/**
 * Student Role — end-to-end live verification.
 *
 * Builds a real Education workspace, registers a real student, issues them a
 * real login, links the two, enrols them in a real course with real
 * assignments and a real grade — then signs in AS the student and checks both
 * halves of the contract:
 *
 *   1. the portal actually works (their courses, assignments, progress,
 *      materials, attendance all resolve), and
 *   2. everything else is refused — by navigation, by direct page URL, and by
 *      direct data-source call.
 *
 * Point 2 is the one that matters. A role that merely *looks* restricted in a
 * sidebar is the failure mode the Stage E sweep exists to catch.
 */
const API = "http://localhost:4000";
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const stamp = Date.now();
const PW = "Student!2026";
const PW2 = "Student!2026x";

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

// ---- an Education workspace ------------------------------------------------
const adminEmail = `student-admin+${stamp}@example.com`;
const su = await fetch(`${API}/auth/signup`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: adminEmail, password: PW, companyName: `StudentRole ${stamp}`, displayName: "SR Admin", industry: "Education" }),
});
const tenant = await j(su);
if (!tenant?.tenantId) {
  console.log("signup failed:", JSON.stringify(tenant).slice(0, 200));
  process.exit(1);
}
await db.query("update tenants set seats_purchased = 10, subscription_status='pending_payment', plan_id=(select id from plans where key='professional') where id = $1", [tenant.tenantId]);

const { data: aS } = await sb.auth.signInWithPassword({ email: adminEmail, password: PW });
const admin = aS.session.access_token;
console.log(`workspace StudentRole ${stamp}\n`);

// ---- fixtures, as the admin -------------------------------------------------
console.log("setting up as the School Administrator:");
const course = await call(admin, "course.create", { name: "Algebra II", description: "Term 1" });
const student = await call(admin, "student.register", { name: "Ada Lovelace", contactEmail: `ada+${stamp}@example.com` });
check(!!course.b?.id, `course created (${course.s})`);
check(!!student.b?.id, `student registered (${student.s})`);

const roleRows = (await read(admin, "roles.list")).b ?? [];
const studentRoleId = roleRows.find((r) => r.label === "Student")?.id;
check(!!studentRoleId, "Student role materialized in the tenant from the blueprint");

// A real login for the student, through the normal invite flow.
// `user.invite` requires a departmentId — the platform's org model, which
// Education's Phase A left as an empty taxonomy. A student belongs to a year
// group rather than a department, so this is a slightly awkward fit; noted
// rather than worked around, since changing the invite contract is well
// outside the Student role's scope.
const dept = await call(admin, "department.create", { name: "Year 12", type: "general" });
check(!!dept.b?.id, `department created for the invite flow (${dept.s} ${String(dept.msg).slice(0, 60)})`);

const studentEmail = `ada+${stamp}@example.com`;
const inv = await call(admin, "user.invite", { email: studentEmail, displayName: "Ada Lovelace", roleId: studentRoleId, departmentId: dept.b?.id });
check(!!inv.b?.temporaryPassword, `student login invited (${inv.s} ${String(inv.msg).slice(0, 80)})`);
if (!inv.b?.temporaryPassword) {
  console.log("cannot continue without a student login");
  process.exit(1);
}

const { data: s1 } = await sb.auth.signInWithPassword({ email: studentEmail, password: inv.b.temporaryPassword });
await sb.auth.updateUser({ password: PW2 });
await fetch(`${API}/auth/complete-first-login`, { method: "POST", headers: H(s1.session.access_token) });
const { data: s2 } = await sb.auth.signInWithPassword({ email: studentEmail, password: PW2 });
const studentTok = s2.session.access_token;

const studentUserId = (await db.query("select id from users where tenant_id=$1 and display_name='Ada Lovelace'", [tenant.tenantId])).rows[0]?.id;
const link = await call(admin, "student.linkLogin", { studentId: student.b.id, userId: studentUserId });
check(link.s === 200 || link.s === 201, `login linked to the student record (${link.s})`);

// Enrol + real coursework.
const enrol = await call(admin, "enrollment.enroll", { studentId: student.b.id, courseId: course.b.id });
check(enrol.s === 200 || enrol.s === 201, `enrolled in the course (${enrol.s})`);

const a1 = await call(admin, "assignment.create", { courseId: course.b.id, title: "Quadratics worksheet", maxScore: 100, dueDate: new Date(Date.now() + 3 * 86400000).toISOString() });
const a2 = await call(admin, "assignment.create", { courseId: course.b.id, title: "Chapter 4 problems", maxScore: 50 });
check(!!a1.b?.id && !!a2.b?.id, "two assignments created");
const graded = await call(admin, "grade.record", { assignmentId: a2.b.id, studentId: student.b.id, score: 45, feedback: "Strong work" });
check(graded.s === 200 || graded.s === 201, `one assignment graded 45/50 (${graded.s})`);

// ---- the portal actually works ---------------------------------------------
console.log("\nsigned in AS the student — does the portal work:");
const boot = await j(await fetch(`${API}/api/workspace/bootstrap`, { headers: H(studentTok) }));
const navIds = [];
(function walk(items) {
  for (const i of items ?? []) {
    if (i.pageId) navIds.push(i.pageId);
    if (i.children) walk(i.children);
  }
})(boot.navigation);
console.log(`  navigation: ${navIds.join(", ")}`);

const myCourses = await read(studentTok, "myCourses.list");
check(myCourses.s === 200 && myCourses.b?.length === 1, `myCourses.list returns their 1 course (${myCourses.s})`);
check(myCourses.b?.[0]?.name === "Algebra II", "the course is the right one");
check(myCourses.b?.[0]?.outstandingCount === 1, `1 of 2 assignments outstanding (got ${myCourses.b?.[0]?.outstandingCount})`);

const myAssignments = await read(studentTok, "myAssignments.list");
check(myAssignments.s === 200 && myAssignments.b?.length === 2, `myAssignments.list returns both (${myAssignments.s})`);
const gradedRow = (myAssignments.b ?? []).find((a) => a.graded);
check(gradedRow?.score === 45, `the graded one shows 45 (got ${gradedRow?.score})`);

const progress = await read(studentTok, "myProgress.get");
check(progress.s === 200, `myProgress.get resolves (${progress.s})`);
check(progress.b?.overallPercent === 90, `overall averages graded work only: 45/50 = 90% (got ${progress.b?.overallPercent})`);

// Materials for their enrolled courses.
const materials = await read(studentTok, "myCourseMaterials.list", {});
check(materials.s === 200, `course materials resolve for an enrolled course (${materials.s})`);
// And the boundary that source exists to draw: the generic documents module
// still refuses, because a student holds no project grant at all.
const rawDocs = await read(studentTok, "documents.list", { projectId: myCourses.b?.[0]?.materialsProjectId });
check(rawDocs.s === 403, `documents.list itself still refuses a student (${rawDocs.s}) — materials come only via enrolment`);

// Attendance + announcements, both reused unchanged.
const mark = await call(studentTok, "attendance.mark", { date: new Date().toISOString(), status: "present" });
check(mark.s === 200 || mark.s === 201, `student can mark their own attendance (${mark.s})`);
const att = await read(studentTok, "attendance.list", {
  from: new Date(Date.now() - 30 * 86400000).toISOString(),
  to: new Date().toISOString(),
});
check(att.s === 200, `student sees their own attendance history (${att.s} ${String(att.msg).slice(0, 60)})`);
const ann = await read(studentTok, "announcements.list", {});
check(ann.s === 200, `student sees announcements (${ann.s})`);
const cal = await read(studentTok, "calendar.list", {});
check(cal.s === 200, `student sees their calendar (${cal.s})`);

// ---- and everything else is refused ----------------------------------------
console.log("\nsigned in AS the student — is everything else refused:");

const allPages = (await db.query("select jsonb_object_keys(definition->'pages') p from blueprints where industry='Education'")).rows.map((r) => r.p);
const withheld = allPages.filter((p) => !navIds.includes(p));
const leaked = [];
for (const p of withheld) {
  const r = await fetch(`${API}/api/workspace/pages/${p}`, { headers: H(studentTok) });
  if (r.status !== 404) leaked.push(`${p}=${r.status}`);
}
check(leaked.length === 0, `all ${withheld.length} withheld pages 404 by direct URL${leaked.length ? ` — LEAKED ${leaked.join(", ")}` : ""}`);

const permitted = [];
for (const p of navIds) {
  const r = await fetch(`${API}/api/workspace/pages/${p}`, { headers: H(studentTok) });
  if (r.status !== 200) permitted.push(`${p}=${r.status}`);
}
check(permitted.length === 0, `all ${navIds.length} permitted pages load${permitted.length ? ` — BROKEN ${permitted.join(", ")}` : ""}`);

// The whole school's records, by direct data-source call.
const REFUSED_SOURCES = [
  ["students.list", "the whole student register"],
  ["courses.list", "every course in the school"],
  ["enrollments.list", "every enrolment"],
  ["grades.list", "the whole gradebook"],
  ["users.list", "the staff directory"],
  ["analytics.dashboard", "school analytics"],
  ["auditLogs.list", "the audit log"],
  ["roles.listDetailed", "roles and permissions"],
  ["settings.capabilities", "workspace settings"],
];
const sourceLeaks = [];
for (const [src, what] of REFUSED_SOURCES) {
  const r = await read(studentTok, src, {});
  // settings.capabilities is a self-reporting probe and returns 200 by design
  // — it reports the caller's OWN grants, all false here.
  if (src === "settings.capabilities") {
    if (r.b?.canManageSettings !== false) sourceLeaks.push(`${src} reported canManageSettings true`);
    continue;
  }
  if (r.s === 200 && Array.isArray(r.b) && r.b.length > 0) sourceLeaks.push(`${src} (${what}) returned ${r.b.length} rows`);
  else if (r.s === 200 && !Array.isArray(r.b) && r.b) sourceLeaks.push(`${src} (${what}) returned data`);
}
check(sourceLeaks.length === 0, `no school-wide data source returns anything${sourceLeaks.length ? ` — LEAKED ${sourceLeaks.join(", ")}` : ""}`);

// Staff mutations, by direct call.
const REFUSED_MUTATIONS = [
  ["student.register", { name: "Forged" }],
  ["course.create", { name: "Forged" }],
  ["enrollment.enroll", { studentId: student.b.id, courseId: course.b.id }],
  ["grade.record", { assignmentId: a1.b.id, studentId: student.b.id, score: 100 }],
  ["assignment.create", { courseId: course.b.id, title: "Forged", maxScore: 10 }],
  // departmentId included deliberately: `inputSchema.parse` runs BEFORE
  // `checkRequiredPermission`, so an incomplete payload would 400 without ever
  // reaching the gate — testing nothing. Same lesson as the Stage E sweep.
  ["user.invite", { email: `forged+${stamp}@example.com`, displayName: "Forged", roleId: studentRoleId, departmentId: dept.b?.id }],
  ["student.linkLogin", { studentId: student.b.id, userId: studentUserId }],
];
const mutationLeaks = [];
for (const [m, body] of REFUSED_MUTATIONS) {
  const r = await call(studentTok, m, body);
  if (r.s !== 403) mutationLeaks.push(`${m}=${r.s}`);
}
check(mutationLeaks.length === 0, `all ${REFUSED_MUTATIONS.length} staff mutations refused 403${mutationLeaks.length ? ` — LEAKED ${mutationLeaks.join(", ")}` : ""}`);

// A student must not be able to grade themselves — the single most tempting
// thing for a real student to try.
const selfGrade = await call(studentTok, "grade.update", { id: graded.b?.id ?? "x", score: 50 });
check(selfGrade.s === 403, `a student cannot change their own grade (${selfGrade.s})`);

// ---- seats ------------------------------------------------------------------
console.log("\nbilling:");
const seatRow = await db.query(
  `select count(*)::int n from users u where u.tenant_id = $1 and u.deleted_at is null`, [tenant.tenantId]);
check(seatRow.rows[0].n === 2, `2 users exist (admin + student), got ${seatRow.rows[0].n}`);
// Filling the tenant to its seat limit with students must still leave room to
// invite staff — the whole point of the exemption.
await db.query("update tenants set seats_purchased = 2 where id = $1", [tenant.tenantId]);
const staffInvite = await call(admin, "user.invite", {
  email: `teacher+${stamp}@example.com`,
  displayName: "SR Teacher",
  roleId: roleRows.find((r) => r.label === "Teacher")?.id,
  departmentId: dept.b?.id,
});
check(
  staffInvite.s === 200 || staffInvite.s === 201,
  `a staff invite still succeeds at seats=2 because the student doesn't consume one (${staffInvite.s} ${String(staffInvite.msg).slice(0, 60)})`,
);

await db.end();
console.log(`\n${"=".repeat(80)}`);
console.log(`${results.checks} checks run, ${results.failures.length} failure(s)`);
for (const f of results.failures) console.log(`  FAIL  ${f}`);
fs.writeFileSync("student-role-result.json", JSON.stringify({ ...results, tenantName: `StudentRole ${stamp}` }, null, 2));
