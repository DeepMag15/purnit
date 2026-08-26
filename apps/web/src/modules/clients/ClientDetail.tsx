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
import { Button } from "../../ui/Button";
import { Skeleton } from "../../ui/Skeleton";
import { Alert } from "../../ui/Alert";
import { useToast } from "../../ui/Toast";
import { EmptyStateView } from "../../sdui/primitives/EmptyState";
import { CommentThread } from "../comments/CommentThread";
import { DocumentsPanel } from "../documents/DocumentsPanel";
import { formatCents } from "../invoices/money";

interface InvoiceRow {
  id: string;
  status: string;
  dueDate: string;
  total: number;
  paymentStatus: string;
}

interface ClientDetailData {
  id: string;
  name: string;
  contactEmail: string | null;
  contactPhone: string | null;
  status: string;
  accountManagerId: string | null;
  accountManagerName: string | null;
  filesProjectId: string;
  invoiceCount: number;
  canUpdate: boolean;
  canReadInvoices: boolean;
  canCreateDocuments: boolean;
  canUpdateDocuments: boolean;
  canDeleteDocuments: boolean;
  filesVisible: boolean;
}

const STATUSES = ["active", "inactive", "prospect"];
const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info" | "accent"> = {
  active: "accent",
  inactive: "neutral",
  prospect: "info",
};
const INVOICE_STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info" | "accent"> = {
  draft: "neutral",
  sent: "info",
  void: "danger",
};

/** Finance Domain, Phase A — mounted by `/workspace/clients/[clientId]`.
 * `filesProjectId` (the "chart"-equivalent backing Project) is what lets
 * Files/Discussion reuse `DocumentsPanel`/`CommentThread` completely
 * unmodified — gated on `filesVisible` from the very first commit (a
 * capability flag built in from Phase A, not retrofitted after a live bug
 * report the way Education Domain's own equivalent `materialsVisible` was). */
export function ClientDetail({ clientId }: { clientId: string }) {
  const { data, loading, error, notFound, refetch } = useEntityDetail<ClientDetailData>("clients.detail", clientId);
  const { callMutation, aiAvailable, openAiPanel } = useRenderContext();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState("overview");

  const { data: invoicesData } = useDataSourceQuery<InvoiceRow[]>("invoices.list", { clientId }, { enabled: !!data?.canReadInvoices });
  const invoices = Array.isArray(invoicesData) ? invoicesData : [];

  // Only fetched for someone who can actually reassign — same enabled-gating
  // precedent ProjectDetail.tsx's own tenantUsers fetch already uses.
  const { data: tenantUsersData } = useDataSourceQuery<{ id: string; displayName: string }[]>("users.list", {}, { enabled: !!data?.canUpdate });
  const tenantUsers = Array.isArray(tenantUsersData) ? tenantUsersData : [];

  async function handleAccountManagerChange(accountManagerId: string) {
    try {
      await callMutation("client.assignAccountManager", { id: clientId, accountManagerId });
      refetch();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't assign account manager", "danger");
    }
  }

  function summarizeAccount() {
    if (!data) return;
    const lines = [
      `Client: ${data.name}`,
      `Status: ${data.status}`,
      invoices.length > 0
        ? `Invoices: ${invoices
            .map((inv) => `${inv.status} invoice due ${new Date(inv.dueDate).toLocaleDateString()}, ${formatCents(inv.total)} (${inv.paymentStatus})`)
            .join("; ")}`
        : "No invoices yet.",
    ];
    openAiPanel(
      "clients.summarizeAccount",
      `Summarize this client's billing account. Do not recommend collection actions, write-offs, or legal steps.\n\n${lines.join("\n")}`,
    );
  }

  async function handleStatusChange(status: string) {
    try {
      await callMutation("client.updateStatus", { id: clientId, status });
      refetch();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't update client status", "danger");
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
  if (notFound) return <EmptyStateView message="Client not found, or you don't have access to it." />;
  if (error) return <Alert tone="danger">Couldn&apos;t load client: {error}</Alert>;
  if (!data) return null;

  const TABS = [
    { id: "overview", label: "Overview" },
    ...(data.canReadInvoices ? [{ id: "invoices", label: "Invoices" }] : []),
    // Client.filesProjectId isn't visible to every role that can see the
    // Client row itself — a role holding client:read but no project:read at
    // all would otherwise see these tabs shown-then-silently-empty. Hidden
    // entirely rather than that, same discipline Education Phase D's
    // materialsVisible fix established.
    ...(data.filesVisible ? [{ id: "files", label: "Files" }, { id: "discussion", label: "Discussion" }] : []),
  ];

  return (
    <DetailPageShell
      backHref="/workspace/clients"
      backLabel="Clients"
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
            <div className="flex items-center justify-between gap-2">
              <span className="shrink-0 text-text-muted">Account manager</span>
              {data.canUpdate ? (
                <Select
                  value={data.accountManagerId ?? ""}
                  onChange={(e) => e.target.value && handleAccountManagerChange(e.target.value)}
                  className="h-7 max-w-[65%] text-xs"
                >
                  <option value="">Unassigned</option>
                  {tenantUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.displayName}
                    </option>
                  ))}
                </Select>
              ) : (
                <span className="text-text">{data.accountManagerName ?? "Unassigned"}</span>
              )}
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Email</span>
              <span className="text-text">{data.contactEmail ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Phone</span>
              <span className="text-text">{data.contactPhone ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Invoices</span>
              <span className="text-text">{data.invoiceCount}</span>
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

      {activeTab === "invoices" && data.canReadInvoices && (
        <Card>
          <CardHeader
            title="Invoices"
            action={
              aiAvailable && (
                <Button size="sm" variant="secondary" onClick={summarizeAccount}>
                  Summarize Account
                </Button>
              )
            }
          />
          <CardBody>
            {invoices.length === 0 && <EmptyStateView message="No invoices yet." />}
            {invoices.length > 0 && (
              <ul className="flex flex-col divide-y divide-border">
                {invoices.map((inv) => (
                  <Link key={inv.id} href={`/workspace/invoices/${inv.id}`}>
                    <li className="flex items-center justify-between gap-3 py-2.5 hover:text-accent">
                      <div className="flex items-center gap-2">
                        <Badge tone={INVOICE_STATUS_TONE[inv.status] ?? "neutral"}>{inv.status}</Badge>
                        <span className="text-xs text-text-muted">Due {new Date(inv.dueDate).toLocaleDateString()}</span>
                      </div>
                      <span className="text-sm font-medium">{formatCents(inv.total)}</span>
                    </li>
                  </Link>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}

      {activeTab === "files" && data.filesVisible && (
        <DocumentsPanel
          projectId={data.filesProjectId}
          canCreate={data.canCreateDocuments}
          canUpdate={data.canUpdateDocuments}
          canDelete={data.canDeleteDocuments}
          noun="file"
        />
      )}

      {activeTab === "discussion" && data.filesVisible && (
        <CommentThread
          entityType="project"
          entityId={data.filesProjectId}
          mentionCandidates={data.accountManagerId && data.accountManagerName ? [{ id: data.accountManagerId, displayName: data.accountManagerName }] : []}
        />
      )}
    </DetailPageShell>
  );
}
