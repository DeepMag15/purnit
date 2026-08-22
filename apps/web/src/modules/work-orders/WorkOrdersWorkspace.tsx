"use client";

import { z } from "zod";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../../ui/Icon";
import type { DataBinding } from "@purnit/manifest-schema";
import { useDataSourceQuery } from "../../sdui/use-data-binding";
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

export const WorkOrdersWorkspaceSchema = z.object({ title: z.string().optional() });

interface WorkOrderRow {
  id: string;
  itemId: string;
  item: { sku: string; name: string } | null;
  itemName: string;
  quantity: number;
  status: string;
  dueDate: string;
  assignedToName: string | null;
}

interface InventoryItemOption {
  id: string;
  sku: string;
  name: string;
}

const VIEWS: ViewOption[] = [
  { id: "board", label: "Board", icon: "view_kanban" },
  { id: "table", label: "Table", icon: "table_rows" },
  { id: "list", label: "List", icon: "view_list" },
];

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info" | "accent"> = {
  planned: "neutral",
  in_progress: "info",
  completed: "success",
  cancelled: "danger",
};

/**
 * Manufacturing Domain, Phase A — mirrors `ClientsWorkspace.tsx`'s exact
 * shape (Frontend Structural Redesign, Pattern B). Row click on Table/List
 * navigates to `/workspace/work-orders/[id]`.
 */
export function WorkOrdersWorkspace() {
  const router = useRouter();
  const bind: DataBinding = { source: "workOrders.list", params: {} };
  const { data, isPending, error, refetch } = useDataSourceQuery<WorkOrderRow[]>("workOrders.list");
  const { callMutation } = useRenderContext();
  const [view, setView] = useState("board");
  const [createOpen, setCreateOpen] = useState(false);
  const [newItemId, setNewItemId] = useState("");
  const [newQuantity, setNewQuantity] = useState("1");
  const [newDueDate, setNewDueDate] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const { pending: creating, error: createError, run: runCreate, clearError } = useAsyncAction();
  const { fieldErrors, validate, clearFieldError } = useFormValidation<{ itemId: string; dueDate: string }>({
    itemId: required("Select an item to produce"),
    dueDate: required("Due date is required"),
  });

  const { data: caps } = useDataSourceQuery<{ canCreate: boolean; canUpdateStatus: boolean }>("workOrders.capabilities");
  const canCreate = caps?.canCreate ?? false;
  const actions = caps?.canUpdateStatus ? [{ kind: "mutation" as const, mutation: "workOrder.updateStatus", input: { const: null } }] : [];

  const { data: itemOptionsData } = useDataSourceQuery<InventoryItemOption[]>("inventoryItems.list", {}, { enabled: canCreate });
  const itemOptions = Array.isArray(itemOptionsData) ? itemOptionsData : [];

  const rows = Array.isArray(data) ? data : [];
  const statusColumns = [...new Set(rows.map((wo) => wo.status))];

  function openCreate() {
    setNewItemId("");
    setNewQuantity("1");
    setNewDueDate("");
    setNewNotes("");
    clearError();
    clearFieldError("itemId");
    clearFieldError("dueDate");
    setCreateOpen(true);
  }

  async function handleCreate() {
    if (!validate({ itemId: newItemId, dueDate: newDueDate })) return;
    await runCreate(async () => {
      await callMutation("workOrder.create", {
        itemId: newItemId,
        quantity: Number(newQuantity) || 1,
        dueDate: newDueDate,
        ...(newNotes ? { notes: newNotes } : {}),
      });
      setCreateOpen(false);
      refetch();
    });
  }

  function openDetail(workOrderId: string) {
    router.push(`/workspace/work-orders/${workOrderId}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Work Orders"
        description="Schedule and track production."
        actions={
          canCreate && (
            <Button onClick={openCreate}>
              <Icon name="add" size={14} />
              New Work Order
            </Button>
          )
        }
        viewSwitcher={<ViewSwitcher views={VIEWS} activeId={view} onChange={setView} />}
      />

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="New Work Order">
        <div className="flex flex-col gap-3">
          <Select label="Item to produce" value={newItemId} onChange={(e) => setNewItemId(e.target.value)} error={fieldErrors.itemId} autoFocus>
            <option value="">Choose an item…</option>
            {itemOptions.map((i) => (
              <option key={i.id} value={i.id}>
                {i.sku} — {i.name}
              </option>
            ))}
          </Select>
          <Input label="Quantity" type="number" min={1} value={newQuantity} onChange={(e) => setNewQuantity(e.target.value)} />
          <Input label="Due date" type="date" value={newDueDate} onChange={(e) => setNewDueDate(e.target.value)} error={fieldErrors.dueDate} />
          <Input label="Notes (optional)" value={newNotes} onChange={(e) => setNewNotes(e.target.value)} />
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

      {isPending && <SkeletonRows />}
      {error && <Alert tone="danger">Couldn&apos;t load work orders: {error.message}</Alert>}
      {!isPending && !error && rows.length === 0 && <EmptyStateView message="No work orders yet." />}

      {!isPending && !error && rows.length > 0 && view === "board" && (
        <KanbanBoard
          nodeId="work-orders-board-kanban"
          groupKey="status"
          labelKey="itemName"
          columns={statusColumns}
          updateMutation="workOrder.updateStatus"
          updateValueKey="status"
          bind={bind}
          actions={actions}
          renderChild={() => null}
        />
      )}

      {!isPending && !error && rows.length > 0 && view === "table" && (
        <Table3
          nodeId="work-orders-table"
          columns={["itemName", "status", "quantity", "dueDate", "assignedToName"]}
          sortable
          filterable
          pageSize={20}
          bind={bind}
          actions={[]}
          onRowClick={(row) => openDetail(String(row.id))}
          renderChild={() => null}
        />
      )}

      {!isPending && !error && rows.length > 0 && view === "list" && (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
          {rows.map((wo) => (
            <li
              key={wo.id}
              onClick={() => openDetail(wo.id)}
              className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 transition-colors duration-[var(--duration-fast)] hover:bg-surface-hover"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="min-w-0 truncate text-sm font-medium text-text">{wo.item?.name ?? "Unknown item"}</span>
                <span className="shrink-0">
                  <Badge tone={STATUS_TONE[wo.status] ?? "neutral"}>{wo.status}</Badge>
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {wo.assignedToName && <span className="hidden text-xs text-text-muted sm:inline">{wo.assignedToName}</span>}
                <span className="text-xs text-text-muted">Due {new Date(wo.dueDate).toLocaleDateString()}</span>
                <span className="text-sm font-medium text-text">×{wo.quantity}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
