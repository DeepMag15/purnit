# Purnit Pricing & Billing

How the plan catalog actually works, and — importantly — **what each tier genuinely
enforces versus what is a business commitment**. Written so the marketing copy never
drifts from what the code does.

## The catalog

| Tier | Price / seat | Yearly | Seats | Trial | AI cap / day |
|---|---|---|---|---|---|
| **Free** | $0 | $0 | max **3** | — | 50 |
| **Starter** | $12/mo | $120/yr | min 3, unlimited | 14 days | 500 |
| **Professional** | $29/mo | $290/yr | min 5, unlimited | 14 days | 2,000 |
| **Enterprise** | Contact us | — | unlimited | — | unlimited |

Yearly is **10× the monthly unit price**, not 12× — "two months free" is expressed in
the price itself rather than as a Stripe coupon, so one number drives both the
marketing claim and the actual charge.

`pro` ($49/mo) is a **legacy tier**. It is `isPublic: false` — withdrawn from the
catalog but fully intact, so any tenant already on it keeps working. It is never
deleted, because deleting it would null out those tenants' `planId`, and
`planId: null` means "everything entitled" (`entitlement-filter.ts`), which would
silently grant them *more* access than they pay for.

## What is actually enforced

Be careful here. Only these differences are real, code-enforced gates:

| Differentiator | Enforced by | Real? |
|---|---|---|
| Seat count | `assert-seat-available.ts`, on both `user.invite` and SSO JIT provisioning | **Yes** |
| AI messages/day | `assert-ai-usage-cap.ts` via `Plan.aiMessageDailyCap` | **Yes** |
| Leave module | `Plan.entitlements` → `filterByEntitlements` (`nav.leave` carries `moduleKey: "leave"`) | **Yes** |
| CRM module | Same mechanism (`nav.crm` carries `moduleKey: "crm"`) | **Yes** |
| 14-day trial | Stripe `trial_period_days` | **Yes** |
| Support level | Nothing — a business commitment | **No** |
| SSO/SAML on Enterprise | Nothing — SSO is not currently plan-gated | **No** |

### The two honest gaps

1. **Support tiers are promises, not code.** "Priority email support" on Professional
   is a commitment you make, not something the platform enforces. That is normal for
   SaaS, but it should be a deliberate promise rather than an accident.

2. **SSO is listed under Enterprise but is not plan-gated.** Any tenant that
   configures SSO can use it today. Gating it would mean giving the SSO nav/config
   a `moduleKey` and adding that key to the Enterprise entitlement list only —
   a small change, deliberately **not** made in Phase 01 because it would
   immediately withdraw a working feature from existing tenants. Decide this before
   launch, not after someone is relying on it.

Only `leave` and `crm` carry a `moduleKey` anywhere in any blueprint today, so they
are the only two modules a plan can currently unlock or withhold. Everything else in
a blueprint is core to its industry. If you want deeper tier differentiation, the
mechanism is adding `moduleKey` to more nav items — not a new gating system.

## Architecture

**Our database is the display authority; Stripe is the charge authority.**

- `PlanPrice.unitAmountCents` drives every price shown on the marketing site, the
  pricing page and the signup wizard. No public page ever calls Stripe.
- `PlanPrice.stripePriceId` is what actually gets charged. It is null until a real
  Stripe account exists.

This split is what lets the entire public pricing surface render correctly today with
**no Stripe account configured at all**, and keeps pricing up if Stripe has an outage.

> ⚠️ **Nothing auto-syncs the two.** If you edit a Price in the Stripe Dashboard, you
> must update `unitAmountCents` in `seed.ts` to match, or customers will be shown one
> number and charged another.

### Adding real Stripe prices

1. Create one Product per paid tier (Starter, Professional) in Stripe.
2. Under each, create **two** recurring per-unit Prices — monthly and yearly.
3. Put the ids in `.env` (`STRIPE_PRICE_STARTER_MONTHLY`, etc. — see `.env.example`).
4. Re-run `pnpm --filter @purnit/api run prisma:seed`.

No code changes. `selfServe` flips to true per price, and the signup wizard's final
step switches from "we'll collect payment later" to a real Checkout redirect.

## Lifecycle

| Operation | Behaviour | Proration |
|---|---|---|
| Upgrade tier | Immediate | Charged, prorated |
| Downgrade tier | At period end, via a Stripe **Subscription Schedule** | None |
| Add seats | Immediate | Charged, prorated |
| Remove seats | At period end; **blocked** below current active user count | None |
| Switch interval | Treated as a plan change | Stripe standard |
| Cancel | `cancel_at_period_end`; reverts to Free when the period ends | None |
| Resume | Clears the pending cancellation | — |
| Payment fails | `past_due` + notification; **grace period, not a hard lock** | — |

Downgrades use a real Stripe Subscription Schedule rather than either of the tempting
approximations: swapping the price with `proration_behavior: "none"` changes it *now*
(the customer loses what they paid for), and waiting for `invoice.paid` to swap it
later bills one extra cycle at the old rate first.

## The one invariant to preserve

**Only the signed Stripe webhook writes durable subscription state** — `planId`,
`seatsPurchased`, `billingInterval`, `subscriptionStatus`, period and trial dates.

Billing mutations tell Stripe what to do and return. They never optimistically write
what they hope Stripe will confirm. This is what makes a closed browser tab, a dropped
redirect, or a failed payment harmless. Do not "optimize" this by writing state in the
mutation.
