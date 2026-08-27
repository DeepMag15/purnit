import type { ScalarMetricDefinition } from "../../metrics/metric-registry.service";

function startOfUtcMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** This module's first metric. `AiMessage.usage` (`{inputTokens,
 * outputTokens}`, written by `createAiMessageSendMutation` — see that
 * mutation's own `SendPre` shape) is real and already stored on every
 * assistant message, but had zero aggregation anywhere before this.
 *
 * Analytics Phase D (Permission-Controlled Widget Catalog) — gated by the
 * new analytics:aiUsage permission, not an AI-Assistant-specific one (this
 * module has no RBAC resource of its own — conversations/messages are
 * ownership-scoped only, confirmed during this phase's own research). Real
 * token usage/cost is exactly the kind of tenant-wide, sensitive rollup this
 * permission family exists for. */
export const aiUsageSummaryMetric: ScalarMetricDefinition = {
  kind: "scalar",
  key: "ai.usageSummary",
  module: "AI Usage",
  label: "AI Usage This Month",
  requiredPermission: "analytics:aiUsage",
  format: "count",
  unit: "tokens",
  async computeLive(ctx, tx) {
    const now = new Date();
    const monthStart = startOfUtcMonth(now);
    const messages = await tx.aiMessage.findMany({
      where: { tenantId: ctx.tenantId, role: "assistant", createdAt: { gte: monthStart, lte: now } },
      select: { usage: true },
    });
    let total = 0;
    for (const m of messages) {
      const usage = m.usage as { inputTokens?: number; outputTokens?: number } | null;
      if (!usage) continue;
      total += (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
    }
    return total;
  },
};
