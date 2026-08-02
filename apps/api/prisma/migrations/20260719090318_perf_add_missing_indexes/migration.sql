-- CreateIndex
CREATE INDEX "projects_tenant_id_owner_id_idx" ON "projects"("tenant_id", "owner_id");

-- CreateIndex
CREATE INDEX "projects_tenant_id_department_id_idx" ON "projects"("tenant_id", "department_id");

-- CreateIndex
CREATE INDEX "tasks_tenant_id_assignee_id_idx" ON "tasks"("tenant_id", "assignee_id");

-- CreateIndex
CREATE INDEX "users_tenant_id_department_id_idx" ON "users"("tenant_id", "department_id");
