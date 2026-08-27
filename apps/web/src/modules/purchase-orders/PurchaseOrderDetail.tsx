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
import { formatCents } from "../invoices/money";

interface LineItem {
  inventoryItemId: string;
  description: string;
  quantity: number;
  unitCost: number;
  amount: number;
}

interface PurchaseOrderDetailData {
  id: string;
  supplierId: string;
  supplierName: string;
  status: string;
  expectedDate: string;
  lineItems: LineItem[];
  subtotal: number;
  tax: number;
  total: number;
  canUpdate: boolean;
  canReceive: boolean;
}

const STATUSES = ["draft", "submitted", "cancelled"];
const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info" | "accent"> = {
  draft: "neutral",
  submitted: "info",
  received: "success",
  cancelled: "danger",
};

/** Manufacturing Domain, Phase A — mounted by
 * `/workspace/purchase-orders/[poId]`. The "Receive" button is the
 * procurement half of this domain's real segregation-of-duties control:
 * gated on `canReceive` (`purchaseOrder:receive`, held by Warehouse
 * Staff/Admin only — Procurement Officer can create/submit but never
 * receive its own order), and only enabled once "submitted".
 *
 * Manufacturing Domain, Phase D — "Summarize Purchase Order" (gated on
 * `aiAvailable`) formats the already-fetched `data` (supplier, line items,
 * status, total) — zero new fetch needed. */
export function PurchaseOrderDetail({ purchaseOrderId }: { purchaseOrderId: string }) {
  const { data, loading, error, notFound, refetch } = useEntityDetail<PurchaseOrderDetailData>("purchaseOrders.detail", purchaseOrderId);
  const { callMutation, aiAvailable, openAiPanel } = useRenderContext();
  const toast = useToast();
  const [receiving, setReceiving] = useState(false);

  function summarizePurchaseOrder() {
    if (!data) return;
    const lines = [
      `Supplier: ${data.supplierName}`,
      `Status: ${data.status}`,
      `Expected date: ${new Date(data.expectedDate).toLocaleDateString()}`,
      data.lineItems.length > 0
        ? `Line items: ${data.lineItems.map((li) => `${li.description} (qty ${li.quantity} @ ${formatCents(li.unitCost)} = ${formatCents(li.amount)})`).join("; ")}`
        : "No line items.",
      `Total: ${formatCents(data.total)}`,
    ];
    openAiPanel(
      "purchaseOrders.summarize",
      `Summarize this purchase order. Do not recommend contract terms, pricing negotiations, or vendor selection — only summarize this order's contents and status.\n\n${lines.join("\n")}`,
    );
  }

  async function handleStatusChange(status: string) {
    try {
      await callMutation("purchaseOrder.updateStatus", { id: purchaseOrderId, status });
      refetch();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't update purchase order status", "danger");
    }
  }

  async function handleReceive() {
    setReceiving(true);
    try {
      await callMutation("purchaseOrder.receive", { id: purchaseOrderId });
      refetch();
      toast.show("Purchase order received — stock updated.", "success");
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't receive purchase order", "danger");
    } finally {
      setReceiving(false);
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
  if (notFound) return <EmptyStateView message="Purchase order not found, or you don't have access to it." />;
  if (error) return <Alert tone="danger">Couldn&apos;t load purchase order: {error}</Alert>;
  if (!data) return null;

  const canReceiveNow = data.canReceive && data.status === "submitted";

  return (
    <DetailPageShell
      backHref="/workspace/purchase-orders"
      backLabel="Purchase Orders"
      title={`Purchase Order — ${data.supplierName}`}
      status={!data.canUpdate ? { label: data.status, tone: STATUS_TONE[data.status] ?? "neutral" } : undefined}
      actions={
        <div className="flex items-center gap-2">
          {aiAvailable && (
            <Button size="sm" variant="secondary" onClick={summarizePurchaseOrder}>
              Summarize Purchase Order
            </Button>
          )}
          {data.canUpdate && data.status !== "received" && (
            <Select value={data.status} onChange={(e) => handleStatusChange(e.target.value)} className="h-8 text-xs">
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          )}
          {data.canReceive && (
            <Button size="sm" onClick={handleReceive} disabled={!canReceiveNow || receiving}>
              {receiving ? "Receiving…" : "Receive"}
            </Button>
          )}
        </div>
      }
      metadata={
        <Card>
          <CardHeader title="Details" />
          <CardBody className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-text-muted">Supplier</span>
              <Link href={`/workspace/suppliers/${data.supplierId}`} className="text-accent hover:underline">
                {data.supplierName}
              </Link>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Expected date</span>
              <span className="text-text">{new Date(data.expectedDate).toLocaleDateString()}</span>
            </div>
          </CardBody>
        </Card>
      }
    >
      <Card>
        <CardHeader title="Line items" />
        <CardBody>
          {data.canReceive && data.status !== "submitted" && data.status !== "received" && (
            <p className="mb-3 text-xs text-text-muted">A purchase order can only be received once it&apos;s been submitted.</p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-text-muted">
                  <th className="py-2 pr-3 font-medium">Description</th>
                  <th className="py-2 pr-3 font-medium">Qty</th>
                  <th className="py-2 pr-3 font-medium">Unit cost</th>
                  <th className="py-2 pr-3 font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.lineItems.map((li, i) => (
                  <tr key={i}>
                    <td className="py-2 pr-3 text-text">{li.description}</td>
                    <td className="py-2 pr-3 text-text-muted">{li.quantity}</td>
                    <td className="py-2 pr-3 text-text-muted">{formatCents(li.unitCost)}</td>
                    <td className="py-2 pr-3 text-text">{formatCents(li.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-col items-end gap-1 border-t border-border pt-3 text-sm">
            <div className="flex w-40 justify-between">
              <span className="text-text-muted">Subtotal</span>
              <span className="text-text">{formatCents(data.subtotal)}</span>
            </div>
            <div className="flex w-40 justify-between">
              <span className="text-text-muted">Tax</span>
              <span className="text-text">{formatCents(data.tax)}</span>
            </div>
            <div className="flex w-40 justify-between font-medium">
              <span className="text-text">Total</span>
              <span className="text-text">{formatCents(data.total)}</span>
            </div>
          </div>
        </CardBody>
      </Card>
    </DetailPageShell>
  );
}
