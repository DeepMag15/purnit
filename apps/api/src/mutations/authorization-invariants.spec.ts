import fs from "node:fs";
import path from "node:path";
import { isKnownPermission } from "../rbac/permission-catalog";

/**
 * The permanent authorization invariants for Purnit.
 *
 * Purnit's security model is: **Domain + Role + Permissions decide what a user
 * can see and do, enforced server-side, and never by the UI.** A module that
 * quietly opts out of that model does not announce itself — it just ships. The
 * Stage E sweep found two that had, so the rules are pinned here rather than
 * left to review:
 *
 *   1. Every mutation and data source either declares a `requiredPermission`,
 *      or appears below with a stated reason why ownership/scope is the
 *      correct authorization instead. There is no third option, and no silent
 *      one. Adding a new ungated mutation fails this suite until someone
 *      writes down why.
 *   2. The lists are exact, not minimums — a stale entry fails too, so a
 *      mutation that later gains a real permission gate cannot leave a
 *      misleading "this is ownership-scoped" note behind.
 *   3. Every declared permission is a real one from `PERMISSION_CATALOG`, so a
 *      typo'd gate cannot silently become an ungated mutation.
 *
 * These are deliberately **not** "the 29 ungated mutations are fine" — that is
 * the claim, and it is verified live by the ownership sweep, which has a real
 * low-privilege user attempt each one against another user's resource. This
 * suite enforces that the *set* cannot grow without that scrutiny.
 */

// ---------------------------------------------------------------------------
// Load every registered definition, including the factory-created ones.
// ---------------------------------------------------------------------------
interface Def {
  name: string;
  requiredPermission?: string;
  preResolve?: unknown;
}

/** Definitions needing injected services are exported as `createXMutation(deps)`
 * factories; the factory only closes over its deps, so a permissive stub yields
 * the real definition. Without this, `user.invite`, `account.deleteSelf`,
 * `document.getFileUrl`, `meeting.getJoinInfo` and the whole billing and AI
 * sets are invisible here — which is exactly the blind spot that would make
 * this suite pass while proving nothing. */
const stub: unknown = new Proxy(function () {} as object, {
  get: () => stub,
  apply: () => stub,
  construct: () => stub as object,
});

function collect(suffix: string): Def[] {
  const root = path.join(__dirname, "..");
  const files: string[] = [];
  (function walk(d: string) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(suffix)) files.push(p);
    }
  })(root);

  const out: Def[] = [];
  for (const f of files) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(f) as Record<string, unknown>;
    const candidates: unknown[] = [];
    for (const v of Object.values(mod)) {
      if (typeof v === "function" && /^create.*(Mutations?|DataSources?)$/.test(v.name)) {
        try {
          const r = (v as (...a: unknown[]) => unknown)(stub, stub, stub, stub, stub, stub);
          if (Array.isArray(r)) candidates.push(...r);
          else candidates.push(r);
        } catch {
          // A factory that cannot be constructed from stubs is reported by the
          // coverage assertion below rather than silently skipped.
        }
        continue;
      }
      candidates.push(v);
    }
    for (const v of candidates) {
      const d = v as { name?: unknown; resolve?: unknown; inputSchema?: unknown; paramsSchema?: unknown; requiredPermission?: unknown; preResolve?: unknown };
      if (!d || typeof d !== "object") continue;
      if (typeof d.name !== "string" || typeof d.resolve !== "function") continue;
      if (!d.inputSchema && !d.paramsSchema) continue;
      out.push({
        name: d.name,
        requiredPermission: typeof d.requiredPermission === "string" ? d.requiredPermission : undefined,
        preResolve: d.preResolve,
      });
    }
  }
  return out;
}

const MUTATIONS = collect(".mutations.ts");
const DATA_SOURCES = collect(".data-sources.ts");

// ---------------------------------------------------------------------------
// The declared exceptions. Each is authorized by ownership, membership or
// self-scope rather than by a permission triple — and each says why.
// ---------------------------------------------------------------------------

/** Gating any of these on a permission would be wrong, not merely unnecessary:
 * gating `account.deleteSelf` would let an admin revoke someone's ability to
 * leave; gating `notification.markRead` would gate you out of your own inbox. */
const OWNERSHIP_SCOPED_MUTATIONS: Record<string, string> = {
  // Acts only on the caller's own row/session — ownership IS the authorization.
  "account.deleteSelf": "acts only on the caller's own account",
  "user.updateDigestPreference": "the caller's own notification preference",
  "presence.heartbeat": "the caller's own presence row",
  "notification.markRead": "verified to be the caller's own notification",
  "notification.markAllRead": "takes no target at all — ctx.userId only",
  "dashboardLayout.save": "writes userId: ctx.userId, no cross-user target exists",
  "dashboardLayout.reset": "same — the caller's own layout",

  // Author/organizer ownership, checked inside resolve().
  "announcement.delete": "author-only (authorId !== ctx.userId is refused)",
  "calendarEvent.delete": "author-only",
  "message.delete": "author-only",
  "comment.delete": "author-only",
  "meeting.cancel": "organizer-only",
  "leave.cancel": "the requester's own leave request",
  // Submitting is an act of ownership, not authority: only the task's own
  // assignee may submit it. A permission triple cannot express that — every
  // scope wide enough to let a Lead submit for someone would also let them
  // submit their own work as though it had been reviewed.
  "task.submitForReview": "assignee-only; task.review holds the authority half",

  // The document half of the same split. Asking someone to check your own
  // work is ownership; document:approve is the authority half and refuses the
  // uploader outright.
  "document.requestApproval": "uploader-only; document.setApprovalStatus holds the authority half",

  // Education. Handing in your own work is ownership: the caller must BE the
  // enrolled student, which no scope can express — any scope wide enough to
  // let a student submit would let them submit for a classmate.
  "assignment.submit": "enrolled-student-only; the teacher reviews via task.review",
  "assignment.submissionTarget": "enrolled-student-only; returns the caller's own submissions project id",

  // Conversation/meeting membership, checked inside resolve().
  "conversation.createChannel": "creation; the caller becomes the owner",
  "conversation.createDm": "creation between the caller and one other user",
  "conversation.addMember": "requires the caller to be a member already",
  "conversation.archive": "membership-checked",
  "conversation.markRead": "membership-checked; marks the caller's own read state",
  "message.send": "requires conversation membership",
  "meeting.addParticipant": "organizer/participant-checked",
  "meeting.removeParticipant": "organizer/participant-checked",
  "meeting.getJoinInfo": "assertMeetingParticipant — a non-participant gets no token",

  // Scope-checked against the target entity the caller must already be able to see.
  "comment.create": "assertCommentTargetInScope on the parent entity",
  "document.getFileUrl": "assertProjectVisible before any signed URL is minted",

  // AI: the conversation must belong to the caller; checked before any
  // provider call, and before any target mutation's own preResolve.
  "aiConversation.create": "creation, owned by the caller",
  "aiConversation.archive": "the caller's own conversation",
  "aiMessage.send": "conversation ownership checked before the model is called",
  "aiToolCall.confirm": "proposal ownership + the TARGET's own permission is re-checked",
  "aiToolCall.reply": "proposal ownership checked before the model is called",
};

/** Read-side equivalents. The `*.capabilities` sources are the large group:
 * each returns booleans about the CALLER'S OWN grants, so gating one on the
 * grant it reports would be circular. */
const OWNERSHIP_SCOPED_DATA_SOURCES: Record<string, string> = {
  // Self-reporting capability probes.
  "analytics.capabilities": "reports the caller's own grants",
  "appointments.capabilities": "reports the caller's own grants",
  "attendance.capabilities": "reports the caller's own grants",
  "calendar.capabilities": "reports the caller's own grants",
  "clients.capabilities": "reports the caller's own grants",
  "courses.capabilities": "reports the caller's own grants",
  "crm.capabilities": "reports the caller's own grants",
  "hr.capabilities": "reports the caller's own grants",
  "inventoryItems.capabilities": "reports the caller's own grants",
  "invoices.capabilities": "reports the caller's own grants",
  "meetings.capabilities": "reports the caller's own grants",
  "patients.capabilities": "reports the caller's own grants",
  "purchaseOrders.capabilities": "reports the caller's own grants",
  "rolesPermissions.capabilities": "reports the caller's own grants",
  "settings.capabilities": "reports the caller's own grants",
  "students.capabilities": "reports the caller's own grants",
  "suppliers.capabilities": "reports the caller's own grants",
  "workOrders.capabilities": "reports the caller's own grants",
  "leave.capabilities": "reports the caller's own grants",

  // Ownership-scoped to the caller.
  "account.export": "the caller's own data only — deliberately not what they can see",
  "notifications.list": "filtered to ctx.userId",
  "notifications.unreadCount": "filtered to ctx.userId",
  "dashboardLayout.get": "the caller's own layout",
  "aiConversations.list": "the caller's own conversations",
  "aiConversation.messages": "ownership-checked conversation",
  "conversations.list": "the caller's own conversations",
  "messages.list": "membership-checked conversation",

  // Scope resolved inside the resolver rather than declaratively — the
  // module's own `xWhere(ctx, …)` returns null (→404) without read access,
  // so these are gated, just not by a static triple.
  "announcements.list": "announcementsWhere resolves visibility by scope",
  "meetings.list": "meetingsWhere resolves visibility by scope",
  "comments.list": "assertCommentTargetInScope on the parent entity",
  "clients.detail": "clientsWhere returns null without read access",
  "courses.detail": "coursesWhere returns null without read access",
  "contact.detail": "contactsWhere returns null without read access",
  "task.detail": "tasksWhere returns null without read access",
  "project.detail": "projectsWhere returns null without read access",
  // Reaching a project's people is exactly as permitted as reaching its
  // documents — the same question documents.list asks, and the reason this
  // exists at all is that project.detail now excludes backing projects.
  "project.members": "projectsWhere on the project itself; 404 without access",
  "students.detail": "studentsWhere returns null without read access",
  "invoices.detail": "invoicesWhere returns null without read access",
  "inventoryItems.detail": "inventoryItemsWhere returns null without read access",
  "purchaseOrders.detail": "purchaseOrdersWhere returns null without read access",
  "suppliers.detail": "suppliersWhere returns null without read access",
  "workOrders.detail": "workOrdersWhere returns null without read access",
  "document.detail": "assertProjectVisible on the parent project",
  "documents.list": "assertProjectVisible on the parent project",
  // Reading an analysis is governed by reaching the document it describes, so
  // it can never be more reachable than the report itself. Deliberately looser
  // than `reportAnalysis:create`: producing insight costs money and carries
  // authority, reading one a colleague already ran does not.
  "document.analyses": "assertProjectVisible on the analysed document's project",
  "calendar.list": "meetingsWhere/scope resolution per underlying source",

  // Gated per row rather than per source — a static triple would be weaker.
  "analytics.trend": "checks each METRIC's own requiredPermission, then its scope",

  // Student portal. The PAGES are gated on `studentPortal:read`; these sources
  // are bounded one layer deeper, by `requireOwnStudent` resolving the
  // caller's own Student row from ctx.userId. None takes an id saying whose
  // data to return, so there is nothing to tamper with — the same shape as
  // `account.export`.
  "myCourses.list": "requireOwnStudent — the caller's own enrolments, no target parameter exists",
  "myAssignments.list": "requireOwnStudent — assignments in the caller's own courses only",
  "myProgress.get": "requireOwnStudent — the caller's own grades and attendance",
  "myCourseMaterials.list": "requireOwnStudent — materials for the caller's own enrolled courses only",
  "studentPortal.capabilities": "reports whether the caller's own login is linked to a student record",

  // Tenant-scoped reference data, not user data.
  "leaveTypes.list": "the tenant's own leave-type list",
  "presence.list": "online/offline status for users the caller already sees",
  "channels.list": "public, non-member channels only — a joinable-channel directory",
};

describe("authorization invariants", () => {
  it("finds the whole registry, factories included", () => {
    // A number that only ever moves deliberately. If a refactor breaks the
    // factory-stub path, this drops and every assertion below turns vacuous.
    expect(MUTATIONS.length).toBeGreaterThanOrEqual(134);
    expect(DATA_SOURCES.length).toBeGreaterThanOrEqual(94);
    expect(MUTATIONS.map((m) => m.name)).toContain("billing.cancelSubscription");
    expect(MUTATIONS.map((m) => m.name)).toContain("account.deleteSelf");
  });

  it("every mutation is either permission-gated or a declared ownership-scoped exception", () => {
    const ungated = MUTATIONS.filter((m) => !m.requiredPermission).map((m) => m.name).sort();
    expect(ungated).toEqual(Object.keys(OWNERSHIP_SCOPED_MUTATIONS).sort());
  });

  it("every data source is either permission-gated or a declared ownership-scoped exception", () => {
    const ungated = DATA_SOURCES.filter((d) => !d.requiredPermission).map((d) => d.name).sort();
    expect(ungated).toEqual(Object.keys(OWNERSHIP_SCOPED_DATA_SOURCES).sort());
  });

  it("every declared permission exists in the catalog", () => {
    const unknown: string[] = [];
    for (const d of [...MUTATIONS, ...DATA_SOURCES]) {
      if (!d.requiredPermission) continue;
      const [resource, action] = d.requiredPermission.split(":");
      if (!isKnownPermission(resource!, action!)) unknown.push(`${d.name} -> ${d.requiredPermission}`);
    }
    // A typo'd gate is worse than no gate: it reads as protected in review and
    // behaves as protected in tests, while `effective.has()` never matches.
    expect(unknown).toEqual([]);
  });

  it("every exception carries a stated reason", () => {
    const blank = [...Object.entries(OWNERSHIP_SCOPED_MUTATIONS), ...Object.entries(OWNERSHIP_SCOPED_DATA_SOURCES)]
      .filter(([, reason]) => reason.trim().length < 10)
      .map(([name]) => name);
    expect(blank).toEqual([]);
  });

  it("no mutation with a preResolve is left for the controller to authorize implicitly", () => {
    // `preResolve` runs before the main transaction, so `MutationsController`
    // authorizes such mutations up front (see its own comment). This records
    // which mutations depend on that pre-flight, so the list moving is a
    // deliberate, visible act rather than a silent one.
    const withPreResolve = MUTATIONS.filter((m) => m.preResolve).map((m) => m.name).sort();
    expect(withPreResolve).toEqual(
      [
        "aiMessage.send",
        "aiToolCall.confirm",
        "aiToolCall.reply",
        "billing.cancelSubscription",
        "billing.changePlan",
        "billing.createCheckoutSession",
        "billing.createPortalSession",
        "billing.resumeSubscription",
        "billing.updateSeats",
        // Contextual Reporting: downloads the file, extracts its text and
        // calls the AI provider — all of it outside the transaction, all of
        // it after the controller's pre-flight authorization.
        "document.analyze",
        "tenant.closeWorkspace",
      ].sort(),
    );
  });
});
