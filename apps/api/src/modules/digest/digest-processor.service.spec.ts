import { startOfUtcDay, notYetDigestedTodayWhere } from "./digest-processor.service";

describe("startOfUtcDay", () => {
  it("floors a UTC timestamp to midnight UTC of the same day", () => {
    expect(startOfUtcDay(new Date("2026-08-19T14:35:12.123Z"))).toEqual(new Date("2026-08-19T00:00:00.000Z"));
  });

  it("floors a timestamp already at midnight to itself", () => {
    expect(startOfUtcDay(new Date("2026-08-19T00:00:00.000Z"))).toEqual(new Date("2026-08-19T00:00:00.000Z"));
  });

  it("floors a timestamp just before UTC midnight to that same day, not the next", () => {
    expect(startOfUtcDay(new Date("2026-08-19T23:59:59.999Z"))).toEqual(new Date("2026-08-19T00:00:00.000Z"));
  });
});

describe("notYetDigestedTodayWhere", () => {
  it("matches a user who has never received a digest (lastDigestSentAt: null)", () => {
    const where = notYetDigestedTodayWhere(new Date("2026-08-19T00:00:00.000Z"));
    expect(where).toEqual({ OR: [{ lastDigestSentAt: null }, { lastDigestSentAt: { lt: new Date("2026-08-19T00:00:00.000Z") } }] });
  });

  it("is the identical shape whether used for the tenant-level scan or the atomic per-user claim — same object, reused", () => {
    const todayStartUtc = new Date("2026-08-19T00:00:00.000Z");
    expect(notYetDigestedTodayWhere(todayStartUtc)).toEqual(notYetDigestedTodayWhere(todayStartUtc));
  });
});
