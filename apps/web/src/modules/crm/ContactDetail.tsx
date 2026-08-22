"use client";

import { useState } from "react";
import { useEntityDetail } from "../../sdui/use-entity-detail";
import { useRenderContext } from "../../sdui/render-context";
import { useDataSourceQuery } from "../../sdui/use-data-binding";
import { DetailPageShell } from "../../ui/DetailPageShell";
import { Card, CardHeader, CardBody } from "../../ui/Card";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Input } from "../../ui/Input";
import { Select } from "../../ui/Select";
import { StatusDot, type StatusTone } from "../../ui/StatusDot";
import { Icon } from "../../ui/Icon";
import { Skeleton } from "../../ui/Skeleton";
import { Alert } from "../../ui/Alert";
import { useToast } from "../../ui/Toast";
import { EmptyStateView } from "../../sdui/primitives/EmptyState";
import { formatCents } from "../invoices/money";

interface DealRow {
  id: string;
  title: string;
  valueCents: number;
  stage: string;
  ownerId: string | null;
  expectedCloseDate: string | null;
}

interface ContactDetailData {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  ownerId: string | null;
  ownerName: string | null;
  canUpdate: boolean;
  canCreateDeals: boolean;
  deals: DealRow[];
}

interface UserOption {
  id: string;
  displayName: string;
}

const STAGE_TONE: Record<string, StatusTone> = {
  new: "queued",
  qualified: "progress",
  proposal: "review",
  won: "done",
  lost: "danger",
};

/** CRM — mounted by `/workspace/crm/contacts/[contactId]`. No backing
 * Files/Discussion Project (a deliberate, disclosed v1 scope trim vs.
 * Client/Patient/Course's own pattern — see crm.prisma's own doc comment)
 * — this page is just contact info + its linked deals. */
export function ContactDetail({ contactId }: { contactId: string }) {
  const { data, loading, error, notFound, refetch } = useEntityDetail<ContactDetailData>("contact.detail", contactId);
  const { callMutation } = useRenderContext();
  const toast = useToast();

  const { data: userOptionsData } = useDataSourceQuery<UserOption[]>("users.list", {}, { enabled: !!data?.canUpdate || !!data?.canCreateDeals });
  const userOptions = Array.isArray(userOptionsData) ? userOptionsData : [];

  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editCompany, setEditCompany] = useState("");
  const [editOwnerId, setEditOwnerId] = useState("");
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [dealOpen, setDealOpen] = useState(false);
  const [dealTitle, setDealTitle] = useState("");
  const [dealValue, setDealValue] = useState("");
  const [savingDeal, setSavingDeal] = useState(false);
  const [dealError, setDealError] = useState<string | null>(null);

  function openEdit() {
    if (!data) return;
    setEditName(data.name);
    setEditEmail(data.email ?? "");
    setEditPhone(data.phone ?? "");
    setEditCompany(data.companyName ?? "");
    setEditOwnerId(data.ownerId ?? "");
    setEditError(null);
    setEditOpen(true);
  }

  async function handleEdit() {
    if (!editName.trim()) {
      setEditError("Name is required");
      return;
    }
    setSaving(true);
    setEditError(null);
    try {
      await callMutation("contact.update", {
        id: contactId,
        name: editName.trim(),
        ...(editEmail ? { email: editEmail } : {}),
        ...(editPhone ? { phone: editPhone } : {}),
        ...(editCompany ? { companyName: editCompany } : {}),
        ...(editOwnerId ? { ownerId: editOwnerId } : {}),
      });
      toast.show("Contact updated");
      setEditOpen(false);
      refetch();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Couldn't update contact");
    } finally {
      setSaving(false);
    }
  }

  function openCreateDeal() {
    setDealTitle("");
    setDealValue("");
    setDealError(null);
    setDealOpen(true);
  }

  async function handleCreateDeal() {
    if (!dealTitle.trim()) {
      setDealError("Title is required");
      return;
    }
    setSavingDeal(true);
    setDealError(null);
    try {
      await callMutation("deal.create", {
        contactId,
        title: dealTitle.trim(),
        ...(dealValue ? { valueCents: Math.round(Number(dealValue) * 100) } : {}),
      });
      toast.show("Deal created");
      setDealOpen(false);
      refetch();
    } catch (err) {
      setDealError(err instanceof Error ? err.message : "Couldn't create deal");
    } finally {
      setSavingDeal(false);
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
  if (notFound) return <EmptyStateView message="Contact not found, or you don't have access to it." />;
  if (error) return <Alert tone="danger">Couldn&apos;t load contact: {error}</Alert>;
  if (!data) return null;

  return (
    <DetailPageShell
      backHref="/workspace/crm"
      backLabel="CRM"
      title={data.name}
      actions={
        data.canUpdate && (
          <Button variant="secondary" size="sm" onClick={openEdit}>
            <Icon name="edit" size={14} />
            Edit
          </Button>
        )
      }
      metadata={
        <Card>
          <CardHeader title="Details" />
          <CardBody className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-text-muted">Company</span>
              <span className="text-text">{data.companyName ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Email</span>
              <span className="text-text">{data.email ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Phone</span>
              <span className="text-text">{data.phone ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Owner</span>
              <span className="text-text">{data.ownerName ?? "Unassigned"}</span>
            </div>
          </CardBody>
        </Card>
      }
    >
      <Card>
        <CardHeader
          title="Deals"
          action={
            data.canCreateDeals && (
              <Button size="sm" onClick={openCreateDeal}>
                <Icon name="add" size={14} />
                New Deal
              </Button>
            )
          }
        />
        <CardBody className="flex flex-col gap-2">
          {data.deals.length === 0 && <EmptyStateView message="No deals for this contact yet." />}
          {data.deals.map((deal) => (
            <div key={deal.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface px-3 py-2">
              <StatusDot tone={STAGE_TONE[deal.stage] ?? "neutral"} />
              <span className="min-w-0 flex-1 truncate text-sm text-text">{deal.title}</span>
              <span className="shrink-0 text-xs capitalize text-text-muted">{deal.stage}</span>
              <span className="shrink-0 text-sm font-medium text-text">{formatCents(deal.valueCents)}</span>
            </div>
          ))}
        </CardBody>
      </Card>

      <Dialog open={editOpen} onClose={() => setEditOpen(false)} title="Edit Contact">
        <div className="flex flex-col gap-3">
          <Input label="Name" value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus />
          <Input label="Email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} />
          <Input label="Phone" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} />
          <Input label="Company" value={editCompany} onChange={(e) => setEditCompany(e.target.value)} />
          <Select label="Owner" value={editOwnerId} onChange={(e) => setEditOwnerId(e.target.value)}>
            <option value="">Unassigned</option>
            {userOptions.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName}
              </option>
            ))}
          </Select>
          {editError && <Alert tone="danger">{editError}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleEdit} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={dealOpen} onClose={() => setDealOpen(false)} title="New Deal">
        <div className="flex flex-col gap-3">
          <Input label="Title" value={dealTitle} onChange={(e) => setDealTitle(e.target.value)} autoFocus />
          <Input
            label="Value"
            type="number"
            min={0}
            step="0.01"
            value={dealValue}
            onChange={(e) => setDealValue(e.target.value)}
            hint={dealValue ? `= ${formatCents(Math.round(Number(dealValue) * 100))}` : undefined}
          />
          {dealError && <Alert tone="danger">{dealError}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDealOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateDeal} disabled={savingDeal}>
              {savingDeal ? "Creating…" : "Create"}
            </Button>
          </div>
        </div>
      </Dialog>
    </DetailPageShell>
  );
}
