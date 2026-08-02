-- AlterTable
ALTER TABLE "users" ADD COLUMN     "employment_status" TEXT DEFAULT 'active',
ADD COLUMN     "job_title" TEXT,
ADD COLUMN     "start_date" TIMESTAMP(3);
