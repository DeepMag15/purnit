import fs from "node:fs";
import path from "node:path";
import { loadBlueprintFixtures, resolveRolePermissions } from "./blueprint-fixtures";
import { collapsePermissions } from "../rbac/permission-collapse";
import { DEFAULT_DASHBOARD_WIDGET_KEYS } from "../modules/analytics/dashboard-defaults";

/**
 * Role-Based Workspaces, Stage B.
 *
 * `DEFAULT_DASHBOARD_WIDGET_KEYS` decides which widgets each role's dashboard
 * opens with. Two ways to get it silently wrong, both of which had actually
 * happened before this spec existed:
 *
 *  1. **A key that isn't a real metric.** `employeeProductivityScore` sat in
 *     the top slots of Company Admin, Executive and HR Manager and rendered
 *     nothing at all — there is no such metric.
 *  2. **A key the role cannot see.** Executive and HR Manager both listed
 *     `department.performanceLeaderboard` and `tasks.productivityLeaderboard`,
 *     which were granted to Company Admin only. Between that and the phantom
 *     key, each had *one* of their top four widgets actually render.
 *
 * Neither produces an error anywhere — the widget is simply absent and the
 * layout falls back. That is precisely why it needs a test rather than review.
 */

/** Real metric keys and their gates, read from the metric definitions. */
function loadMetrics(): { key: string; permission: string | null }[] {
  const root = path.resolve(__dirname, "../modules");
  const out: { key: string; permission: string | null }[] = [];
  for (const mod of fs.readdirSync(root)) {
    const dir = path.join(root, mod);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".metrics.ts"))) {
      const src = fs.readFileSync(path.join(dir, file), "utf8");
      const re = /key:\s*"([^"]+)"/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const window = src.slice(m.index, m.index + 900);
        out.push({ key: m[1]!, permission: window.match(/requiredPermission:\s*"([^"]+)"/)?.[1] ?? null });
      }
    }
  }
  return out;
}

const METRICS = loadMetrics();
const METRIC_KEYS = new Set(METRICS.map((m) => m.key));
const PERMISSION_OF = new Map(METRICS.map((m) => [m.key, m.permission]));
// Imported directly — the defaults now live in their own module rather than
// inside auth.service.ts, because the seeder needs them too (to re-sync
// existing tenants' role-level layouts, not just seed new ones).
const DEFAULTS = DEFAULT_DASHBOARD_WIDGET_KEYS;
const FIXTURES = loadBlueprintFixtures();

/** Which blueprint(s) define a given role, honouring an explicit industry. */
function blueprintsFor(entry: { blueprintRoleId: string; industry?: string }) {
  return Object.entries(FIXTURES).filter(
    ([name, bp]) =>
      (!entry.industry || entry.industry === name) && bp.roles.some((r) => r.id === entry.blueprintRoleId),
  );
}

describe("DEFAULT_DASHBOARD_WIDGET_KEYS", () => {
  it("is not empty", () => {
    expect(DEFAULTS.length).toBeGreaterThan(20);
  });

  it("only lists real, registered metric keys", () => {
    const phantom: string[] = [];
    for (const entry of DEFAULTS) {
      for (const key of entry.keys) {
        if (!METRIC_KEYS.has(key)) phantom.push(`${entry.blueprintRoleId}${entry.industry ? `(${entry.industry})` : ""} -> ${key}`);
      }
    }
    expect(phantom).toEqual([]);
  });

  it("only lists widgets each role can actually see", () => {
    const invisible: string[] = [];
    for (const entry of DEFAULTS) {
      for (const [domain, bp] of blueprintsFor(entry)) {
        const effective = collapsePermissions(resolveRolePermissions(bp.roles, entry.blueprintRoleId));
        for (const key of entry.keys) {
          const permission = PERMISSION_OF.get(key);
          if (!permission) continue; // ungated metric — visible to everyone
          const [resource, action] = permission.split(":");
          if (effective.has(resource!, action!) === null) {
            invisible.push(`${domain}/${entry.blueprintRoleId}: ${key} needs ${permission}`);
          }
        }
      }
    }
    expect(invisible).toEqual([]);
  });

  it("maps every entry to at least one real blueprint role", () => {
    const orphans = DEFAULTS.filter((e) => blueprintsFor(e).length === 0).map(
      (e) => `${e.blueprintRoleId}${e.industry ? `(${e.industry})` : ""}`,
    );
    expect(orphans).toEqual([]);
  });

  it("gives every role in every blueprint a default layout", () => {
    // A role without one falls back to auto-layout — alphabetical-ish order
    // with no sense of the job, which is the generic experience this work
    // exists to remove. Three IT roles were in this state.
    const missing: string[] = [];
    for (const [domain, bp] of Object.entries(FIXTURES)) {
      for (const role of bp.roles) {
        const has = DEFAULTS.some((e) => e.blueprintRoleId === role.id && (!e.industry || e.industry === domain));
        if (!has) missing.push(`${domain}/${role.id}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("resolves exactly one layout per role per blueprint", () => {
    // `role.admin` exists in all five domains with an industry-scoped entry
    // each; a duplicate would seed two DashboardLayout rows for one role.
    const dupes: string[] = [];
    for (const [domain, bp] of Object.entries(FIXTURES)) {
      for (const role of bp.roles) {
        const matches = DEFAULTS.filter((e) => e.blueprintRoleId === role.id && (!e.industry || e.industry === domain));
        if (matches.length > 1) dupes.push(`${domain}/${role.id} -> ${matches.length} entries`);
      }
    }
    expect(dupes).toEqual([]);
  });

  it("leads with a domain-appropriate widget for each Company Admin", () => {
    // A Hospital Administrator opening on "At-Risk Projects" is exactly the
    // generic experience this stage removes.
    const leadOf = (industry: string) =>
      DEFAULTS.find((e) => e.blueprintRoleId === "role.admin" && e.industry === industry)?.keys[0];
    expect(leadOf("Healthcare")).toMatch(/^patients\./);
    expect(leadOf("Education")).toMatch(/^students\./);
    expect(leadOf("Finance")).toMatch(/^invoices\./);
    expect(leadOf("Manufacturing")).toMatch(/^workOrders\./);
    expect(leadOf("IT")).toMatch(/^projects\./);
  });
});

describe("scope-twin differentiation", () => {
  /**
   * Practitioner/Senior Practitioner and Department Head/Executive/HR Manager
   * hold identical resource:action pairs and therefore identical navigation by
   * construction. Their workspaces are differentiated here instead — which
   * means these dashboards must genuinely differ, or the roles really are
   * interchangeable.
   */
  const keysOf = (roleId: string) => DEFAULTS.find((e) => e.blueprintRoleId === roleId && (!e.industry || e.industry === "IT"))?.keys ?? [];

  it.each([
    ["role.member", "role.senior-employee"],
    ["role.department-head", "role.executive"],
    ["role.department-head", "role.hr-manager"],
    ["role.executive", "role.hr-manager"],
  ])("%s and %s open on different dashboards", (a, b) => {
    expect(keysOf(a).join("|")).not.toEqual(keysOf(b).join("|"));
  });

  it.each([
    ["role.member", "role.senior-employee"],
    ["role.department-head", "role.executive"],
    ["role.department-head", "role.hr-manager"],
  ])("%s and %s differ within the first three widgets, not just at the tail", (a, b) => {
    // Differing only in position 6 would be a cosmetic difference nobody sees.
    expect(keysOf(a).slice(0, 3).join("|")).not.toEqual(keysOf(b).slice(0, 3).join("|"));
  });

  it("only Executive and Company Admin lead on the cross-department leaderboard", () => {
    // It is the widget that expresses Executive's wider scope; Department Head
    // cannot see it at all.
    expect(keysOf("role.executive")[0]).toBe("department.performanceLeaderboard");
    expect(keysOf("role.department-head")).not.toContain("department.performanceLeaderboard");
  });

  it("HR Manager leads with people metrics, not delivery metrics", () => {
    const first = keysOf("role.hr-manager").slice(0, 2);
    expect(first.every((k) => k.startsWith("attendance.") || k.startsWith("tasks.productivity"))).toBe(true);
    expect(keysOf("role.hr-manager")[0]).not.toMatch(/^projects\./);
  });
});
