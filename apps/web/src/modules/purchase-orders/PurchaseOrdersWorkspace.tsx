"use client";

import { z } from "zod";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../../ui/Icon";
import type { CommonRenderProps } from "../../sdui/registry";
import { useDataBinding, useDataSourceQuery } from "../../sdui/use-data-binding";
import { useRenderContext } from "../../sdui/render-context";
import { useAsyncAction } from "../../sdui/use-async-action";
import { useFormValidation } from "../../sdui/use-form-validation";
import { required } from "../../sdui/validators";
import { EmptyStateView } from "../../sdui/primitives/EmptyState";
import { KanbanBoard } from "../../sdui/primitives/KanbanBoard";
import { Table3 } from "../../sdui/primitives/Table";
import { PageHeader } from "../../ui/PageHeader";
import { ViewSwitcher, type ViewOption } from "../../ui/ViewSwitcher";
import { Dialog } from "../../ui/Dialog";
import { Input } from "../../ui/Input";
import { Select } from "../../ui/Select";
import { Button } from "../../ui/Button";
import { Alert } from "../../ui/Alert";
import { SkeletonRows } from "../../ui/Skeleton";
import { Badge } from "../../ui/Badge";
import { formatCents, dollarsToCents } from "../invoices/money";

export const PurchaseOrdersWorkspaceSchema = z.object({ title: z.string().optional() });
type Props = z.infer<typeof PurchaseOrdersWorkspaceSchema>;

interface PurchaseOrderRow {
  id: string;
  supplierId: string;
  supplierName: string;
  status: string;
  expectedDate: string;
  total: number;
}

interface SupplierOption {
  id: string;
  name: string;
}

interface InventoryItemOption {
  id: string;
  sku: string;
  name: string;
}

interface LineItemDraft {
  inventoryItemId: string;
  description: string;
  quantity: string;
  unitCost: string;
}

const VIEWS: ViewOption[] = [
  { id: "board", label: "Board", icon: "view_kanban" },
  { id: "table", label: "Table", icon: "table_rows" },
  { id: "list", label: "List", icon: "view_list" },
];

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info" | "accent"> = {
  draft: "neutral",
  submitted: "info",
  received: "success",
  cancelled: "danger",
};

const EMPTY_LINE_ITEM: LineItemDraft = { inventoryItemId: "", description: "", quantity: "1", unitCost: "" };

/**
 * Manufacturing Domain, Phase A — mirrors `InvoicesWorkspace.tsx`'s exact
 * shape (Frontend Structural Redesign, Pattern B), including the dynamic
 * line-item editor for creation. Row click on Table/List navigates to
 * `/workspace/purchase-orders/[id]`.
 */
export function PurchaseOrdersWorkspace({ title, bind, actions }: Props & CommonRenderProps) {
  const router = useRouter();
  const { data, loading, error, refetch } = useDataBinding(bind);
  const { callMutation } = useRenderContext();
  const [view, setView] = useState("board");
  const [createOpen, setCreateOpen] = useState(false);
  const [newSupplierId, setNewSupplierId] = useState("");
  const [newExpectedDate, setNewExpectedDate] = useState("");
  const [lineItems, setLineItems] = useState<LineItemDraft[]>([{ ...EMPTY_LINE_ITEM }]);
  const { pending: creating, error: createError, run: runCreate, clearError } = useAsyncAction();
  const { fieldErrors, validate, clearFieldError } = useFormValidation<{ supplierId: string; expectedDate: string }>({
    supplierId: required("Select a supplier"),
    expectedDate: required("Expected date is required"),
  });

  const canCreate = actions?.some((a) => a.kind === "mutation" && a.mutation === "purchaseOrder.create") ?? false;

  const { data: supplierOptionsData } = useDataSourceQuery<SupplierOption[]>("suppliers.list", {}, { enabled: canCreate });
  const supplierOptions = Array.isArray(supplierOptionsData) ? supplierOptionsData : [];
  const { data: itemOptionsData } = useDataSourceQuery<InventoryItemOption[]>("inventoryItems.list", {}, { enabled: canCreate });
  const itemOptions = Array.isArray(itemOptionsData) ? itemOptionsData : [];

  const rows = Array.isArray(data) ? (data as PurchaseOrderRow[]) : [];
  const statusColumns = [...new Set(rows.map((po) => po.status))];

  function openCreate() {
    setNewSupplierId("");
    setNewExpectedDate("");
    setLineItems([{ ...EMPTY_LINE_ITEM }]);
    clearError();
    clearFieldError("supplierId");
    clearFieldError("expectedDate");
    setCreateOpen(true);
  }

  function updateLineItem(index: number, patch: Partial<LineItemDraft>) {
    setLineItems((prev) => prev.map((li, i) => (i === index ? { ...li, ...patch } : li)));
  }

  function addLineItem() {
    setLineItems((prev) => [...prev, { ...EMPTY_LINE_ITEM }]);
  }

  function removeLineItem(index: number) {
    setLineItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  const lineItemsSubtotal = lineItems.reduce((sum, li) => sum + (Number(li.quantity) || 0) * dollarsToCents(li.unitCost), 0);

  async function handleCreate() {
    if (!validate({ supplierId: newSupplierId, expectedDate: newExpectedDate })) return;
    const validLineItems = lineItems.filter((li) => li.inventoryItemId && Number(li.quantity) > 0);
    if (validLineItems.length === 0) return;
    await runCreate(async () => {
      await callMutation("purchaseOrder.create", {
        supplierId: newSupplierId,
        expectedDate: newExpectedDate,
        lineItems: validLineItems.map((li) => ({
          inventoryItemId: li.inventoryItemId,
          description: li.description.trim() || (itemOptions.find((i) => i.id === li.inventoryItemId)?.name ?? "Item"),
          quantity: Number(li.quantity),
          unitCost: dollarsToCents(li.unitCost),
        })),
      });
      setCreateOpen(false);
      refetch();
    });
  }

  function openDetail(purchaseOrderId: string) {
    router.push(`/workspace/purchase-orders/${purchaseOrderId}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={title ?? "Purchase Orders"}
        description="Order materials from your suppliers."
        actions={
          canCreate && (
            <Button onClick={openCreate}>
              <Icon name="add" size={14} />
              New Purchase Order
            </Button>
          )
        }
        viewSwitcher={<ViewSwitcher views={VIEWS} activeId={view} onChange={setView} />}
      />

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="New Purchase Order">
        <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto">
          <Select label="Supplier" value={newSupplierId} onChange={(e) => setNewSupplierId(e.target.value)} error={fieldErrors.supplierId} autoFocus>
            <option value="">Choose a supplier…</option>
            {supplierOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Input
            label="Expected date"
            type="date"
            value={newExpectedDate}
            onChange={(e) => setNewExpectedDate(e.target.value)}
            error={fieldErrors.expectedDate}
          />

          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-text">Line items</span>
            {lineItems.map((li, index) => (
              <div key={index} className="flex items-end gap-2">
                <Select
                  value={li.inventoryItemId}
                  onChange={(e) => updateLineItem(index, { inventoryItemId: e.target.value })}
                  className="flex-1"
                >
                  <option value="">Choose an item…</option>
                  {itemOptions.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.sku} — {i.name}
                    </option>
                  ))}
                </Select>
                <Input
                  type="number"
                  min={1}
                  placeholder="Qty"
                  value={li.quantity}
                  onChange={(e) => updateLineItem(index, { quantity: e.target.value })}
                  className="w-16"
                />
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="Unit cost"
                  value={li.unitCost}
                  onChange={(e) => updateLineItem(index, { unitCost: e.target.value })}
                  className="w-24"
                />
                <Button variant="secondary" size="sm" onClick={() => removeLineItem(index)} disabled={lineItems.length === 1}>
                  <Icon name="close" size={14} />
                </Button>
              </div>
            ))}
            <Button variant="secondary" size="sm" onClick={addLineItem} className="self-start">
              <Icon name="add" size={14} />
              Add line
            </Button>
          </div>

          <div className="flex justify-between border-t border-border pt-2 text-sm">
            <span className="text-text-muted">Subtotal</span>
            <span className="font-medium text-text">{formatCents(lineItemsSubtotal)}</span>
          </div>

          {createError && <Alert tone="danger">{createError}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? "Creating…" : "Create"}
            </Button>
          </div>
        </div>
      </Dialog>

      {loading && <SkeletonRows />}
      {error && <Alert tone="danger">Couldn&apos;t load purchase orders: {error}</Alert>}
      {!loading && !error && rows.length === 0 && <EmptyStateView message="No purchase orders yet." />}

      {!loading && !error && rows.length > 0 && view === "board" && (
        <KanbanBoard
          nodeId="purchase-orders-board-kanban"
          groupKey="status"
          labelKey="supplierName"
          columns={statusColumns}
          updateMutation="purchaseOrder.updateStatus"
          updateValueKey="status"
          bind={bind}
          actions={actions}
          renderChild={() => null}
        />
      )}

      {!loading && !error && rows.length > 0 && view === "table" && (
        <Table3
          nodeId="purchase-orders-table"
          columns={["supplierName", "status", "expectedDate", "total"]}
          sortable
          filterable
          pageSize={20}
          bind={bind}
          actions={[]}
          onRowClick={(row) => openDetail(String(row.id))}
          renderChild={() => null}
        />
      )}

      {!loading && !error && rows.length > 0 && view === "list" && (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
          {rows.map((po) => (
            <li
              key={po.id}
              onClick={() => openDetail(po.id)}
              className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 transition-colors duration-[var(--duration-fast)] hover:bg-surface-hover"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="min-w-0 truncate text-sm font-medium text-text">{po.supplierName}</span>
                <span className="shrink-0">
                  <Badge tone={STATUS_TONE[po.status] ?? "neutral"}>{po.status}</Badge>
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-xs text-text-muted">Expected {new Date(po.expectedDate).toLocaleDateString()}</span>
                <span className="text-sm font-medium text-text">{formatCents(po.total)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
