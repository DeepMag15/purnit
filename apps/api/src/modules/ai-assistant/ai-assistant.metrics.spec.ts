import { aiUsageSummaryMetric } from "./ai-assistant.metrics";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { collapsePermissions } from "../../rbac/permission-collapse";

function context(): DataSourceContext {
  return { tenantId: "t1", userId: "u1", userDepartmentId: null, effective: collapsePermissions([]) };
}

describe("aiUsageSummaryMetric", () => {
  it("requires analytics:aiUsage", () => {
    expect(aiUsageSummaryMetric.requiredPermission).toBe("analytics:aiUsage");
  });

  it("computeLive sums inputTokens + outputTokens across this month's assistant messages", async () => {
    const tx = {
      aiMessage: {
        findMany: jest.fn().mockResolvedValue([
          { usage: { inputTokens: 100, outputTokens: 50 } },
          { usage: { inputTokens: 200, outputTokens: 75 } },
        ]),
      },
    } as unknown as PrismaTx;
    const value = await aiUsageSummaryMetric.computeLive(context(), tx);
    expect(value).toBe(425);
    const call = (tx as unknown as { aiMessage: { findMany: jest.Mock } }).aiMessage.findMany.mock.calls[0][0];
    expect(call.where).toMatchObject({ tenantId: "t1", role: "assistant" });
  });

  it("computeLive tolerates a message with no usage recorded, no crash", async () => {
    const tx = {
      aiMessage: {
        findMany: jest.fn().mockResolvedValue([{ usage: null }, { usage: { inputTokens: 10, outputTokens: 5 } }]),
      },
    } as unknown as PrismaTx;
    expect(await aiUsageSummaryMetric.computeLive(context(), tx)).toBe(15);
  });

  it("computeLive returns 0 with zero messages", async () => {
    const tx = { aiMessage: { findMany: jest.fn().mockResolvedValue([]) } } as unknown as PrismaTx;
    expect(await aiUsageSummaryMetric.computeLive(context(), tx)).toBe(0);
  });
});
