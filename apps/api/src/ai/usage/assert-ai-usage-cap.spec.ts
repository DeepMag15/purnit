import { assertUnderAiDailyCap, AiUsageCapExceededException, DEFAULT_AI_MESSAGE_DAILY_CAP } from "./assert-ai-usage-cap";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

describe("assertUnderAiDailyCap", () => {
  it("passes, and never even counts, when cap is null (unlimited/Enterprise)", async () => {
    const count = jest.fn();
    const tx = { aiMessage: { count } } as unknown as PrismaTx;
    await expect(assertUnderAiDailyCap(tx, "t1", null)).resolves.toBeUndefined();
    expect(count).not.toHaveBeenCalled();
  });

  it("passes when the tenant's rolling 24h count is under the cap", async () => {
    const tx = { aiMessage: { count: jest.fn().mockResolvedValue(49) } } as unknown as PrismaTx;
    await expect(assertUnderAiDailyCap(tx, "t1", 50)).resolves.toBeUndefined();
  });

  it("throws AiUsageCapExceededException (429) when the count is at the cap", async () => {
    const tx = { aiMessage: { count: jest.fn().mockResolvedValue(50) } } as unknown as PrismaTx;
    await expect(assertUnderAiDailyCap(tx, "t1", 50)).rejects.toThrow(AiUsageCapExceededException);
  });

  it("throws when the count is over the cap", async () => {
    const tx = { aiMessage: { count: jest.fn().mockResolvedValue(51) } } as unknown as PrismaTx;
    await expect(assertUnderAiDailyCap(tx, "t1", 50)).rejects.toThrow(AiUsageCapExceededException);
  });

  it("the thrown exception carries HTTP status 429", async () => {
    const tx = { aiMessage: { count: jest.fn().mockResolvedValue(50) } } as unknown as PrismaTx;
    try {
      await assertUnderAiDailyCap(tx, "t1", 50);
      throw new Error("expected assertUnderAiDailyCap to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AiUsageCapExceededException);
      expect((err as AiUsageCapExceededException).getStatus()).toBe(429);
    }
  });

  it("counts only role: 'assistant' rows for this tenant, over a rolling 24h window", async () => {
    const count = jest.fn().mockResolvedValue(0);
    const tx = { aiMessage: { count } } as unknown as PrismaTx;
    const before = Date.now();
    await assertUnderAiDailyCap(tx, "t1", 50);
    const call = count.mock.calls[0]![0];
    expect(call.where.tenantId).toBe("t1");
    expect(call.where.role).toBe("assistant");
    expect(call.where.createdAt.gte.getTime()).toBeGreaterThanOrEqual(before - 24 * 60 * 60 * 1000 - 1000);
    expect(call.where.createdAt.gte.getTime()).toBeLessThanOrEqual(before - 24 * 60 * 60 * 1000 + 1000);
  });

  it("DEFAULT_AI_MESSAGE_DAILY_CAP is the disclosed placeholder fallback for a planless tenant", () => {
    expect(DEFAULT_AI_MESSAGE_DAILY_CAP).toBe(50);
  });
});
