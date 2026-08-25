import { ReportLensRegistry, type ReportAnchor } from "./report-lens-registry.service";
import { DOMAIN_ANCHORS, projectAnchor } from "./domain-lenses";
import { collapsePermissions } from "../rbac/permission-collapse";
import { isKnownPermission } from "../rbac/permission-catalog";
import type { DataSourceContext } from "../data-sources/data-source-registry.service";
import type { PrismaTx } from "../tenancy/tenant-prisma.service";

function ctx(grants: string[]): DataSourceContext {
  return { tenantId: "t1", userId: "u1", userDepartmentId: null, effective: collapsePermissions(grants) };
}

/** An anchor that always claims the project, so lens SELECTION can be tested
 * without standing up five domains' worth of Prisma fakes. */
function claimingAnchor(over: Partial<ReportAnchor> = {}): ReportAnchor {
  return {
    type: "test",
    async resolveContext() {
      return { name: "Thing", detail: "a thing" };
    },
    lenses: [
      { key: "a", label: "A", requiredPermission: "grade:create", focus: "a" },
      { key: "b", label: "B", requiredPermission: "grade:read", focus: "b" },
      { key: "c", label: "C", focus: "fallback" },
    ],
    ...over,
  };
}

const tx = {} as unknown as PrismaTx;

describe("ReportLensRegistry", () => {
  it("picks the FIRST lens the caller qualifies for, so order encodes seniority", async () => {
    const r = new ReportLensRegistry();
    r.register(claimingAnchor());
    // Holds both grants — must get the more specific lens, not the broader one.
    const resolved = await r.resolve(tx, ctx(["grade:create:own", "grade:read:tenant"]), "p1");
    expect(resolved?.lens.key).toBe("a");
  });

  it("falls through to the next lens when the caller lacks the first", async () => {
    const r = new ReportLensRegistry();
    r.register(claimingAnchor());
    const resolved = await r.resolve(tx, ctx(["grade:read:tenant"]), "p1");
    expect(resolved?.lens.key).toBe("b");
  });

  it("uses an ungated lens as the anchor's fallback", async () => {
    const r = new ReportLensRegistry();
    r.register(claimingAnchor());
    expect((await r.resolve(tx, ctx([]), "p1"))?.lens.key).toBe("c");
  });

  it("returns null — never a default lens — when an anchor claims the project but no lens matches", async () => {
    // The security property: an analysis whose angle nobody chose is worse
    // than no analysis. Callers turn this into a refusal.
    const r = new ReportLensRegistry();
    r.register(claimingAnchor({ lenses: [{ key: "a", label: "A", requiredPermission: "grade:create", focus: "a" }] }));
    expect(await r.resolve(tx, ctx([]), "p1")).toBeNull();
  });

  it("does NOT fall through to a later anchor once one claims the project", async () => {
    // ⚠️ The leak this prevents: every domain entity is backed by a Project,
    // so the generic project anchor matches everything. If a claimed-but-
    // unmatched patient chart fell through, a Receptionist with no patient
    // lens would get the IT portfolio lens on clinical data.
    const r = new ReportLensRegistry();
    r.register(claimingAnchor({ type: "first", lenses: [{ key: "x", label: "X", requiredPermission: "grade:create", focus: "x" }] }));
    r.register(claimingAnchor({ type: "second", lenses: [{ key: "y", label: "Y", focus: "y" }] }));
    expect(await r.resolve(tx, ctx([]), "p1")).toBeNull();
  });

  it("skips an anchor that doesn't claim the project", async () => {
    const r = new ReportLensRegistry();
    r.register(claimingAnchor({ type: "nope", resolveContext: async () => null }));
    r.register(claimingAnchor({ type: "yes" }));
    expect((await r.resolve(tx, ctx([]), "p1"))?.anchorType).toBe("yes");
  });

  it("refuses a duplicate anchor type", () => {
    const r = new ReportLensRegistry();
    r.register(claimingAnchor());
    expect(() => r.register(claimingAnchor())).toThrow(/already registered/);
  });
});

describe("domain lenses", () => {
  it("keeps the generic project anchor LAST", () => {
    // Every domain entity is backed by a Project, so this anchor matches all
    // of them. First in the list it would claim every document in the system.
    expect(DOMAIN_ANCHORS[DOMAIN_ANCHORS.length - 1]).toBe(projectAnchor);
  });

  it("registers every domain anchor without collision", () => {
    const r = new ReportLensRegistry();
    for (const a of DOMAIN_ANCHORS) r.register(a);
    expect(r.list()).toHaveLength(DOMAIN_ANCHORS.length);
  });

  it("gates every lens on a permission that really exists", () => {
    // A typo'd lens permission would silently never match, quietly demoting
    // every holder to the next lens down — the reporting equivalent of a
    // typo'd requiredPermission.
    const unknown: string[] = [];
    for (const anchor of DOMAIN_ANCHORS) {
      for (const lens of anchor.lenses) {
        if (!lens.requiredPermission) continue;
        const [resource, action] = lens.requiredPermission.split(":");
        if (!isKnownPermission(resource!, action!)) unknown.push(`${anchor.type}/${lens.key} -> ${lens.requiredPermission}`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it("gives every lens a unique key and a real focus", () => {
    const keys = DOMAIN_ANCHORS.flatMap((a) => a.lenses.map((l) => l.key));
    expect(new Set(keys).size).toBe(keys.length);
    const thin = DOMAIN_ANCHORS.flatMap((a) => a.lenses).filter((l) => l.focus.trim().length < 40);
    expect(thin.map((l) => l.key)).toEqual([]);
  });

  /**
   * The heart of the feature: the same document, read differently. These pin
   * the two orderings that were WRONG on the first attempt — both discovered
   * by checking the real grant lists rather than assuming which permission
   * "belonged" to which role.
   */
  describe("role differentiation on one document", () => {
    const registry = new ReportLensRegistry();
    for (const a of DOMAIN_ANCHORS) registry.register(a);

    const patientTx = {
      patient: { findFirst: jest.fn().mockResolvedValue({ name: "R. Patel", status: "active" }) },
      course: { findFirst: jest.fn().mockResolvedValue(null) },
      student: { findFirst: jest.fn().mockResolvedValue(null) },
      enrollment: { findFirst: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(0) },
      client: { findFirst: jest.fn().mockResolvedValue(null) },
      inventoryItem: { findFirst: jest.fn().mockResolvedValue(null) },
      project: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaTx;

    it("a Doctor gets the clinical lens; a Nurse does not — despite both holding patient:update", async () => {
      const doctor = await registry.resolve(patientTx, ctx(["patient:update:own", "document:update:tenant"]), "chart1");
      const nurse = await registry.resolve(patientTx, ctx(["patient:update:own"]), "chart1");
      expect(doctor?.lens.key).toBe("patient.clinical");
      expect(nurse?.lens.key).toBe("patient.careDelivery");
    });

    it("a Receptionist gets scheduling/admin, never a clinical reading", async () => {
      const receptionist = await registry.resolve(
        patientTx,
        ctx(["patient:read:tenant", "appointment:update:tenant", "document:create:tenant"]),
        "chart1",
      );
      expect(receptionist?.lens.key).toBe("patient.frontDesk");
    });

    const courseTx = {
      patient: { findFirst: jest.fn().mockResolvedValue(null) },
      course: { findFirst: jest.fn().mockResolvedValue({ id: "c1", name: "Algebra II" }) },
      student: { findFirst: jest.fn().mockResolvedValue(null) },
      enrollment: { findFirst: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(24) },
      client: { findFirst: jest.fn().mockResolvedValue(null) },
      inventoryItem: { findFirst: jest.fn().mockResolvedValue(null) },
      project: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaTx;

    it("a Teacher, a TA and a Registrar each get a different lens on the SAME course document", async () => {
      const teacher = await registry.resolve(courseTx, ctx(["grade:create:own", "grade:read:own"]), "mat1");
      const ta = await registry.resolve(courseTx, ctx(["grade:read:tenant"]), "mat1");
      const registrar = await registry.resolve(courseTx, ctx(["enrollment:read:tenant"]), "mat1");

      expect(teacher?.lens.key).toBe("course.classPerformance");
      expect(ta?.lens.key).toBe("course.classOverview");
      expect(registrar?.lens.key).toBe("course.enrolmentCompliance");
      expect(new Set([teacher, ta, registrar].map((r) => r?.lens.key)).size).toBe(3);
    });

    it("has no student lens on course materials, because a Student can never reach that document", async () => {
      // Not an omission: a course's materials Project is owned by the Admin
      // who created the course, and a Student holds only project:read:own, so
      // `assertProjectVisible` refuses them before a lens is ever consulted.
      // A lens here would be dead configuration that reads as a feature.
      // Confirmed live — the Student gets 403 on a course-materials document.
      expect(await registry.resolve(courseTx, ctx(["studentPortal:read:own"]), "mat1")).toBeNull();
    });

    it("gives the Student and the Teacher different readings of the SAME submission", async () => {
      const submissionTx = {
        patient: { findFirst: jest.fn().mockResolvedValue(null) },
        course: { findFirst: jest.fn().mockResolvedValue(null) },
        // Discriminates on the where clause exactly as the real queries do:
        // the studentFile anchor looks up by filesProjectId and must MISS here,
        // or it would claim this project before the submission anchor is
        // reached. Anchor order is load-bearing and a blanket mock hides that.
        student: {
          findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) =>
            Promise.resolve(where.filesProjectId ? null : { name: "Ada" }),
          ),
        },
        enrollment: { findFirst: jest.fn().mockResolvedValue({ studentId: "s1", courseId: "c1" }), count: jest.fn().mockResolvedValue(0) },
        client: { findFirst: jest.fn().mockResolvedValue(null) },
        inventoryItem: { findFirst: jest.fn().mockResolvedValue(null) },
        project: { findFirst: jest.fn().mockResolvedValue(null) },
      } as unknown as PrismaTx;

      // The student owns the file; the teacher marks it. Same bytes, opposite
      // jobs — which is the whole feature in one assertion.
      const student = await registry.resolve(submissionTx, ctx(["studentPortal:read:own"]), "sub1");
      const teacher = await registry.resolve(submissionTx, ctx(["grade:create:own"]), "sub1");
      expect(student?.lens.key).toBe("submission.selfCheck");
      expect(teacher?.lens.key).toBe("submission.teacherReview");
    });

    it("carries the anchor's real context, so the analysis knows what it is reading", async () => {
      const resolved = await registry.resolve(courseTx, ctx(["grade:create:own"]), "mat1");
      expect(resolved?.anchorName).toBe("Algebra II");
      expect(resolved?.anchorDetail).toContain("24 enrolled");
    });
  });
});
