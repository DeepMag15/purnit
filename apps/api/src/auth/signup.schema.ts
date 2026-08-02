import { z } from "zod";

// Phase 1 has only the IT blueprint seeded; the industry enum grows as more
// blueprints are added in later phases.
export const SignupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  companyName: z.string().min(1),
  displayName: z.string().min(1),
  industry: z.literal("IT"),
});

export type SignupInput = z.infer<typeof SignupSchema>;
