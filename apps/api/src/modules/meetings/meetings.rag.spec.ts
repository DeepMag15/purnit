import { meetingRagHandler } from "./meetings.rag";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import { collapsePermissions } from "../../rbac/permission-collapse";

function ctx(grants: string[] = ["meeting:read:tenant"]) {
  return { tenantId: "t1", userId: "u1", userDepartmentId: null, effective: collapsePermissions(grants) } satisfies DataSourceContext;
}

describe("meetingRagHandler", () => {
  it("has sourceType 'meeting'", () => {
    expect(meetingRagHandler.sourceType).toBe("meeting");
  });

  describe("checkVisibilityAndGetName", () => {
    it("returns null when the meeting is gone", async () => {
      const tx = { meeting: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
      expect(await meetingRagHandler.checkVisibilityAndGetName(tx, ctx(), "m1")).toBeNull();
    });

    it("returns the title when in scope", async () => {
      const findFirst = jest.fn().mockResolvedValue({ id: "m1", title: "Standup" });
      const tx = { meeting: { findFirst } } as unknown as PrismaTx;
      expect(await meetingRagHandler.checkVisibilityAndGetName(tx, ctx(), "m1")).toBe("Standup");
    });

    it("returns null when out of scope for a meeting the actor didn't organize/attend", async () => {
      const tx = {
        meeting: { findFirst: jest.fn().mockImplementation(() => Promise.resolve({ id: "m1", title: "Standup" })) },
      } as unknown as PrismaTx;
      // No grant at all — `meetingsWhere` still returns the participant/organizer
      // floor, but findFirst against it (second call) resolving to a mismatched
      // shape below simulates "not in that floor".
      (tx as unknown as { meeting: { findFirst: jest.Mock } }).meeting.findFirst
        .mockResolvedValueOnce({ id: "m1", title: "Standup" }) // existence check
        .mockResolvedValueOnce(null); // scope check misses
      expect(await meetingRagHandler.checkVisibilityAndGetName(tx, ctx([]), "m1")).toBeNull();
    });
  });

  describe("checkVisibilityAndGetNames (AI Assistant Phase F — batch)", () => {
    it("returns a Map with only the meetings findMany actually returned (already RBAC-scoped)", async () => {
      const findMany = jest.fn().mockResolvedValue([{ id: "m1", title: "Standup" }]);
      const tx = { meeting: { findMany } } as unknown as PrismaTx;

      const result = await meetingRagHandler.checkVisibilityAndGetNames!(tx, ctx(), ["m1", "m2"]);

      expect(result).toEqual(new Map([["m1", "Standup"]]));
      expect(findMany.mock.calls[0]![0].where).toMatchObject({ id: { in: ["m1", "m2"] } });
    });

    it("returns an empty Map when none of the candidates fall inside the actor's organizer/participant floor", async () => {
      const tx = { meeting: { findMany: jest.fn().mockResolvedValue([]) } } as unknown as PrismaTx;
      const result = await meetingRagHandler.checkVisibilityAndGetNames!(tx, ctx([]), ["m1"]);
      expect(result).toEqual(new Map());
    });
  });

  describe("extractText", () => {
    it("returns null when the meeting is gone", async () => {
      const tx = { meeting: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
      expect(await meetingRagHandler.extractText(tx, "t1", "m1")).toBeNull();
    });

    it("composes title + description", async () => {
      const tx = { meeting: { findFirst: jest.fn().mockResolvedValue({ title: "Standup", description: "Daily sync" }) } } as unknown as PrismaTx;
      expect(await meetingRagHandler.extractText(tx, "t1", "m1")).toBe("Standup\nDaily sync");
    });
  });
});
