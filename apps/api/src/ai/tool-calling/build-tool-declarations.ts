import { z } from "zod";
import type { EffectivePermissions } from "../../rbac/permission-collapse";
import type { MutationRegistry } from "../../mutations/mutation-registry.service";
import type { ToolDeclaration } from "../provider/completion-provider";
import { AI_TOOL_ALLOWLIST } from "./ai-tool-allowlist";

/**
 * Builds the tool declarations offered to the model for one request, scoped
 * to what the caller could plausibly do — filters out any allowlisted
 * mutation the caller's `effective` permissions don't currently grant, a UX
 * nicety that avoids a doomed propose→confirm→403 round trip. This is
 * **not** a substitute for `aiToolCall.confirm`'s own mandatory, fresh
 * `checkRequiredPermission` re-check — that happens regardless of whether a
 * tool was offered here.
 *
 * A missing `MutationRegistry` entry is skipped, never thrown here —
 * `AiAssistantRegistrar.onApplicationBootstrap()` is where a typo'd
 * allowlist entry is meant to fail loudly, at boot, not mid-request.
 *
 * ⚠️ `{ unrepresentable: "any" }` is load-bearing, not decorative — found
 * live during Phase D's own verification: several allowlisted mutations
 * (`leave.submit`, `calendarEvent.create`, `meeting.create`) take a raw
 * `z.coerce.date()` field, and zod v4's `toJSONSchema()` *throws* ("Date
 * cannot be represented in JSON Schema") on those by default rather than
 * degrading gracefully. Since `calendarEvent:create:own` is a universal
 * floor permission every role holds, that default crashed `aiMessage.send`
 * for literally every caller the moment tools were offered at all — not an
 * edge case. `"any"` emits a permissive `{}` for just that field (the model
 * still sees the surrounding property name/description and, in practice,
 * still supplies an ISO date string there); every other field's real type
 * info is unaffected.
 */
export function buildToolDeclarations(registry: MutationRegistry, effective: EffectivePermissions): ToolDeclaration[] {
  const declarations: ToolDeclaration[] = [];
  for (const entry of AI_TOOL_ALLOWLIST) {
    const def = registry.get(entry.mutationName);
    if (!def) continue;
    if (def.requiredPermission) {
      const [resource, action] = def.requiredPermission.split(":");
      if (effective.has(resource!, action!) === null) continue;
    }
    declarations.push({
      name: def.name,
      description: entry.description,
      inputSchema: z.toJSONSchema(def.inputSchema, { unrepresentable: "any" }) as Record<string, unknown>,
    });
  }
  return declarations;
}
