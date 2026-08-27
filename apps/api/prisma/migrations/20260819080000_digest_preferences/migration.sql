-- AlterTable
ALTER TABLE "users" ADD COLUMN     "last_digest_sent_at" TIMESTAMP(3),
ADD COLUMN     "digest_opt_out" BOOLEAN NOT NULL DEFAULT false;
