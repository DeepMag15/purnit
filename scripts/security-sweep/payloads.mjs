/**
 * Stage E write sweep — payload synthesis, shared by the sweep and the
 * single-role probe so the two cannot drift.
 *
 * `MutationsController` parses `inputSchema` before `checkRequiredPermission`,
 * so every mutation needs a payload that actually *passes* validation before
 * the authorization decision under test is ever reached. Payloads are built
 * from each schema's JSON Schema form (Zod 4's `toJSONSchema`).
 *
 * JSON Schema cannot express a Zod `.refine()`, so a handful of cross-field
 * rules — "end must be after start", "date cannot be in the future" — are not
 * visible to the generator and produce a 400 that never reaches the gate.
 * Those are listed explicitly below rather than left as blind spots: a
 * mutation whose payload 400s is one the sweep silently never tested.
 */
const HOUR = 3600000;
export const iso = (h) => new Date(Date.now() + h * HOUR).toISOString();

/** Cross-field rules invisible to JSON Schema. Merged over the generated
 * payload, so required fields still come from the schema itself. */
export const OVERRIDES = {
  // attendance.mutations.ts:56 — date cannot be in the future
  "attendance.mark": { date: iso(-24) },
  "attendance.correct": { date: iso(-24) },
  // calendar.mutations.ts:42 — endAt must be after startAt
  "calendarEvent.create": { startAt: iso(24), endAt: iso(25) },
  // meetings.mutations.ts:91 — scheduledEnd must be after scheduledStart
  "meeting.create": { scheduledStart: iso(24), scheduledEnd: iso(25) },
  // settings.mutations.ts:36 — accentColor must be a 6-digit hex colour
  "tenant.updateBranding": { accentColor: "#3366ff" },
};

let seed = 0;
const uuid = () => `00000000-0000-4000-8000-${(++seed).toString(16).padStart(12, "0")}`;

export function sample(s, key = "") {
  if (!s || typeof s !== "object") return "x";
  if (s.const !== undefined) return s.const;
  if (s.enum) return s.enum[0];
  if (s.anyOf) return sample(s.anyOf[0], key);
  if (s.oneOf) return sample(s.oneOf[0], key);
  if (s.allOf) return sample(s.allOf[0], key);
  switch (s.type) {
    case "object": {
      const o = {};
      for (const k of s.required ?? []) o[k] = sample((s.properties ?? {})[k] ?? { type: "string" }, k);
      return o;
    }
    case "array":
      return Array.from({ length: s.minItems ?? 0 }, () => sample(s.items ?? { type: "string" }));
    case "integer":
    case "number":
      return s.minimum ?? 1;
    case "boolean":
      return true;
    case "null":
      return null;
    default: {
      if (s.format === "uuid") return uuid();
      if (s.format === "email") return `sweep-${seed++}@example.com`;
      if (s.format === "date-time") return iso(24);
      if (s.format === "uri" || s.format === "url") return "https://example.com/x";
      if (/id$/i.test(key)) return uuid();
      if (/email/i.test(key)) return `sweep-${seed++}@example.com`;
      if (/(at|date|start|end)$/i.test(key)) return iso(24);
      return "sweep-value".padEnd(s.minLength ?? 1, "x");
    }
  }
}

export function buildPayload(name, schema) {
  const base = sample(schema);
  const over = OVERRIDES[name];
  return over && base && typeof base === "object" ? { ...base, ...over } : base;
}

/**
 * Mutations whose *authorised* path has real side effects outside this
 * database — a sent email, a Stripe call, a deleted Supabase Auth user, an AI
 * provider call, or a change to an identifier the sweep depends on.
 *
 * Only the refusal direction is exercised for these. That path returns before
 * `resolve()` (and, since the preResolve authorization fix, before
 * `preResolve`) so nothing fires. Counted and reported, never silently skipped.
 */
export const NO_EXECUTE = new Set([
  "user.invite", // sends a real email via Resend
  "account.deleteSelf", // deletes the acting test user
  "tenant.closeWorkspace", // closes the throwaway tenant mid-sweep
  "tenant.updateWorkspaceId", // changes the tenant identifier
  "billing.createCheckoutSession",
  "billing.changePlan",
  "billing.cancelSubscription",
  "billing.resumeSubscription",
  "billing.updateSeats",
  "billing.createPortalSession",
  "aiMessage.send", // real AI provider call
  "aiToolCall.confirm", // may execute a real tool action
  "aiToolCall.reply",
]);
