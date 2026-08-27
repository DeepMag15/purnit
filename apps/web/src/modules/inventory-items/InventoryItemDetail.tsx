"use client";

import { useState } from "react";
import { useEntityDetail } from "../../sdui/use-entity-detail";
import { useRenderContext } from "../../sdui/render-context";
import { DetailPageShell } from "../../ui/DetailPageShell";
import { Tabs } from "../../ui/Tabs";
import { Card, CardHeader, CardBody } from "../../ui/Card";
import { Select } from "../../ui/Select";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Input } from "../../ui/Input";
import { Icon } from "../../ui/Icon";
import { Skeleton } from "../../ui/Skeleton";
import { Alert } from "../../ui/Alert";
import { useToast } from "../../ui/Toast";
import { EmptyStateView } from "../../sdui/primitives/EmptyState";
import { DocumentsPanel } from "../documents/DocumentsPanel";
import { CommentThread } from "../comments/CommentThread";
import { formatCents } from "../invoices/money";
import { BomTab } from "./BomTab";

interface InventoryItemDetailData {
  id: string;
  filesProjectId: string;
  sku: string;
  name: string;
  type: string;
  unitOfMeasure: string;
  unitCost: number;
  currentStock: number;
  reorderPoint: number;
  status: string;
  bomLineCount: number;
  canUpdate: boolean;
  canReadBom: boolean;
  canCreateDocuments: boolean;
  canUpdateDocuments: boolean;
  canDeleteDocuments: boolean;
  filesVisible: boolean;
}

const STATUSES = ["active", "discontinued"];
const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info" | "accent"> = {
  active: "accent",
  discontinued: "neutral",
};

/** Manufacturing Domain, Phase A — mounted by
 * `/workspace/inventory-items/[itemId]`. The one Manufacturing entity with
 * a backing Project (`filesProjectId`) — spec sheets/QC docs/photos +
 * discussion per SKU, mirrors `ClientDetail.tsx` exactly, `filesVisible`
 * gated from this very first commit (the process lesson every domain since
 * Education Phase D now applies proactively). */
export function InventoryItemDetail({ itemId }: { itemId: string }) {
  const { data, loading, error, notFound, refetch } = useEntityDetail<InventoryItemDetailData>("inventoryItems.detail", itemId);
  const { callMutation } = useRenderContext();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState("overview");
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustDelta, setAdjustDelta] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjusting, setAdjusting] = useState(false);
  const [adjustError, setAdjustError] = useState<string | null>(null);

  async function handleStatusChange(status: string) {
    try {
      await callMutation("inventoryItem.update", { id: itemId, status });
      refetch();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't update item status", "danger");
    }
  }

  function openAdjustStock() {
    setAdjustDelta("");
    setAdjustReason("");
    setAdjustError(null);
    setAdjustOpen(true);
  }

  async function handleAdjustStock() {
    const delta = Number(adjustDelta);
    if (!Number.isInteger(delta) || delta === 0) {
      setAdjustError("Enter a non-zero whole number (negative to remove stock, positive to add)");
      return;
    }
    if (!adjustReason.trim()) {
      setAdjustError("A reason is required");
      return;
    }
    setAdjusting(true);
    setAdjustError(null);
    try {
      await callMutation("inventoryItem.adjustStock", { id: itemId, delta, reason: adjustReason.trim() });
      setAdjustOpen(false);
      refetch();
    } catch (err) {
      setAdjustError(err instanceof Error ? err.message : "Couldn't adjust stock");
    } finally {
      setAdjusting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (notFound) return <EmptyStateView message="Inventory item not found, or you don't have access to it." />;
  if (error) return <Alert tone="danger">Couldn&apos;t load inventory item: {error}</Alert>;
  if (!data) return null;

  const TABS = [
    { id: "overview", label: "Overview" },
    ...(data.canReadBom ? [{ id: "bom", label: "Bill of Materials" }] : []),
    ...(data.filesVisible ? [{ id: "files", label: "Files" }, { id: "discussion", label: "Discussion" }] : []),
  ];

  return (
    <DetailPageShell
      backHref="/workspace/inventory-items"
      backLabel="Inventory"
      title={data.name}
      status={!data.canUpdate ? { label: data.status, tone: STATUS_TONE[data.status] ?? "neutral" } : undefined}
      actions={
        data.canUpdate && (
          <Select value={data.status} onChange={(e) => handleStatusChange(e.target.value)} className="h-8 text-xs">
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        )
      }
      tabs={TABS.length > 1 ? <Tabs items={TABS} activeId={activeTab} onChange={setActiveTab} /> : undefined}
      metadata={
        <Card>
          <CardHeader title="Details" />
          <CardBody className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-text-muted">SKU</span>
              <span className="font-mono text-text">{data.sku}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Type</span>
              <span className="text-text">{data.type}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Unit cost</span>
              <span className="text-text">{formatCents(data.unitCost)}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-text-muted">Current stock</span>
              <span className="flex items-center gap-2">
                <span className="text-text">
                  {data.currentStock} {data.unitOfMeasure}
                </span>
                {data.canUpdate && (
                  <button
                    type="button"
                    onClick={openAdjustStock}
                    title="Adjust stock"
                    className="text-text-muted transition-colors duration-[var(--duration-fast)] hover:text-text"
                  >
                    <Icon name="tune" size={15} />
                  </button>
                )}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Reorder point</span>
              <span className="text-text">{data.reorderPoint}</span>
            </div>
          </CardBody>
        </Card>
      }
    >
      {activeTab === "overview" && (
        <Card>
          <CardHeader title="Overview" />
          <CardBody>
            <p className="text-sm text-text-muted">
              {data.name} ({data.sku}) — {data.status}
            </p>
          </CardBody>
        </Card>
      )}

      {activeTab === "bom" && data.canReadBom && <BomTab itemId={itemId} itemName={data.name} canUpdate={data.canUpdate} />}

      {activeTab === "files" && data.filesVisible && (
        <DocumentsPanel
          projectId={data.filesProjectId}
          canCreate={data.canCreateDocuments}
          canUpdate={data.canUpdateDocuments}
          canDelete={data.canDeleteDocuments}
          noun="file"
        />
      )}

      {activeTab === "discussion" && data.filesVisible && <CommentThread entityType="project" entityId={data.filesProjectId} noun="note" />}

      <Dialog open={adjustOpen} onClose={() => setAdjustOpen(false)} title="Adjust Stock">
        <div className="flex flex-col gap-3">
          <Input
            label="Adjustment"
            type="number"
            value={adjustDelta}
            onChange={(e) => setAdjustDelta(e.target.value)}
            placeholder="e.g. -5 or 20"
            hint="Negative to remove stock (damage, shrinkage), positive to add (recount, restock)."
            autoFocus
          />
          <Input
            label="Reason"
            value={adjustReason}
            onChange={(e) => setAdjustReason(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdjustStock()}
            placeholder="e.g. Cycle count correction"
          />
          {adjustError && <Alert tone="danger">{adjustError}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAdjustOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAdjustStock} disabled={adjusting}>
              {adjusting ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </Dialog>
    </DetailPageShell>
  );
}
