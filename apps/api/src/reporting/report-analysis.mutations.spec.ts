import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { createDocumentAnalyzeMutation } from "./report-analysis.mutations";
import { ReportLensRegistry, type ReportAnchor } from "./report-lens-registry.service";
import { collapsePermissions } from "../rbac/permission-collapse";
import type { MutationContext } from "../mutations/mutation-registry.service";
import type { PrismaTx, TenantPrismaService } from "../tenancy/tenant-prisma.service";
import type { AiProviderService } from "../ai/provider/ai-provider.service";
import type { SupabaseAdminService } from "../auth/supabase-admin.service";
import type { PermissionResolverService } from "../rbac/permission-resolver.service";

/**
 * `document.analyze` is the one mutation in this feature that spends money and
 * touches a file, so these cover the three things that actually matter:
 * what it refuses, what it never does before refusing, and what it does with a
 * reply that isn't the JSON it asked for.
 */

const CSV = "student,score\nAda,90\nGrace,50\n";
const GOOD_REPLY = JSON.stringify({
  summary: "Two students, one strong and one struggling.",
  findings: [{ label: "Grace is behind", detail: "Scored 50 against Ada's 90.", severity: "risk" }],
  suggestedActions: ["Offer Grace a support session."],
});

function anchor(over: Partial<ReportAnchor> = {}): ReportAnchor {
  return {
    type: "course",
    async resolveContext() {
      return { name: "Algebra II", detail: "a course with 2 students" };
    },
    lenses: [{ key: "course.classPerformance", label: "Class performance", requiredPermission: "grade:create", focus: "how this class is doing" }],
    ...over,
  };
}

function build(opts: {
  document?: Record<string, unknown> | null;
  grants?: string[];
  reply?: string | (() => string);
  bytes?: string | null;
} = {}) {
  const document = opts.document === undefined
    ? { id: "d1", name: "term1.csv", mimeType: "text/csv", storagePath: "p/term1.csv", version: 2, projectId: "proj1" }
    : opts.document;

  const tx = {
    user: { findFirst: jest.fn().mockResolvedValue({ id: "u1", departmentId: null }) },
    document: { findFirst: jest.fn().mockResolvedValue(document) },
    project: { findFirst: jest.fn().mockResolvedValue({ id: "proj1" }) },
    course: { findFirst: jest.fn().mockResolvedValue({ id: "c1", name: "Algebra II" }) },
    enrollment: { count: jest.fn().mockResolvedValue(2), findFirst: jest.fn().mockResolvedValue(null) },
    tenantConfig: { findFirst: jest.fn().mockResolvedValue(null) },
    aiMessage: { count: jest.fn().mockResolvedValue(0) },
    documentAnalysis: { create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: "a1", ...data })) },
    documentActivity: { create: jest.fn() },
    auditLog: { create: jest.fn() },
  } as unknown as PrismaTx;

  const tenantPrisma = {
    run: jest.fn((_t: string, fn: (tx: unknown) => unknown) => fn(tx)),
    root: {
      tenant: { findUnique: jest.fn().mockResolvedValue({ id: "t1", planId: null }) },
      plan: { findUnique: jest.fn().mockResolvedValue(null) },
    },
  } as unknown as TenantPrismaService;

  let call = 0;
  const complete = jest.fn().mockImplementation(() => {
    call++;
    const content = typeof opts.reply === "function" ? opts.reply() : (opts.reply ?? GOOD_REPLY);
    return Promise.resolve({ content, usage: { inputTokens: 10, outputTokens: 20 }, stopReason: "end_turn" });
  });
  const aiProvider = { complete } as unknown as AiProviderService;

  const downloadDocumentBytes = jest.fn().mockResolvedValue(
    opts.bytes === null ? new Uint8Array() : Buffer.from(opts.bytes ?? CSV),
  );
  const supabaseAdmin = { downloadDocumentBytes } as unknown as SupabaseAdminService;

  const permissionResolver = {
    resolveEffectivePermissionsWithTx: jest
      .fn()
      .mockResolvedValue(collapsePermissions(opts.grants ?? ["project:read:tenant", "grade:create:own", "reportAnalysis:create:tenant"])),
  } as unknown as PermissionResolverService;

  const lenses = new ReportLensRegistry();
  lenses.register(anchor());

  const mutation = createDocumentAnalyzeMutation(tenantPrisma, aiProvider, supabaseAdmin, lenses, permissionResolver);
  return { mutation, tx, complete, downloadDocumentBytes, getCallCount: () => call };
}

function ctx(grants: string[] = ["reportAnalysis:create:tenant"]): MutationContext {
  return { tenantId: "t1", userId: "u1", userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("document.analyze", () => {
  it("is gated on reportAnalysis:create — the right to COMMISSION one, not to read one", () => {
    const { mutation } = build();
    expect(mutation.requiredPermission).toBe("reportAnalysis:create");
  });

  it("declares a preResolve, so the controller authorizes before any of this runs", () => {
    // ARCHITECTURE.md §15.1 rule 3. Everything expensive — the download, the
    // extraction, the provider call — is in that hook.
    const { mutation } = build();
    expect(typeof mutation.preResolve).toBe("function");
  });

  it("404s an unknown document without downloading anything", async () => {
    const { mutation, downloadDocumentBytes } = build({ document: null });
    await expect(mutation.preResolve!({ documentId: "gone" }, { tenantId: "t1", authUserId: "au1" })).rejects.toThrow(NotFoundException);
    expect(downloadDocumentBytes).not.toHaveBeenCalled();
  });

  it("refuses — and never spends a provider call — when no lens matches the caller", async () => {
    // The money property. A caller who can see the file but has no lens must
    // be turned away BEFORE the download and the completion.
    const { mutation, complete, downloadDocumentBytes } = build({ grants: ["project:read:tenant", "reportAnalysis:create:tenant"] });
    await expect(mutation.preResolve!({ documentId: "d1" }, { tenantId: "t1", authUserId: "au1" })).rejects.toThrow(ForbiddenException);
    expect(downloadDocumentBytes).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it("refuses a file type it cannot read, before downloading it", async () => {
    const { mutation, downloadDocumentBytes } = build({
      document: { id: "d1", name: "slides.pptx", mimeType: "application/vnd.ms-powerpoint", storagePath: "p/s", version: 1, projectId: "proj1" },
    });
    await expect(mutation.preResolve!({ documentId: "d1" }, { tenantId: "t1", authUserId: "au1" })).rejects.toThrow(BadRequestException);
    expect(downloadDocumentBytes).not.toHaveBeenCalled();
  });

  it("refuses a file with no readable text rather than sending an empty prompt", async () => {
    const { mutation, complete } = build({ bytes: "   " });
    await expect(mutation.preResolve!({ documentId: "d1" }, { tenantId: "t1", authUserId: "au1" })).rejects.toThrow(/no readable text/);
    expect(complete).not.toHaveBeenCalled();
  });

  it("returns the parsed analysis, tagged with the lens that produced it", async () => {
    const { mutation } = build();
    const pre = await mutation.preResolve!({ documentId: "d1" }, { tenantId: "t1", authUserId: "au1" });
    expect(pre.resolved.lens.key).toBe("course.classPerformance");
    expect(pre.summary).toContain("Two students");
    expect(pre.findings[0]).toMatchObject({ label: "Grace is behind", severity: "risk" });
    expect(pre.documentVersion).toBe(2);
  });

  describe("replies that aren't the JSON it asked for", () => {
    it("unwraps a ```json fence", async () => {
      const { mutation } = build({ reply: "```json\n" + GOOD_REPLY + "\n```" });
      const pre = await mutation.preResolve!({ documentId: "d1" }, { tenantId: "t1", authUserId: "au1" });
      expect(pre.summary).toContain("Two students");
    });

    it("unwraps an UNCLOSED fence — what the provider actually sends", async () => {
      // Observed live: Gemini opens ```json and never closes it.
      const { mutation } = build({ reply: "```json\n" + GOOD_REPLY });
      const pre = await mutation.preResolve!({ documentId: "d1" }, { tenantId: "t1", authUserId: "au1" });
      expect(pre.summary).toContain("Two students");
    });

    it("ignores prose wrapped around the object", async () => {
      const { mutation } = build({ reply: `Here is the analysis:\n${GOOD_REPLY}\nHope that helps.` });
      const pre = await mutation.preResolve!({ documentId: "d1" }, { tenantId: "t1", authUserId: "au1" });
      expect(pre.summary).toContain("Two students");
    });

    it("retries ONCE when the reply is cut off mid-JSON, and succeeds on the retry", async () => {
      // ⚠️ The real failure this exists for, and the reason it is a retry
      // rather than a bigger token budget: measurement showed ~500 output
      // tokens against a 2,500 limit, parsing fine at 2,500/8,000/16,000 —
      // the model just stops mid-array now and then.
      let n = 0;
      const { mutation, getCallCount } = build({
        reply: () => (++n === 1 ? '```json\n{"summary":"cut","findings":[{"label":"a","detail":"b",' : GOOD_REPLY),
      });
      const pre = await mutation.preResolve!({ documentId: "d1" }, { tenantId: "t1", authUserId: "au1" });
      expect(getCallCount()).toBe(2);
      expect(pre.summary).toContain("Two students");
    });

    it("gives up after the second failure instead of looping on a paid call", async () => {
      const { mutation, getCallCount } = build({ reply: "not json at all" });
      await expect(mutation.preResolve!({ documentId: "d1" }, { tenantId: "t1", authUserId: "au1" })).rejects.toThrow(BadRequestException);
      expect(getCallCount()).toBe(2);
    });

    it("includes a snippet of what came back, so a failure is diagnosable", async () => {
      const { mutation } = build({ reply: "I'm sorry, I can't help with that." });
      await expect(mutation.preResolve!({ documentId: "d1" }, { tenantId: "t1", authUserId: "au1" })).rejects.toThrow(/I'm sorry/);
    });

    it("drops malformed findings rather than storing nulls", async () => {
      const { mutation } = build({
        reply: JSON.stringify({
          summary: "ok",
          findings: [{ label: "", detail: "no label" }, { label: "good", detail: "kept", severity: "nonsense" }],
          suggestedActions: ["do a thing", "", 42],
        }),
      });
      const pre = await mutation.preResolve!({ documentId: "d1" }, { tenantId: "t1", authUserId: "au1" });
      expect(pre.findings).toHaveLength(1);
      // An unrecognised severity degrades to the harmless end, never to "risk".
      expect(pre.findings[0]).toMatchObject({ label: "good", severity: "info" });
      expect(pre.suggestedActions).toEqual(["do a thing"]);
    });

    it("refuses a reply with no summary at all", async () => {
      const { mutation } = build({ reply: JSON.stringify({ findings: [] }) });
      await expect(mutation.preResolve!({ documentId: "d1" }, { tenantId: "t1", authUserId: "au1" })).rejects.toThrow(/came back empty/);
    });
  });

  it("stores the analysis, logs it to the document's own activity feed, and audits it", async () => {
    const { mutation, tx } = build();
    const pre = await mutation.preResolve!({ documentId: "d1" }, { tenantId: "t1", authUserId: "au1" });
    await mutation.resolve({ documentId: "d1" }, ctx(), tx, pre);

    const created = (tx as unknown as { documentAnalysis: { create: jest.Mock } }).documentAnalysis.create.mock.calls[0]![0].data;
    expect(created).toMatchObject({ tenantId: "t1", documentId: "d1", lensKey: "course.classPerformance", documentVersion: 2, requestedById: "u1" });
    // One timeline, beside upload/replace/approval — not a history nobody
    // thinks to open.
    expect((tx as unknown as { documentActivity: { create: jest.Mock } }).documentActivity.create).toHaveBeenCalled();
    expect((tx as unknown as { auditLog: { create: jest.Mock } }).auditLog.create).toHaveBeenCalled();
  });
});
