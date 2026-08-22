import { HttpException, HttpStatus } from "@nestjs/common";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

// Least-privilege, not unlimited — the fallback for any tenant with no Plan
// at all (`Tenant.planId` is nullable: pre-billing/dev/seed tenants).
export const DEFAULT_AI_MESSAGE_DAILY_CAP = 50;

export class AiUsageCapExceededException extends HttpException {
  constructor(message: string) {
    super(message, HttpStatus.TOO_MANY_REQUESTS);
  }
}

/**
 * Counts `role: "assistant"` rows (completed turns) over a rolling 24h
 * window — deliberately not calendar-day-in-tenant-timezone, no per-tenant
 * timezone lookup needed for this v1. Covers both `aiMessage.send` and
 * `aiToolCall.reply` with one shared check, since both create exactly one
 * assistant-role `AiMessage` row per successful completion call, and each
 * such row corresponds 1:1 with one real provider API call — a legitimate,
 * appropriately-scoped proxy for cost (token-based capping would need new
 * typed columns on `AiMessage.usage`, currently an untyped `Json?` blob; a
 * reasonable v2, not built now).
 *
 * `cap: null` means unlimited (Enterprise) and skips the count entirely —
 * never even queries `ai_messages` for a tenant with no cap to check
 * against.
 */
export async function assertUnderAiDailyCap(tx: PrismaTx, tenantId: string, cap: number | null): Promise<void> {
  if (cap === null) return;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const count = await tx.aiMessage.count({ where: { tenantId, role: "assistant", createdAt: { gte: since } } });
  if (count >= cap) {
    throw new AiUsageCapExceededException(`Daily AI usage limit reached (${cap} messages/day) — try again later or contact your Admin about upgrading.`);
  }
}
