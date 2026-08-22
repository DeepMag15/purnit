import { z } from "zod";

// Healthcare Domain, Phase A — the platform's first non-IT industry
// blueprint (`prisma/seed.ts`'s HEALTHCARE_BLUEPRINT_V1). Education Domain,
// Phase A added `EDUCATION_BLUEPRINT_V1`. Finance Domain, Phase A added
// `FINANCE_BLUEPRINT_V1`. Manufacturing Domain, Phase A added
// `MANUFACTURING_BLUEPRINT_V1`. The enum grows as more blueprints are added
// in later phases.
export const SignupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  companyName: z.string().min(1),
  displayName: z.string().min(1),
  industry: z.enum(["IT", "Healthcare", "Education", "Finance", "Manufacturing"]),

  // --- Go-Live, Phase 03: plan selection at signup ---
  // All three are optional, and omitting them reproduces the exact
  // pre-Phase-03 behaviour (a Free-plan tenant with one seat). That matters
  // for more than backwards compatibility: `/auth/signup` is a public,
  // unauthenticated endpoint, so it must stay valid for a caller that knows
  // nothing about billing.
  //
  // None of these are trusted as sent. `planKey` is resolved against the
  // real Plan catalog and rejected if it isn't a public, self-serve tier;
  // `seats` is clamped to the plan's own minimum and maximum. A hostile
  // caller cannot provision themselves onto Enterprise, or onto 10,000
  // seats they haven't paid for — and in any case no money moves here.
  // Payment happens in a separate Stripe Checkout round-trip, and the only
  // thing trusted to record a *paid* subscription is the signed webhook.
  planKey: z.string().optional(),
  interval: z.enum(["month", "year"]).optional(),
  seats: z.number().int().positive().max(10_000).optional(),
});

export type SignupInput = z.infer<typeof SignupSchema>;
