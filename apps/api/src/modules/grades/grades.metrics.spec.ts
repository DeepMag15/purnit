import { collapsePermissions } from "../../rbac/permission-collapse";
import { averageGradePercentMetric, gradesRecordedCountMetric } from "./grades.metrics";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[]): DataSourceContext {
  return { tenantId: "t1", userId: "u1", userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("grades metrics", () => {
  describe("averageGradePercentMetric", () => {
    it("requires grade:read and formats as percent", () => {
      expect(averageGradePercentMetric.requiredPermission).toBe("grade:read");
      expect(averageGradePercentMetric.format).toBe("percent");
    });

    it("computeLive averages score/maxScore per row, scaled to a 0-100 percent", async () => {
      const tx = {
        grade: {
          findMany: jest.fn().mockResolvedValue([
            { score: 80, assignment: { maxScore: 100 } }, // 80%
            { score: 45, assignment: { maxScore: 50 } }, // 90%
          ]),
        },
      } as unknown as PrismaTx;
      const value = await averageGradePercentMetric.computeLive(context(["grade:read:tenant"]), tx);
      expect(value).toBe(85); // (80 + 90) / 2
      const call = (tx as unknown as { grade: { findMany: jest.Mock } }).grade.findMany.mock.calls[0][0];
      expect(call.where).toMatchObject({ tenantId: "t1", score: { not: null } });
    });

    it("computeLive returns 0 when no grades are recorded yet", async () => {
      const tx = { grade: { findMany: jest.fn().mockResolvedValue([]) } } as unknown as PrismaTx;
      expect(await averageGradePercentMetric.computeLive(context(["grade:read:tenant"]), tx)).toBe(0);
    });

    it("computeLive returns 0 with no grade:read grant (e.g. Registrar)", async () => {
      const tx = { grade: { findMany: jest.fn() } } as unknown as PrismaTx;
      expect(await averageGradePercentMetric.computeLive(context(["enrollment:read:tenant"]), tx)).toBe(0);
      expect((tx as unknown as { grade: { findMany: jest.Mock } }).grade.findMany).not.toHaveBeenCalled();
    });
  });

  describe("gradesRecordedCountMetric", () => {
    it("requires grade:read", () => {
      expect(gradesRecordedCountMetric.requiredPermission).toBe("grade:read");
    });

    it("computeLive counts only non-null-score rows via gradesWhere", async () => {
      const tx = { grade: { count: jest.fn().mockResolvedValue(6) } } as unknown as PrismaTx;
      const value = await gradesRecordedCountMetric.computeLive(context(["grade:read:tenant"]), tx);
      expect(value).toBe(6);
      const call = (tx as unknown as { grade: { count: jest.Mock } }).grade.count.mock.calls[0][0];
      expect(call.where).toMatchObject({ tenantId: "t1", score: { not: null } });
    });

    it("computeLive returns 0 with no grade:read grant", async () => {
      const tx = { grade: { count: jest.fn() } } as unknown as PrismaTx;
      expect(await gradesRecordedCountMetric.computeLive(context([]), tx)).toBe(0);
      expect((tx as unknown as { grade: { count: jest.Mock } }).grade.count).not.toHaveBeenCalled();
    });
  });
});
