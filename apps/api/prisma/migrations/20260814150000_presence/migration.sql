-- AlterTable
ALTER TABLE "users" ADD COLUMN     "last_seen_at" TIMESTAMP(3),
ADD COLUMN     "presence_status" TEXT;
