import { z } from "zod";

// Healthcare Domain, Phase A — the platform's first non-IT industry
// blueprint (`prisma/seed.ts`'s HEALTHCARE_BLUEPRINT_V1). Education Domain,
// Phase A added `EDUCATION_BLUEPRINT_V1`. The enum grows as more blueprints
// are added in later phases.
export const SignupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  companyName: z.string().min(1),
  displayName: z.string().min(1),
  industry: z.enum(["IT", "Healthcare", "Education"]),
});

export type SignupInput = z.infer<typeof SignupSchema>;
