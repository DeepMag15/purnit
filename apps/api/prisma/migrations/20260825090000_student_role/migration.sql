-- Student Role, Education domain.
--
-- Phase A recorded Student as non-login "by design": ProjectMember and
-- RoleAssignment only resolve against real User rows and a Student had none.
-- That held while nobody signed in as a student. It is also the single thing
-- that made a student portal impossible -- enrollments and grades key off
-- student_id, which a logged-in user had no path to.
--
-- Nullable: a Registrar registering a student stays the normal case and must
-- keep working untouched. Unique: one login maps to exactly one student.
ALTER TABLE "students" ADD COLUMN "user_id" UUID;

CREATE UNIQUE INDEX "students_user_id_key" ON "students"("user_id");

-- Every student-portal data source starts by resolving "which student am I?"
-- from the signed-in user, so this lookup is on the hot path of every page
-- the role has.
CREATE INDEX "students_tenant_id_user_id_idx" ON "students"("tenant_id", "user_id");
