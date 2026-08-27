import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

/**
 * Who a person may reach out to — the collaboration boundary.
 *
 * ⚠️ Why this exists. `conversation.createDm` was ungated with the comment
 * "any tenant member may DM any other tenant member", and the Comments review
 * verified what that means in Education: a **Student** could open a direct
 * message with any teacher who does not teach them (201), with **any
 * classmate** (201), and with the School Administrator (201). The same student
 * is correctly refused `users.list`, so the platform was careful about letting
 * them *enumerate* people and careless about letting them *contact* people.
 *
 * The rule, as the user stated it: **a student may communicate only with the
 * teachers and staff actually connected to their course, assignment,
 * enrolment or review workflow — never freely with every student or staff
 * member.**
 *
 * Three deliberate design decisions:
 *
 * 1. **The restriction attaches to being a student, not to a permission
 *    triple.** A `Student` row with a linked login is what makes someone a
 *    learner; no grant expresses "is a minor in this school", and inventing
 *    one would let it be handed out by mistake. This is the same reasoning
 *    that keeps `countBillableUsers` identifying students by blueprint role
 *    rather than by a flag on `User`.
 *
 * 2. **It is symmetric.** If *either* party is a student, the connection must
 *    exist. Restricting only the student's outbound direction would leave any
 *    staff member able to open a channel to any learner in the school, which
 *    is the same safeguarding problem viewed from the other end. The user's
 *    instruction speaks to what students may do; the symmetric reading is the
 *    safe one, and it is called out here rather than assumed silently.
 *
 * 3. **Staff-to-staff is unchanged.** Nobody asked for an org-wide
 *    address-book lockdown, and imposing one would break Chat for every
 *    existing domain. Only relationships involving a student are narrowed.
 *
 * "Connected" is resolved from real rows, never from a role label: the teacher
 * of record on a course the student is enrolled in, and anyone named on a
 * project the student owns or belongs to — which is exactly the set that
 * reviews their submissions.
 */

/** The student record behind a login, or null for staff. */
export async function studentForUser(tx: PrismaTx, tenantId: string, userId: string) {
  return tx.student.findFirst({ where: { tenantId, userId, deletedAt: null }, select: { id: true, userId: true } });
}

/**
 * Every staff user a given student is legitimately connected to.
 *
 * Deliberately NOT "everyone in my department" or "everyone who can read my
 * record": a Registrar can read a student's file without having any reason to
 * message them. Connection means a shared piece of work.
 */
export async function connectedStaffForStudent(tx: PrismaTx, tenantId: string, studentId: string): Promise<Set<string>> {
  const reachable = new Set<string>();

  // 1. The teacher of record on every course this student is enrolled in.
  const enrollments = await tx.enrollment.findMany({
    where: { tenantId, studentId },
    select: { courseId: true, submissionsProjectId: true },
  });
  const courseIds = enrollments.map((e) => e.courseId);
  if (courseIds.length > 0) {
    const courses = await tx.course.findMany({
      where: { tenantId, id: { in: courseIds }, deletedAt: null },
      select: { teacherId: true },
    });
    for (const c of courses) if (c.teacherId) reachable.add(c.teacherId);
  }

  // 2. Anyone named on a project this student's work lives in — their
  //    submissions folders and their own student file. That is precisely the
  //    set of people who review them.
  const student = await tx.student.findFirst({ where: { tenantId, id: studentId }, select: { userId: true, filesProjectId: true } });
  const projectIds = [
    ...enrollments.map((e) => e.submissionsProjectId).filter((id): id is string => !!id),
    ...(student?.filesProjectId ? [student.filesProjectId] : []),
  ];
  if (projectIds.length > 0) {
    const members = await tx.projectMember.findMany({ where: { projectId: { in: projectIds } }, select: { userId: true } });
    for (const m of members) reachable.add(m.userId);
    const owners = await tx.project.findMany({ where: { tenantId, id: { in: projectIds } }, select: { ownerId: true } });
    for (const o of owners) if (o.ownerId) reachable.add(o.ownerId);
  }

  // Never themselves, and never another learner: two students sharing a
  // course are not "connected" in the sense this rule protects.
  if (student?.userId) reachable.delete(student.userId);
  const otherStudents = await tx.student.findMany({
    where: { tenantId, deletedAt: null, userId: { not: null } },
    select: { userId: true },
  });
  for (const s of otherStudents) if (s.userId) reachable.delete(s.userId);

  return reachable;
}

/**
 * May `actorUserId` open a conversation with `otherUserId`?
 *
 * Staff ↔ staff: yes, unchanged. Anything involving a student: only if the
 * connection above exists.
 */
export async function canReachUser(tx: PrismaTx, tenantId: string, actorUserId: string, otherUserId: string): Promise<boolean> {
  if (actorUserId === otherUserId) return false;

  const actorStudent = await studentForUser(tx, tenantId, actorUserId);
  if (actorStudent) {
    const reachable = await connectedStaffForStudent(tx, tenantId, actorStudent.id);
    return reachable.has(otherUserId);
  }

  // The actor is staff. If the OTHER party is a student, the same connection
  // must hold — see decision 3 above.
  const otherStudent = await studentForUser(tx, tenantId, otherUserId);
  if (otherStudent) {
    const reachable = await connectedStaffForStudent(tx, tenantId, otherStudent.id);
    return reachable.has(actorUserId);
  }

  return true;
}

/**
 * The roster this caller may see and contact — what a "start a conversation"
 * picker should offer, so the UI cannot present someone the API will refuse.
 */
export async function reachableUsers(tx: PrismaTx, tenantId: string, actorUserId: string) {
  const actorStudent = await studentForUser(tx, tenantId, actorUserId);

  if (actorStudent) {
    const reachable = await connectedStaffForStudent(tx, tenantId, actorStudent.id);
    if (reachable.size === 0) return [];
    return tx.user.findMany({
      where: { tenantId, deletedAt: null, id: { in: [...reachable] } },
      select: { id: true, displayName: true },
      orderBy: { displayName: "asc" },
    });
  }

  // Staff see the roster, minus any student they are not connected to.
  const users = await tx.user.findMany({
    where: { tenantId, deletedAt: null, id: { not: actorUserId } },
    select: { id: true, displayName: true },
    orderBy: { displayName: "asc" },
  });
  const students = await tx.student.findMany({
    where: { tenantId, deletedAt: null, userId: { not: null } },
    select: { id: true, userId: true },
  });
  if (students.length === 0) return users;

  const studentUserIds = new Map(students.map((s) => [s.userId!, s.id]));
  const allowed: typeof users = [];
  for (const u of users) {
    const sid = studentUserIds.get(u.id);
    if (!sid) {
      allowed.push(u);
      continue;
    }
    const reachable = await connectedStaffForStudent(tx, tenantId, sid);
    if (reachable.has(actorUserId)) allowed.push(u);
  }
  return allowed;
}
