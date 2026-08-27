import { employeeProductivityScoreMetric } from "./analytics.composites";

describe("employeeProductivityScoreMetric", () => {
  it("is a composite averaging tasks.completionRate and attendance.rateThisMonth", () => {
    expect(employeeProductivityScoreMetric.kind).toBe("composite");
    expect(employeeProductivityScoreMetric.ingredients).toEqual(["tasks.completionRate", "attendance.rateThisMonth"]);
  });

  it("combine() rounds the average of both ingredient values", () => {
    expect(employeeProductivityScoreMetric.combine({ "tasks.completionRate": 80, "attendance.rateThisMonth": 60 })).toBe(70);
    expect(employeeProductivityScoreMetric.combine({ "tasks.completionRate": 75, "attendance.rateThisMonth": 76 })).toBe(76); // 75.5 rounds up
  });

  it("combine() treats a missing ingredient value as 0, not a crash", () => {
    expect(employeeProductivityScoreMetric.combine({ "tasks.completionRate": 100 })).toBe(50);
    expect(employeeProductivityScoreMetric.combine({})).toBe(0);
  });
});
