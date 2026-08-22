import { z } from "zod";
import { buildToolDeclarations } from "./build-tool-declarations";
import { collapsePermissions } from "../../rbac/permission-collapse";
import type { MutationRegistry } from "../../mutations/mutation-registry.service";

function fakeRegistry(defs: Record<string, unknown>): MutationRegistry {
  return { get: (name: string) => defs[name] } as unknown as MutationRegistry;
}

describe("buildToolDeclarations", () => {
  it("skips an allowlist entry that doesn't resolve to a registered mutation", () => {
    const registry = fakeRegistry({});
    const declarations = buildToolDeclarations(registry, collapsePermissions(["task:create:tenant"]));
    // "task.create" is allowlisted but not registered in this fake — must
    // not appear, and must not throw (that's the boot assertion's job).
    expect(declarations.find((d) => d.name === "task.create")).toBeUndefined();
  });

  it("skips an allowlisted mutation the caller's effective permissions don't grant", () => {
    const registry = fakeRegistry({
      "task.create": { name: "task.create", inputSchema: z.object({ title: z.string() }), requiredPermission: "task:create" },
    });
    const declarations = buildToolDeclarations(registry, collapsePermissions([]));
    expect(declarations).toHaveLength(0);
  });

  it("includes an allowlisted, registered mutation the caller can call, with a real JSON-Schema inputSchema", () => {
    const registry = fakeRegistry({
      "task.create": {
        name: "task.create",
        inputSchema: z.object({ title: z.string().min(1), projectId: z.string() }),
        requiredPermission: "task:create",
      },
    });
    const declarations = buildToolDeclarations(registry, collapsePermissions(["task:create:tenant"]));
    const taskCreate = declarations.find((d) => d.name === "task.create");
    expect(taskCreate).toMatchObject({ name: "task.create", description: "Create a new task in a project." });
    expect(taskCreate!.inputSchema).toMatchObject({
      type: "object",
      properties: { title: { type: "string" }, projectId: { type: "string" } },
      required: ["title", "projectId"],
    });
  });

  it("includes a mutation with no requiredPermission at all (ownership-gated) regardless of grants", () => {
    const registry = fakeRegistry({
      "message.send": { name: "message.send", inputSchema: z.object({ conversationId: z.string(), content: z.string() }) },
    });
    const declarations = buildToolDeclarations(registry, collapsePermissions([]));
    expect(declarations.find((d) => d.name === "message.send")).toBeDefined();
  });

  // Regression — found live during Phase D's own verification: zod v4's
  // toJSONSchema() throws by default on a raw z.coerce.date()/z.date() field
  // ("Date cannot be represented in JSON Schema"), which crashed this
  // function (and therefore the whole aiMessage.send call) for every caller,
  // since calendarEvent:create:own is a universal floor permission. Real
  // allowlisted mutations with this exact shape: leave.submit,
  // calendarEvent.create, meeting.create.
  it("does not throw for an allowlisted mutation whose schema has a z.coerce.date() field", () => {
    const registry = fakeRegistry({
      "leave.submit": {
        name: "leave.submit",
        inputSchema: z.object({ leaveTypeId: z.string(), startDate: z.coerce.date(), endDate: z.coerce.date(), reason: z.string().optional() }),
        requiredPermission: "leave:create",
      },
    });
    expect(() => buildToolDeclarations(registry, collapsePermissions(["leave:create:tenant"]))).not.toThrow();
    const declarations = buildToolDeclarations(registry, collapsePermissions(["leave:create:tenant"]));
    const leaveSubmit = declarations.find((d) => d.name === "leave.submit");
    expect(leaveSubmit).toBeDefined();
    expect((leaveSubmit!.inputSchema as any).properties.leaveTypeId).toMatchObject({ type: "string" });
  });
});
