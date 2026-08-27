"use client";

import { useState } from "react";
import Link from "next/link";
import { useEntityDetail } from "../../sdui/use-entity-detail";
import { useRenderContext } from "../../sdui/render-context";
import { useDataSourceQuery } from "../../sdui/use-data-binding";
import { DetailPageShell } from "../../ui/DetailPageShell";
import { Tabs } from "../../ui/Tabs";
import { Card, CardHeader, CardBody } from "../../ui/Card";
import { Badge } from "../../ui/Badge";
import { Select } from "../../ui/Select";
import { Skeleton } from "../../ui/Skeleton";
import { Alert } from "../../ui/Alert";
import { useToast } from "../../ui/Toast";
import { EmptyStateView } from "../../sdui/primitives/EmptyState";
import { formatCents } from "../invoices/money";

interface PurchaseOrderRow {
  id: string;
  status: string;
  expectedDate: string;
  total: number;
}

interface SupplierDetailData {
  id: string;
  name: string;
  contactEmail: string | null;
  contactPhone: string | null;
  status: string;
  purchaseOrderCount: number;
  canUpdate: boolean;
  canReadPurchaseOrders: boolean;
}

const STATUSES = ["active", "inactive"];
const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info" | "accent"> = {
  active: "accent",
  inactive: "neutral",
};
const PO_STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info" | "accent"> = {
  draft: "neutral",
  submitted: "info",
  received: "success",
  cancelled: "danger",
};

/** Manufacturing Domain, Phase A — mounted by `/workspace/suppliers/[supplierId]`.
 * No Files/Discussion tabs — Supplier deliberately doesn't own a backing
 * Project in this domain (InventoryItem is the one entity that does),
 * unlike ClientDetail. */
export function SupplierDetail({ supplierId }: { supplierId: string }) {
  const { data, loading, error, notFound, refetch } = useEntityDetail<SupplierDetailData>("suppliers.detail", supplierId);
  const { callMutation } = useRenderContext();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState("overview");

  const { data: ordersData } = useDataSourceQuery<PurchaseOrderRow[]>("purchaseOrders.list", { supplierId }, { enabled: !!data?.canReadPurchaseOrders });
  const orders = Array.isArray(ordersData) ? ordersData : [];

  async function handleStatusChange(status: string) {
    try {
      await callMutation("supplier.updateStatus", { id: supplierId, status });
      refetch();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't update supplier status", "danger");
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
  if (notFound) return <EmptyStateView message="Supplier not found, or you don't have access to it." />;
  if (error) return <Alert tone="danger">Couldn&apos;t load supplier: {error}</Alert>;
  if (!data) return null;

  const TABS = [
    { id: "overview", label: "Overview" },
    ...(data.canReadPurchaseOrders ? [{ id: "purchase-orders", label: "Purchase Orders" }] : []),
  ];

  return (
    <DetailPageShell
      backHref="/workspace/suppliers"
      backLabel="Suppliers"
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
              <span className="text-text-muted">Email</span>
              <span className="text-text">{data.contactEmail ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Phone</span>
              <span className="text-text">{data.contactPhone ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Purchase orders</span>
              <span className="text-text">{data.purchaseOrderCount}</span>
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
              {data.name} — {data.status}
            </p>
          </CardBody>
        </Card>
      )}

      {activeTab === "purchase-orders" && data.canReadPurchaseOrders && (
        <Card>
          <CardHeader title="Purchase Orders" />
          <CardBody>
            {orders.length === 0 && <EmptyStateView message="No purchase orders yet." />}
            {orders.length > 0 && (
              <ul className="flex flex-col divide-y divide-border">
                {orders.map((po) => (
                  <Link key={po.id} href={`/workspace/purchase-orders/${po.id}`}>
                    <li className="flex items-center justify-between gap-3 py-2.5 hover:text-accent">
                      <div className="flex items-center gap-2">
                        <Badge tone={PO_STATUS_TONE[po.status] ?? "neutral"}>{po.status}</Badge>
                        <span className="text-xs text-text-muted">Expected {new Date(po.expectedDate).toLocaleDateString()}</span>
                      </div>
                      <span className="text-sm font-medium">{formatCents(po.total)}</span>
                    </li>
                  </Link>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}
    </DetailPageShell>
  );
}
