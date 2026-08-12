"use client";

import { z } from "zod";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../../ui/Icon";
import type { CommonRenderProps } from "../../sdui/registry";
import { useDataBinding } from "../../sdui/use-data-binding";
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
import { dollarsToCents } from "../invoices/money";

export const InventoryItemsWorkspaceSchema = z.object({ title: z.string().optional() });
type Props = z.infer<typeof InventoryItemsWorkspaceSchema>;

interface InventoryItemRow {
  id: string;
  sku: string;
  name: string;
  type: string;
  unitOfMeasure: string;
  currentStock: number;
  reorderPoint: number;
  status: string;
}

const VIEWS: ViewOption[] = [
  { id: "board", label: "Board", icon: "view_kanban" },
  { id: "table", label: "Table", icon: "table_rows" },
  { id: "list", label: "List", icon: "view_list" },
];

const TYPES = ["raw_material", "finished_good"];
const TYPE_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info" | "accent"> = {
  raw_material: "info",
  finished_good: "accent",
};

/**
 * Manufacturing Domain, Phase A — mirrors `ClientsWorkspace.tsx`'s exact
 * shape (Frontend Structural Redesign, Pattern B). Board view groups by
 * `type` (raw material vs. finished good) rather than `status` — a more
 * useful grouping for a catalog than an active/discontinued split. Row
 * click on Table/List navigates to `/workspace/inventory-items/[id]`.
 */
export function InventoryItemsWorkspace({ title, bind, actions }: Props & CommonRenderProps) {
  const router = useRouter();
  const { data, loading, error, refetch } = useDataBinding(bind);
  const { callMutation } = useRenderContext();
  const [view, setView] = useState("table");
  const [createOpen, setCreateOpen] = useState(false);
  const [newSku, setNewSku] = useState("");
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState(TYPES[0]!);
  const [newUnitOfMeasure, setNewUnitOfMeasure] = useState("each");
  const [newUnitCost, setNewUnitCost] = useState("");
  const [newReorderPoint, setNewReorderPoint] = useState("");
  const { pending: creating, error: createError, run: runCreate, clearError } = useAsyncAction();
  const { fieldErrors, validate, clearFieldError } = useFormValidation<{ sku: string; name: string }>({
    sku: required("SKU is required"),
    name: required("Name is required"),
  });

  const canCreate = actions?.some((a) => a.kind === "mutation" && a.mutation === "inventoryItem.create") ?? false;

  const rows = Array.isArray(data) ? (data as InventoryItemRow[]) : [];
  const statusColumns = [...new Set(rows.map((i) => i.status))];

  function openCreate() {
    setNewSku("");
    setNewName("");
    setNewType(TYPES[0]!);
    setNewUnitOfMeasure("each");
    setNewUnitCost("");
    setNewReorderPoint("");
    clearError();
    clearFieldError("sku");
    clearFieldError("name");
    setCreateOpen(true);
  }

  async function handleCreate() {
    if (!validate({ sku: newSku, name: newName })) return;
    await runCreate(async () => {
      await callMutation("inventoryItem.create", {
        sku: newSku.trim(),
        name: newName.trim(),
        type: newType,
        unitOfMeasure: newUnitOfMeasure.trim() || "each",
        ...(newUnitCost ? { unitCost: dollarsToCents(newUnitCost) } : {}),
        ...(newReorderPoint ? { reorderPoint: Number(newReorderPoint) } : {}),
      });
      setCreateOpen(false);
      refetch();
    });
  }

  function openDetail(itemId: string) {
    router.push(`/workspace/inventory-items/${itemId}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={title ?? "Inventory"}
        description="Track raw materials, components, and finished goods."
        actions={
          canCreate && (
            <Button onClick={openCreate}>
              <Icon name="add" size={14} />
              New Item
            </Button>
          )
        }
        viewSwitcher={<ViewSwitcher views={VIEWS} activeId={view} onChange={setView} />}
      />

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="New Inventory Item">
        <div className="flex flex-col gap-3">
          <Input
            label="SKU"
            value={newSku}
            onChange={(e) => setNewSku(e.target.value)}
            error={fieldErrors.sku}
            autoFocus
          />
          <Input
            label="Name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            error={fieldErrors.name}
          />
          <Select label="Type" value={newType} onChange={(e) => setNewType(e.target.value)}>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
          <Input label="Unit of measure" value={newUnitOfMeasure} onChange={(e) => setNewUnitOfMeasure(e.target.value)} />
          <div className="flex gap-3">
            <Input
              label="Unit cost"
              type="number"
              min={0}
              step="0.01"
              value={newUnitCost}
              onChange={(e) => setNewUnitCost(e.target.value)}
              className="flex-1"
            />
            <Input
              label="Reorder point"
              type="number"
              min={0}
              value={newReorderPoint}
              onChange={(e) => setNewReorderPoint(e.target.value)}
              className="flex-1"
            />
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
      {error && <Alert tone="danger">Couldn&apos;t load inventory: {error}</Alert>}
      {!loading && !error && rows.length === 0 && <EmptyStateView message="No inventory items yet." />}

      {!loading && !error && rows.length > 0 && view === "board" && (
        <KanbanBoard
          nodeId="inventory-items-board-kanban"
          groupKey="status"
          labelKey="name"
          columns={statusColumns}
          updateMutation="inventoryItem.update"
          updateValueKey="status"
          bind={bind}
          actions={actions}
          renderChild={() => null}
        />
      )}

      {!loading && !error && rows.length > 0 && view === "table" && (
        <Table3
          nodeId="inventory-items-table"
          columns={["sku", "name", "type", "currentStock", "reorderPoint", "status"]}
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
          {rows.map((item) => (
            <li
              key={item.id}
              onClick={() => openDetail(item.id)}
              className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 transition-colors duration-[var(--duration-fast)] hover:bg-surface-hover"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="shrink-0 font-mono text-xs text-text-muted">{item.sku}</span>
                <span className="min-w-0 truncate text-sm font-medium text-text">{item.name}</span>
                <span className="shrink-0">
                  <Badge tone={TYPE_TONE[item.type] ?? "neutral"}>{item.type}</Badge>
                </span>
                {item.currentStock <= item.reorderPoint && (
                  <span className="shrink-0">
                    <Badge tone="warning">low stock</Badge>
                  </span>
                )}
              </div>
              <span className="shrink-0 text-xs text-text-muted">
                {item.currentStock} {item.unitOfMeasure}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
