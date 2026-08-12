"use client";

import { useState } from "react";
import { useDataSourceQuery } from "../../sdui/use-data-binding";
import { useRenderContext } from "../../sdui/render-context";
import { Card, CardHeader, CardBody } from "../../ui/Card";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Input } from "../../ui/Input";
import { Select } from "../../ui/Select";
import { Icon } from "../../ui/Icon";
import { Alert } from "../../ui/Alert";
import { SkeletonRows } from "../../ui/Skeleton";
import { EmptyStateView } from "../../sdui/primitives/EmptyState";

interface BomLineRow {
  id: string;
  componentItemId: string;
  quantityRequired: number;
  component: { sku: string; name: string; unitOfMeasure: string; currentStock: number } | null;
}

interface InventoryItemOption {
  id: string;
  sku: string;
  name: string;
}

/** Manufacturing Domain, Phase A — nested inside `InventoryItemDetail`'s own
 * "Bill of Materials" tab, mirrors `PaymentsTab.tsx`'s own "nested inside a
 * detail page's own tab, own data fetch, not SDUI-registered itself"
 * pattern exactly. The recipe: each row is `quantityRequired` units of
 * `component` needed to build 1 unit of this item. */
export function BomTab({ itemId, canUpdate }: { itemId: string; canUpdate: boolean }) {
  const { callMutation } = useRenderContext();
  const [addOpen, setAddOpen] = useState(false);
  const [componentItemId, setComponentItemId] = useState("");
  const [quantityRequired, setQuantityRequired] = useState("1");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { data, isPending, error, refetch } = useDataSourceQuery<BomLineRow[]>("bomLines.list", { parentItemId: itemId });
  const lines = Array.isArray(data) ? data : [];

  const { data: itemOptionsData } = useDataSourceQuery<InventoryItemOption[]>("inventoryItems.list", {}, { enabled: canUpdate && addOpen });
  const itemOptions = (Array.isArray(itemOptionsData) ? itemOptionsData : []).filter((i) => i.id !== itemId);

  function openAdd() {
    setComponentItemId("");
    setQuantityRequired("1");
    setSaveError(null);
    setAddOpen(true);
  }

  async function handleAdd() {
    const qty = Number(quantityRequired);
    if (!componentItemId || !(qty > 0)) {
      setSaveError("Choose a component and a quantity greater than 0");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await callMutation("bomLine.create", { parentItemId: itemId, componentItemId, quantityRequired: qty });
      setAddOpen(false);
      refetch();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Couldn't add component");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(lineId: string) {
    try {
      await callMutation("bomLine.delete", { id: lineId });
      refetch();
    } catch {
      // Errors here are rare (row already gone) — a silent refetch is
      // enough, same as KanbanBoard's own drag-failure handling.
    }
  }

  return (
    <Card>
      <CardHeader
        title="Bill of Materials"
        action={
          canUpdate && (
            <Button size="sm" onClick={openAdd}>
              <Icon name="add" size={14} />
              Add Component
            </Button>
          )
        }
      />
      <CardBody>
        {isPending && <SkeletonRows />}
        {!isPending && error && <Alert tone="danger">Couldn&apos;t load bill of materials: {error instanceof Error ? error.message : String(error)}</Alert>}
        {!isPending && !error && lines.length === 0 && <EmptyStateView message="No components on this recipe yet." />}
        {!isPending && !error && lines.length > 0 && (
          <ul className="flex flex-col divide-y divide-border">
            {lines.map((line) => (
              <li key={line.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-text">{line.component?.name ?? "Unknown item"}</span>
                  <span className="text-xs text-text-muted">
                    {line.component?.sku} · needs {line.quantityRequired} {line.component?.unitOfMeasure} · {line.component?.currentStock ?? 0} in stock
                  </span>
                </div>
                {canUpdate && (
                  <Button size="sm" variant="secondary" onClick={() => handleRemove(line.id)}>
                    <Icon name="close" size={14} />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} title="Add Component">
        <div className="flex flex-col gap-3">
          <Select label="Component" value={componentItemId} onChange={(e) => setComponentItemId(e.target.value)} autoFocus>
            <option value="">Choose an item…</option>
            {itemOptions.map((i) => (
              <option key={i.id} value={i.id}>
                {i.sku} — {i.name}
              </option>
            ))}
          </Select>
          <Input
            label="Quantity required per unit"
            type="number"
            min={1}
            value={quantityRequired}
            onChange={(e) => setQuantityRequired(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
          {saveError && <Alert tone="danger">{saveError}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAdd} disabled={saving}>
              {saving ? "Adding…" : "Add"}
            </Button>
          </div>
        </div>
      </Dialog>
    </Card>
  );
}
