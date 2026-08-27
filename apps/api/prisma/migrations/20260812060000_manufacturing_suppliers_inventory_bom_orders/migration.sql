-- Manufacturing Domain, Phase A — the platform's fourth industry blueprint,
-- and the third of the Education/Finance/Manufacturing expansion. 5 new
-- tables: Supplier (vendor master data, no backing Project), InventoryItem
-- (the one entity that owns a "files" Project, files_project_id, no FK
-- declared — same no-FK, app-layer-scoped-target convention
-- Client.files_project_id/Patient.chart_project_id/Course.materials_project_id
-- already established), BOMLine (self-referential recipe on InventoryItem),
-- PurchaseOrder (real FK to Supplier), WorkOrder (real FK to InventoryItem).

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "contact_email" TEXT,
    "contact_phone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "suppliers_tenant_id_idx" ON "suppliers"("tenant_id");

-- CreateIndex
CREATE INDEX "suppliers_tenant_id_status_idx" ON "suppliers"("tenant_id", "status");

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "files_project_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "unit_of_measure" TEXT NOT NULL,
    "unit_cost" INTEGER NOT NULL DEFAULT 0,
    "current_stock" INTEGER NOT NULL DEFAULT 0,
    "reorder_point" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_files_project_id_key" ON "inventory_items"("files_project_id");

-- CreateIndex
CREATE INDEX "inventory_items_tenant_id_idx" ON "inventory_items"("tenant_id");

-- CreateIndex
CREATE INDEX "inventory_items_tenant_id_type_idx" ON "inventory_items"("tenant_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_tenant_id_sku_key" ON "inventory_items"("tenant_id", "sku");

-- CreateTable
CREATE TABLE "bom_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "parent_item_id" UUID NOT NULL,
    "component_item_id" UUID NOT NULL,
    "quantity_required" INTEGER NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bom_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bom_lines_tenant_id_idx" ON "bom_lines"("tenant_id");

-- CreateIndex
CREATE INDEX "bom_lines_tenant_id_parent_item_id_idx" ON "bom_lines"("tenant_id", "parent_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "bom_lines_tenant_id_parent_item_id_component_item_id_key" ON "bom_lines"("tenant_id", "parent_item_id", "component_item_id");

-- AddForeignKey
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_parent_item_id_fkey" FOREIGN KEY ("parent_item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_component_item_id_fkey" FOREIGN KEY ("component_item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "line_items" JSONB NOT NULL,
    "subtotal" INTEGER NOT NULL,
    "tax" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "expected_date" TIMESTAMP(3) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchase_orders_tenant_id_idx" ON "purchase_orders"("tenant_id");

-- CreateIndex
CREATE INDEX "purchase_orders_tenant_id_supplier_id_idx" ON "purchase_orders"("tenant_id", "supplier_id");

-- CreateIndex
CREATE INDEX "purchase_orders_tenant_id_status_idx" ON "purchase_orders"("tenant_id", "status");

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "work_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "due_date" TIMESTAMP(3) NOT NULL,
    "assigned_to_id" UUID,
    "notes" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_orders_tenant_id_idx" ON "work_orders"("tenant_id");

-- CreateIndex
CREATE INDEX "work_orders_tenant_id_item_id_idx" ON "work_orders"("tenant_id", "item_id");

-- CreateIndex
CREATE INDEX "work_orders_tenant_id_status_idx" ON "work_orders"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "work_orders_tenant_id_assigned_to_id_idx" ON "work_orders"("tenant_id", "assigned_to_id");

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Standard tenant_isolation policy, shipped in the same migration as each
-- table — same discipline established since 20260721163636_fix_missing_rls_policies.
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON suppliers
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inventory_items
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE bom_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON bom_lines
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON purchase_orders
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_orders FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON work_orders
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
