import { BlueprintDefinitionSchema, type NavItem } from "@purnit/manifest-schema";
import { loadBlueprintFixtures, resolveRolePermissions, type BlueprintFixture } from "./blueprint-fixtures";
import { pruneNavItems } from "./permission-pruner";
import { collapsePermissions } from "../rbac/permission-collapse";
import { isKnownPermission } from "../rbac/permission-catalog";

/**
 * Role-Based Workspaces, Stage A.
 *
 * `seed.ts` validates every blueprint against `BlueprintDefinitionSchema` at
 * seed time, so a malformed blueprint was previously only caught by running
 * the seeder against a live database. These tests run that same validation —
 * plus the role-visibility invariants this whole design rests on — in CI,
 * with no database.
 */

const FIXTURES = loadBlueprintFixtures();
const BLUEPRINTS = Object.entries(FIXTURES);

function flattenLeaves(items: NavItem[], acc: NavItem[] = []): NavItem[] {
  for (const i of items) {
    if (i.pageId) acc.push(i);
    if (i.children) flattenLeaves(i.children, acc);
  }
  return acc;
}

/** The sidebar a role actually receives, as ids. */
function navFor(bp: BlueprintFixture, roleId: string): string[] {
  const effective = collapsePermissions(resolveRolePermissions(bp.roles, roleId));
  return flattenLeaves(pruneNavItems(bp.navigation as NavItem[], effective)).map((n) => n.id!);
}

describe.each(BLUEPRINTS)("%s blueprint", (_name, bp) => {
  it("satisfies BlueprintDefinitionSchema", () => {
    expect(() => BlueprintDefinitionSchema.parse(bp)).not.toThrow();
  });

  it("references only permissions that exist in the catalog", () => {
    // A nav item gated on a typo'd permission is invisible to EVERYONE,
    // forever, silently — the worst failure mode of permission-based nav.
    const unknown: string[] = [];
    const check = (items: NavItem[]) => {
      for (const i of items) {
        if (i.requiredPermission) {
          const [resource, action] = i.requiredPermission.split(":");
          if (!isKnownPermission(resource!, action!)) unknown.push(`${i.id} -> ${i.requiredPermission}`);
        }
        if (i.children) check(i.children);
      }
    };
    check(bp.navigation as NavItem[]);
    expect(unknown).toEqual([]);
  });

  it("points every nav item at a page that exists", () => {
    const pages = Object.keys(bp.pages ?? {});
    const dangling = flattenLeaves(bp.navigation as NavItem[])
      .filter((n) => !pages.includes(n.pageId!))
      .map((n) => `${n.id} -> ${n.pageId}`);
    expect(dangling).toEqual([]);
  });

  it("keeps each page's gate identical to its nav item's", () => {
    // ARCHITECTURE.md §6.9: a page gated more strictly than its nav item is
    // unreachable when linked; a looser one reopens the direct-fetch gap that
    // section exists to close.
    const mismatches: string[] = [];
    for (const nav of flattenLeaves(bp.navigation as NavItem[])) {
      const page = bp.pages[nav.pageId!];
      if (!page) continue;
      if ((page.requiredPermission ?? null) !== (nav.requiredPermission ?? null)) {
        mismatches.push(`${nav.pageId}: page=${page.requiredPermission ?? "none"} nav=${nav.requiredPermission ?? "none"}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("never gates the default dashboard", () => {
    // compileWorkspace has no graceful fallback if the default page is pruned.
    expect(bp.pages[bp.dashboards.default]?.requiredPermission).toBeUndefined();
  });

  it("gives the most junior role a materially smaller workspace than the most senior", () => {
    const sizes = bp.roles.map((r) => navFor(bp, r.id).length);
    // Before Stage A this ratio was 63-77% — the junior workspace was nearly
    // the senior one. The point of the change is that it is now genuinely
    // smaller, not merely missing an admin link or two.
    expect(Math.min(...sizes) / Math.max(...sizes)).toBeLessThan(0.75);
  });

  it("prunes an empty group away rather than leaving a dangling header", () => {
    for (const role of bp.roles) {
      const effective = collapsePermissions(resolveRolePermissions(bp.roles, role.id));
      const pruned = pruneNavItems(bp.navigation as NavItem[], effective);
      expect(pruned.filter((i) => !i.pageId && (i.children?.length ?? 0) === 0)).toEqual([]);
    }
  });

  it("gates every nav item that is not deliberately universal", () => {
    // The audit found 7-8 ungated items per blueprint, which is why juniors
    // and admins converged. This pins the allowed exceptions so a future
    // ungated item is a deliberate decision, not an oversight.
    const UNIVERSAL = new Set(["nav.dashboard", "nav.chat", "nav.meetings", "nav.announcements", "nav.calendar", "nav.leave"]);
    const ungated = flattenLeaves(bp.navigation as NavItem[])
      .filter((n) => !n.requiredPermission && !UNIVERSAL.has(n.id!))
      .map((n) => n.id);
    expect(ungated).toEqual([]);
  });
});

describe("scope-driven data bindings (Stage C)", () => {
  /** Every `bind` in a page tree, with the page it belongs to. */
  function bindings(bp: BlueprintFixture): { pageId: string; nodeId?: string; source: string; params: Record<string, unknown> }[] {
    const out: { pageId: string; nodeId?: string; source: string; params: Record<string, unknown> }[] = [];
    const walk = (node: Record<string, unknown>, pageId: string) => {
      const bind = node.bind as { source?: string; params?: Record<string, unknown> } | undefined;
      if (bind?.source) out.push({ pageId, nodeId: node.id as string, source: bind.source, params: bind.params ?? {} });
      for (const child of (node.children as Record<string, unknown>[]) ?? []) walk(child, pageId);
    };
    for (const [pageId, page] of Object.entries(bp.pages)) walk(page as unknown as Record<string, unknown>, pageId);
    return out;
  }

  /**
   * A module's own page must not pin the caller's identity into its query.
   *
   * `tasksWhere` already derives the right rows from the actor's scope — "own"
   * self-filters, "team"/"department" widen to the group. Binding
   * `assigneeId: { ref: "user.id" }` on `page.tasks` overrode that and pinned
   * the page to "assigned to me" for every role, so a Lead, Manager,
   * Department Head or Company Admin could not see their team's tasks there
   * at all. Removing it changed nothing for junior roles and restored the
   * page for everyone above them.
   */
  it.each(BLUEPRINTS)("%s: page.tasks does not override scope with a self filter", (_name, bp) => {
    const taskPage = bindings(bp).filter((b) => b.pageId === "page.tasks" && b.source === "tasks.list");
    for (const b of taskPage) {
      expect({ page: b.pageId, params: Object.keys(b.params) }).toEqual({ page: "page.tasks", params: [] });
    }
  });

  it.each(BLUEPRINTS)("%s: no module page pins user.id into its list query", (_name, bp) => {
    const offenders = bindings(bp)
      // The dashboard is exempt by design: its TaskList and "My Open Tasks"
      // KpiCard genuinely mean "mine", and sit beside org-level widgets.
      .filter((b) => b.pageId !== "page.dashboard")
      .filter((b) => JSON.stringify(b.params).includes('"user.id"'))
      .map((b) => `${b.pageId}/${b.nodeId} -> ${b.source}`);
    expect(offenders).toEqual([]);
  });

  it("the dashboard still scopes its personal task widgets to the signed-in user", () => {
    // The other half of the rule: removing the self-filter from module pages
    // must not have stripped it from the widgets that are supposed to be
    // personal.
    const personal = bindings(FIXTURES.IT!)
      .filter((b) => b.pageId === "page.dashboard" && b.source.startsWith("tasks."))
      .filter((b) => JSON.stringify(b.params).includes('"user.id"'));
    expect(personal.length).toBeGreaterThan(0);
  });
});

describe("role differentiation", () => {
  /**
   * The audit found 11 of 25 roles had a navigation twin — Doctor, Nurse and
   * Receptionist opened a character-for-character identical sidebar.
   *
   * The pairs deliberately NOT asserted here (IT's Practitioner/Senior
   * Practitioner, and Department Head/Executive/HR Manager) differ only in
   * permission *scope*, not in which resources they can act on. Identical
   * navigation is correct for them; their difference shows up in the rows
   * inside each module and in their dashboards.
   */
  const MUST_DIFFER: [string, string, string][] = [
    ["Healthcare", "role.doctor", "role.receptionist"],
    ["Healthcare", "role.nurse", "role.receptionist"],
    ["Healthcare", "role.doctor", "role.nurse"],
    ["Education", "role.teacher", "role.registrar"],
    ["Education", "role.teacher", "role.teaching-assistant"],
    ["Finance", "role.accountant", "role.billing-clerk"],
    ["Finance", "role.sales-rep", "role.billing-clerk"],
    ["Manufacturing", "role.production-planner", "role.warehouse-staff"],
    ["Manufacturing", "role.procurement-officer", "role.warehouse-staff"],
    ["IT", "role.intern", "role.member"],
    ["IT", "role.team-lead", "role.member"],
  ];

  it.each(MUST_DIFFER)("%s: %s and %s get different navigation", (domain, roleA, roleB) => {
    const bp = FIXTURES[domain]!;
    expect(navFor(bp, roleA).join("|")).not.toEqual(navFor(bp, roleB).join("|"));
  });

  it("a Healthcare Receptionist gets no Care Tasks item", () => {
    expect(navFor(FIXTURES.Healthcare!, "role.receptionist")).not.toContain("nav.tasks");
  });

  it("a Healthcare Nurse does get Care Tasks", () => {
    expect(navFor(FIXTURES.Healthcare!, "role.nurse")).toContain("nav.tasks");
  });

  const NO_ANALYTICS: [string, string][] = [
    ["IT", "role.intern"],
    ["IT", "role.member"],
    ["Healthcare", "role.receptionist"],
    ["Healthcare", "role.nurse"],
    ["Education", "role.teaching-assistant"],
    ["Finance", "role.billing-clerk"],
    ["Manufacturing", "role.warehouse-staff"],
  ];
  it.each(NO_ANALYTICS)("%s: %s cannot open Analytics", (domain, roleId) => {
    expect(navFor(FIXTURES[domain]!, roleId)).not.toContain("nav.analytics");
  });

  const HAS_ANALYTICS: [string, string][] = [
    ["IT", "role.team-lead"],
    ["IT", "role.admin"],
    ["Healthcare", "role.doctor"],
    ["Education", "role.teacher"],
    ["Finance", "role.accountant"],
    ["Manufacturing", "role.procurement-officer"],
  ];
  it.each(HAS_ANALYTICS)("%s: %s can open Analytics", (domain, roleId) => {
    expect(navFor(FIXTURES[domain]!, roleId)).toContain("nav.analytics");
  });

  it("only Company Admin reaches the Administration group", () => {
    for (const [domain, bp] of BLUEPRINTS) {
      for (const role of bp.roles) {
        const nav = navFor(bp, role.id);
        const hasAdmin = nav.includes("nav.roles-permissions") || nav.includes("nav.audit-logs") || nav.includes("nav.settings");
        if (role.id !== "role.admin") {
          expect({ domain, role: role.id, hasAdmin }).toEqual({ domain, role: role.id, hasAdmin: false });
        }
      }
    }
  });
});
