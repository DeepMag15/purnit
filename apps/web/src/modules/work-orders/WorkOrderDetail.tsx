"use client";

import { useState } from "react";
import Link from "next/link";
import { useEntityDetail } from "../../sdui/use-entity-detail";
import { useRenderContext } from "../../sdui/render-context";
import { DetailPageShell } from "../../ui/DetailPageShell";
import { Card, CardHeader, CardBody } from "../../ui/Card";
import { Select } from "../../ui/Select";
import { Button } from "../../ui/Button";
import { Skeleton } from "../../ui/Skeleton";
import { Alert } from "../../ui/Alert";
import { useToast } from "../../ui/Toast";
import { EmptyStateView } from "../../sdui/primitives/EmptyState";

interface WorkOrderDetailData {
  id: string;
  itemId: string;
  item: { sku: string; name: string } | null;
  quantity: number;
  status: string;
  dueDate: string;
  assignedToId: string | null;
  assignedToName: string | null;
  notes: string | null;
  canUpdate: boolean;
  canComplete: boolean;
}

const STATUSES = ["planned", "in_progress", "cancelled"];
const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info" | "accent"> = {
  planned: "neutral",
  in_progress: "info",
  completed: "success",
  cancelled: "danger",
};

/** Manufacturing Domain, Phase A — mounted by `/workspace/work-orders/[woId]`.
 * The "Complete" button is the production half of this domain's real
 * segregation-of-duties control: gated on `canComplete`
 * (`workOrder:complete`, held by Warehouse Staff/Admin only — Production
 * Planner can schedule but never complete its own work order), and only
 * enabled once "in_progress". */
export function WorkOrderDetail({ workOrderId }: { workOrderId: string }) {
  const { data, loading, error, notFound, refetch } = useEntityDetail<WorkOrderDetailData>("workOrders.detail", workOrderId);
  const { callMutation } = useRenderContext();
  const toast = useToast();
  const [completing, setCompleting] = useState(false);

  async function handleStatusChange(status: string) {
    try {
      await callMutation("workOrder.updateStatus", { id: workOrderId, status });
      refetch();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't update work order status", "danger");
    }
  }

  async function handleComplete() {
    setCompleting(true);
    try {
      await callMutation("workOrder.complete", { id: workOrderId });
      refetch();
      toast.show("Work order completed — stock updated.", "success");
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't complete work order", "danger");
    } finally {
      setCompleting(false);
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
  if (notFound) return <EmptyStateView message="Work order not found, or you don't have access to it." />;
  if (error) return <Alert tone="danger">Couldn&apos;t load work order: {error}</Alert>;
  if (!data) return null;

  const canCompleteNow = data.canComplete && data.status === "in_progress";

  return (
    <DetailPageShell
      backHref="/workspace/work-orders"
      backLabel="Work Orders"
      title={`Work Order — ${data.item?.name ?? "Unknown item"}`}
      status={!data.canUpdate ? { label: data.status, tone: STATUS_TONE[data.status] ?? "neutral" } : undefined}
      actions={
        <div className="flex items-center gap-2">
          {data.canUpdate && data.status !== "completed" && (
            <Select value={data.status} onChange={(e) => handleStatusChange(e.target.value)} className="h-8 text-xs">
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          )}
          {data.canComplete && (
            <Button size="sm" onClick={handleComplete} disabled={!canCompleteNow || completing}>
              {completing ? "Completing…" : "Complete"}
            </Button>
          )}
        </div>
      }
      metadata={
        <Card>
          <CardHeader title="Details" />
          <CardBody className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-text-muted">Item</span>
              <Link href={`/workspace/inventory-items/${data.itemId}`} className="text-accent hover:underline">
                {data.item?.name ?? "Unknown item"}
              </Link>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">SKU</span>
              <span className="font-mono text-text">{data.item?.sku ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Quantity</span>
              <span className="text-text">{data.quantity}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Due date</span>
              <span className="text-text">{new Date(data.dueDate).toLocaleDateString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Assigned to</span>
              <span className="text-text">{data.assignedToName ?? "Unassigned"}</span>
            </div>
          </CardBody>
        </Card>
      }
    >
      <Card>
        <CardHeader title="Overview" />
        <CardBody>
          {data.canComplete && data.status !== "in_progress" && data.status !== "completed" && (
            <p className="mb-3 text-xs text-text-muted">A work order can only be completed once it&apos;s in progress.</p>
          )}
          <p className="text-sm text-text-muted">
            Produce {data.quantity} × {data.item?.name ?? "this item"}, due {new Date(data.dueDate).toLocaleDateString()}.
          </p>
          {data.notes && <p className="mt-2 text-sm text-text">{data.notes}</p>}
        </CardBody>
      </Card>
    </DetailPageShell>
  );
}
