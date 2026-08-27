/**
 * Go-Live, Phase 02 — the handful of real-world facts the legal pages need,
 * in one place.
 *
 * These are the only placeholders on the public site. They are deliberately
 * NOT scattered through the Terms and Privacy documents: when the company
 * entity, address and domain are registered, this is the one file to edit,
 * and nothing else about the legal pages changes.
 *
 * Everything here is read at build time. `NEXT_PUBLIC_*` env vars let staging
 * and production differ (e.g. a staging contact address) without a code
 * change, per the initiative's "domain stays configuration" rule.
 */

export const LEGAL = {
  /** The trading name. Safe to state today — it is the product name. */
  productName: "Purnit",

  /** ⚠️ Placeholder until the company is registered. Shown verbatim in both
   * documents, so it reads as an obvious gap rather than a false claim. */
  legalEntity: process.env.NEXT_PUBLIC_LEGAL_ENTITY ?? "[Legal entity name — to be registered]",

  registeredAddress: process.env.NEXT_PUBLIC_LEGAL_ADDRESS ?? "[Registered business address — to be added]",

  /** Falls back to a generic mailbox on the eventual domain. */
  contactEmail: process.env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL ?? "[contact email — pending domain registration]",

  privacyEmail: process.env.NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL ?? "[privacy contact — pending domain registration]",

  governingLaw: process.env.NEXT_PUBLIC_GOVERNING_LAW ?? "[governing jurisdiction — to be confirmed with counsel]",

  /** Bumped by hand whenever the substance of either document changes. */
  lastUpdated: "2026-08-22",
} as const;

/** Subprocessors that genuinely receive customer data today, and why. Kept
 * as data because a privacy policy that lists them inaccurately is worse
 * than one that omits the section — this list is checked against the real
 * integrations in the codebase, not aspirational. */
export const SUBPROCESSORS: { name: string; purpose: string; data: string }[] = [
  {
    name: "Supabase",
    purpose: "Database, authentication and file storage",
    data: "All workspace data, account credentials and uploaded documents",
  },
  {
    name: "Anthropic, Google or OpenAI",
    purpose: "AI assistant responses and document embeddings",
    data: "Only the content relevant to a request you make, after it has been filtered to what you personally have permission to see",
  },
  {
    name: "Stripe",
    purpose: "Subscription billing and payment processing",
    data: "Billing contact details and payment method. Card numbers are handled by Stripe directly and never reach our servers",
  },
  {
    name: "Resend",
    purpose: "Transactional email (invitations, notifications, billing notices)",
    data: "Recipient email address and the contents of that message",
  },
  {
    name: "Sentry",
    purpose: "Error monitoring",
    data: "Technical error details, tagged with workspace and route. Configured to exclude secret values",
  },
];
