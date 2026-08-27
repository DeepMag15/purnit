-- Go-Live, Phase 01: per-seat billing with monthly/yearly intervals.
--
-- Replaces the single-price-per-plan model with a `plan_prices` table (one
-- row per plan/interval/currency), adds the seat + subscription shape to
-- `tenants`, and adds an append-only `subscription_events` audit trail.

-- --------------------------------------------------------------------------
-- plans: presentation + seat model
-- --------------------------------------------------------------------------
ALTER TABLE "plans" ADD COLUMN "tagline" TEXT,
ADD COLUMN "highlights" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "seat_model" TEXT NOT NULL DEFAULT 'per_seat',
ADD COLUMN "min_seats" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "max_seats" INTEGER,
ADD COLUMN "trial_days" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "is_public" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;

-- --------------------------------------------------------------------------
-- plan_prices
-- --------------------------------------------------------------------------
CREATE TABLE "plan_prices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plan_id" UUID NOT NULL,
    "interval" TEXT NOT NULL,
    "unit_amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "stripe_price_id" TEXT,

    CONSTRAINT "plan_prices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "plan_prices_plan_id_interval_currency_key"
  ON "plan_prices"("plan_id", "interval", "currency");

ALTER TABLE "plan_prices" ADD CONSTRAINT "plan_prices_plan_id_fkey"
  FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: carry each plan's existing single price forward as its monthly
-- row, so no plan silently loses its price when the columns are dropped
-- below. Only plans that actually had one (Free's 0 included; Enterprise's
-- NULL correctly produces no row, since it has no self-serve price).
INSERT INTO "plan_prices" ("plan_id", "interval", "unit_amount_cents", "currency", "stripe_price_id")
SELECT "id", 'month', "price_cents", 'usd', "stripe_price_id"
FROM "plans"
WHERE "price_cents" IS NOT NULL;

-- Now safe to drop — superseded by plan_prices above.
ALTER TABLE "plans" DROP COLUMN "stripe_price_id",
DROP COLUMN "price_cents";

-- --------------------------------------------------------------------------
-- tenants: subscription shape
-- --------------------------------------------------------------------------
ALTER TABLE "tenants" ADD COLUMN "billing_interval" TEXT,
ADD COLUMN "seats_purchased" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "trial_ends_at" TIMESTAMP(3),
ADD COLUMN "current_period_end" TIMESTAMP(3),
ADD COLUMN "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "pending_plan_key" TEXT;

-- --------------------------------------------------------------------------
-- subscription_events
-- --------------------------------------------------------------------------
CREATE TABLE "subscription_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "from_plan_key" TEXT,
    "to_plan_key" TEXT,
    "from_seats" INTEGER,
    "to_seats" INTEGER,
    "interval" TEXT,
    "stripe_event_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "subscription_events_tenant_id_created_at_idx"
  ON "subscription_events"("tenant_id", "created_at");

-- RLS — `subscription_events` is tenant-owned, so it gets the same
-- fail-closed isolation policy as every other tenant-scoped table. The
-- NULLIF guard is required, not stylistic: on a pooled connection an unset
-- GUC reads back as '' once it has been set at least once on that physical
-- connection, and ''::uuid throws instead of failing closed (CONTEXT.md §9).
--
-- `plan_prices` deliberately gets NO policy — it is platform-root catalog
-- data with no tenant_id, exactly like `plans`, `blueprints` and
-- `stripe_events`, and it is served to unauthenticated visitors by the
-- public pricing endpoint.
-- No GRANT needed for either new table: the original rls_and_app_role
-- migration set ALTER DEFAULT PRIVILEGES for app_runtime, which covers every
-- table created afterwards (same note as the sso_config migration).
ALTER TABLE subscription_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON subscription_events
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
