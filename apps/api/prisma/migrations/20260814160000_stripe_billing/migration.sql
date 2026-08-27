-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "stripe_customer_id" TEXT,
ADD COLUMN     "stripe_subscription_id" TEXT,
ADD COLUMN     "subscription_status" TEXT;

-- AlterTable
ALTER TABLE "plans" ADD COLUMN     "stripe_product_id" TEXT,
ADD COLUMN     "stripe_price_id" TEXT,
ADD COLUMN     "price_cents" INTEGER;

-- CreateTable
CREATE TABLE "stripe_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stripe_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_stripe_customer_id_key" ON "tenants"("stripe_customer_id");
