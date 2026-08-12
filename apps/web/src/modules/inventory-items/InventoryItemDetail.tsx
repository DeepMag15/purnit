"use client";

import { useState } from "react";
import { useEntityDetail } from "../../sdui/use-entity-detail";
import { useRenderContext } from "../../sdui/render-context";
import { DetailPageShell } from "../../ui/DetailPageShell";
import { Tabs } from "../../ui/Tabs";
import { Card, CardHeader, CardBody } from "../../ui/Card";
import { Select } from "../../ui/Select";
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

  async function handleStatusChange(status: string) {
    try {
      await callMutation("inventoryItem.update", { id: itemId, status });
      refetch();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't update item status", "danger");
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
            <div className="flex justify-between">
              <span className="text-text-muted">Current stock</span>
              <span className="text-text">
                {data.currentStock} {data.unitOfMeasure}
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
        />
      )}

      {activeTab === "discussion" && data.filesVisible && <CommentThread entityType="project" entityId={data.filesProjectId} mentionCandidates={[]} />}
    </DetailPageShell>
  );
}
