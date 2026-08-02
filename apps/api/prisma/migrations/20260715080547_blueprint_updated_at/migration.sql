/*
  Warnings:

  - Added the required column `updated_at` to the `blueprints` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
-- Backfilled with now() for the one existing row; @updatedAt (Prisma Client
-- level, not a DB default) takes over on every future update.
ALTER TABLE "blueprints" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT now();
ALTER TABLE "blueprints" ALTER COLUMN "updated_at" DROP DEFAULT;
