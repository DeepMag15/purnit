"use client";

import { useState } from "react";
import Link from "next/link";
import { useEntityDetail } from "../../sdui/use-entity-detail";
import { useRenderContext } from "../../sdui/render-context";
import { DetailPageShell } from "../../ui/DetailPageShell";
import { Tabs } from "../../ui/Tabs";
import { Card, CardHeader, CardBody } from "../../ui/Card";
import { Badge } from "../../ui/Badge";
import { Select } from "../../ui/Select";
import { Skeleton } from "../../ui/Skeleton";
import { Alert } from "../../ui/Alert";
import { useToast } from "../../ui/Toast";
import { EmptyStateView } from "../../sdui/primitives/EmptyState";
import { formatCents } from "./money";
import { PaymentsTab } from "./PaymentsTab";

interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

interface InvoiceDetailData {
  id: string;
  clientId: string;
  clientName: string;
  status: string;
  issueDate: string;
  dueDate: string;
  lineItems: LineItem[];
  subtotal: number;
  tax: number;
  total: number;
  amountPaid: number;
  paymentStatus: string;
  canUpdate: boolean;
  canReadPayments: boolean;
  canRecordPayments: boolean;
}

const STATUSES = ["draft", "sent", "void"];
const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info" | "accent"> = {
  draft: "neutral",
  sent: "info",
  void: "danger",
};
const PAYMENT_STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info" | "accent"> = {
  unpaid: "neutral",
  partial: "warning",
  paid: "success",
  overdue: "danger",
};

/** Finance Domain, Phase A — mounted by `/workspace/invoices/[invoiceId]`.
 * The Payments tab is gated on `canReadPayments` — Sales Rep can see the
 * invoice itself (`invoice:read:own`) but holds zero `payment:*`, the
 * concrete "structurally excluded from billing" proof for this domain. */
export function InvoiceDetail({ invoiceId }: { invoiceId: string }) {
  const { data, loading, error, notFound, refetch } = useEntityDetail<InvoiceDetailData>("invoices.detail", invoiceId);
  const { callMutation } = useRenderContext();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState("overview");

  async function handleStatusChange(status: string) {
    try {
      await callMutation("invoice.updateStatus", { id: invoiceId, status });
      refetch();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't update invoice status", "danger");
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
  if (notFound) return <EmptyStateView message="Invoice not found, or you don't have access to it." />;
  if (error) return <Alert tone="danger">Couldn&apos;t load invoice: {error}</Alert>;
  if (!data) return null;

  const TABS = [
    { id: "overview", label: "Overview" },
    ...(data.canReadPayments ? [{ id: "payments", label: "Payments" }] : []),
  ];

  return (
    <DetailPageShell
      backHref="/workspace/invoices"
      backLabel="Invoices"
      title={`Invoice — ${data.clientName}`}
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
              <span className="text-text-muted">Client</span>
              <Link href={`/workspace/clients/${data.clientId}`} className="text-accent hover:underline">
                {data.clientName}
              </Link>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Issue date</span>
              <span className="text-text">{new Date(data.issueDate).toLocaleDateString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Due date</span>
              <span className="text-text">{new Date(data.dueDate).toLocaleDateString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Payment status</span>
              <Badge tone={PAYMENT_STATUS_TONE[data.paymentStatus] ?? "neutral"}>{data.paymentStatus}</Badge>
            </div>
          </CardBody>
        </Card>
      }
    >
      {activeTab === "overview" && (
        <Card>
          <CardHeader title="Line items" />
          <CardBody>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-text-muted">
                    <th className="py-2 pr-3 font-medium">Description</th>
                    <th className="py-2 pr-3 font-medium">Qty</th>
                    <th className="py-2 pr-3 font-medium">Unit price</th>
                    <th className="py-2 pr-3 font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.lineItems.map((li, i) => (
                    <tr key={i}>
                      <td className="py-2 pr-3 text-text">{li.description}</td>
                      <td className="py-2 pr-3 text-text-muted">{li.quantity}</td>
                      <td className="py-2 pr-3 text-text-muted">{formatCents(li.unitPrice)}</td>
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
              <div className="flex w-40 justify-between text-xs text-text-muted">
                <span>Paid</span>
                <span>{formatCents(data.amountPaid)}</span>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      {activeTab === "payments" && data.canReadPayments && (
        <PaymentsTab
          invoiceId={invoiceId}
          invoiceStatus={data.status}
          invoiceTotal={data.total}
          canRecordPayments={data.canRecordPayments}
          onRecorded={refetch}
        />
      )}
    </DetailPageShell>
  );
}
