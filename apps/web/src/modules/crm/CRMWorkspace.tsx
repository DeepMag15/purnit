"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { useRenderContext } from "../../sdui/render-context";
import { useDataSourceQuery, dataSourceQueryKey } from "../../sdui/use-data-binding";
import { useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "../../ui/PageHeader";
import { Tabs } from "../../ui/Tabs";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Input } from "../../ui/Input";
import { Select } from "../../ui/Select";
import { Icon } from "../../ui/Icon";
import { Alert } from "../../ui/Alert";
import { SkeletonRows } from "../../ui/Skeleton";
import { Table3 } from "../../sdui/primitives/Table";
import { KanbanBoard } from "../../sdui/primitives/KanbanBoard";
import { EmptyStateView } from "../../sdui/primitives/EmptyState";
import { useToast } from "../../ui/Toast";
import { formatCents } from "../invoices/money";

export const CRMWorkspaceSchema = z.object({});

interface CrmCapabilities {
  canCreateContact: boolean;
  canCreateDeal: boolean;
  canUpdateDeal: boolean;
}

interface ContactRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  ownerId: string | null;
  ownerName: string | null;
  dealCount: number;
}

interface DealRow {
  id: string;
  contactId: string;
  contactName: string;
  title: string;
  valueCents: number;
  stage: string;
  ownerId: string | null;
}

interface UserOption {
  id: string;
  displayName: string;
}

const DEAL_STAGES = ["new", "qualified", "proposal", "won", "lost"];

const TABS = [
  { id: "contacts", label: "Contacts" },
  { id: "deals", label: "Deals" },
];

/**
 * CRM — module 2 of the 6-module backlog. Ships as a dedicated route from
 * day one, same zero-prop/`*.capabilities`-driven shape as `LeaveWorkspace`
 * (this module never existed on the old SDUI-Renderer catch-all, unlike
 * Clients/Courses/Projects which still are — no legacy pattern to match).
 * `KanbanBoard`/`Table3` are reused as bare components fed via `bind:
 * {const: rows}`, the same established precedent `AnalyticsWidgetCard.tsx`
 * set for every other SDUI-primitive-outside-the-registry reuse this
 * session.
 */
export function CRMWorkspace() {
  const router = useRouter();
  const { user, tenant, callMutation } = useRenderContext();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState("contacts");

  const { data: caps } = useDataSourceQuery<CrmCapabilities>("crm.capabilities");
  const canCreateContact = caps?.canCreateContact ?? false;
  const canCreateDeal = caps?.canCreateDeal ?? false;
  const canUpdateDeal = caps?.canUpdateDeal ?? false;

  const { data: contactsData, isPending: contactsPending } = useDataSourceQuery<ContactRow[]>("contacts.list");
  const contacts = Array.isArray(contactsData) ? contactsData : [];

  const { data: dealsData, isPending: dealsPending } = useDataSourceQuery<DealRow[]>("deals.list");
  const deals = Array.isArray(dealsData) ? dealsData : [];
  const dealsForBoard = deals.map((d) => ({ ...d, cardLabel: `${d.title} — ${d.contactName}` }));

  const { data: userOptionsData } = useDataSourceQuery<UserOption[]>("users.list", {}, { enabled: canCreateContact || canCreateDeal });
  const userOptions = Array.isArray(userOptionsData) ? userOptionsData : [];

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: dataSourceQueryKey("contacts.list", {}, tenant.id, user.id) });
    queryClient.invalidateQueries({ queryKey: dataSourceQueryKey("deals.list", {}, tenant.id, user.id) });
  }

  // --- New Contact ---
  const [contactOpen, setContactOpen] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactCompany, setContactCompany] = useState("");
  const [contactOwnerId, setContactOwnerId] = useState("");
  const [savingContact, setSavingContact] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);

  function openCreateContact() {
    setContactName("");
    setContactEmail("");
    setContactPhone("");
    setContactCompany("");
    setContactOwnerId("");
    setContactError(null);
    setContactOpen(true);
  }

  async function handleCreateContact() {
    if (!contactName.trim()) {
      setContactError("Name is required");
      return;
    }
    setSavingContact(true);
    setContactError(null);
    try {
      await callMutation("contact.create", {
        name: contactName.trim(),
        ...(contactEmail ? { email: contactEmail } : {}),
        ...(contactPhone ? { phone: contactPhone } : {}),
        ...(contactCompany ? { companyName: contactCompany } : {}),
        ...(contactOwnerId ? { ownerId: contactOwnerId } : {}),
      });
      toast.show("Contact created");
      setContactOpen(false);
      invalidate();
    } catch (err) {
      setContactError(err instanceof Error ? err.message : "Couldn't create contact");
    } finally {
      setSavingContact(false);
    }
  }

  // --- New Deal ---
  const [dealOpen, setDealOpen] = useState(false);
  const [dealContactId, setDealContactId] = useState("");
  const [dealTitle, setDealTitle] = useState("");
  const [dealValue, setDealValue] = useState("");
  const [dealOwnerId, setDealOwnerId] = useState("");
  const [savingDeal, setSavingDeal] = useState(false);
  const [dealError, setDealError] = useState<string | null>(null);

  function openCreateDeal() {
    setDealContactId(contacts[0]?.id ?? "");
    setDealTitle("");
    setDealValue("");
    setDealOwnerId("");
    setDealError(null);
    setDealOpen(true);
  }

  async function handleCreateDeal() {
    if (!dealContactId || !dealTitle.trim()) {
      setDealError("Choose a contact and enter a title");
      return;
    }
    setSavingDeal(true);
    setDealError(null);
    try {
      await callMutation("deal.create", {
        contactId: dealContactId,
        title: dealTitle.trim(),
        ...(dealValue ? { valueCents: Math.round(Number(dealValue) * 100) } : {}),
        ...(dealOwnerId ? { ownerId: dealOwnerId } : {}),
      });
      toast.show("Deal created");
      setDealOpen(false);
      invalidate();
    } catch (err) {
      setDealError(err instanceof Error ? err.message : "Couldn't create deal");
    } finally {
      setSavingDeal(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="CRM"
        description="Track contacts and deals through your sales pipeline."
        actions={
          <>
            {tab === "contacts" && canCreateContact && (
              <Button onClick={openCreateContact}>
                <Icon name="add" size={14} />
                New Contact
              </Button>
            )}
            {tab === "deals" && canCreateDeal && (
              <Button onClick={openCreateDeal} disabled={contacts.length === 0}>
                <Icon name="add" size={14} />
                New Deal
              </Button>
            )}
          </>
        }
      />

      <Tabs items={TABS} activeId={tab} onChange={setTab} />

      {tab === "contacts" && (
        <>
          {contactsPending && <SkeletonRows />}
          {!contactsPending && contacts.length === 0 && <EmptyStateView message="No contacts yet." />}
          {!contactsPending && contacts.length > 0 && (
            <Table3
              nodeId="crm-contacts-table"
              columns={["name", "companyName", "ownerName", "dealCount"]}
              sortable
              filterable
              pageSize={20}
              bind={{ const: contacts }}
              actions={[]}
              onRowClick={(row) => router.push(`/workspace/crm/contacts/${row.id}`)}
              renderChild={() => null}
            />
          )}
        </>
      )}

      {tab === "deals" && (
        <>
          {dealsPending && <SkeletonRows />}
          {!dealsPending && deals.length === 0 && <EmptyStateView message="No deals yet." />}
          {!dealsPending && deals.length > 0 && (
            <KanbanBoard
              nodeId="crm-deals-board"
              groupKey="stage"
              labelKey="cardLabel"
              columns={DEAL_STAGES}
              updateMutation="deal.updateStage"
              updateValueKey="stage"
              bind={{ const: dealsForBoard }}
              actions={canUpdateDeal ? [{ kind: "mutation", mutation: "deal.updateStage", input: { ref: "row.id" } }] : []}
              renderChild={() => null}
            />
          )}
        </>
      )}

      <Dialog open={contactOpen} onClose={() => setContactOpen(false)} title="New Contact">
        <div className="flex flex-col gap-3">
          <Input label="Name" value={contactName} onChange={(e) => setContactName(e.target.value)} autoFocus />
          <Input label="Email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
          <Input label="Phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
          <Input label="Company" value={contactCompany} onChange={(e) => setContactCompany(e.target.value)} />
          <Select label="Owner" value={contactOwnerId} onChange={(e) => setContactOwnerId(e.target.value)}>
            <option value="">Assign to me… (default)</option>
            {userOptions.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName}
              </option>
            ))}
          </Select>
          {contactError && <Alert tone="danger">{contactError}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setContactOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateContact} disabled={savingContact}>
              {savingContact ? "Creating…" : "Create"}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={dealOpen} onClose={() => setDealOpen(false)} title="New Deal">
        <div className="flex flex-col gap-3">
          <Select label="Contact" value={dealContactId} onChange={(e) => setDealContactId(e.target.value)} autoFocus>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Input label="Title" value={dealTitle} onChange={(e) => setDealTitle(e.target.value)} />
          <Input
            label="Value"
            type="number"
            min={0}
            step="0.01"
            value={dealValue}
            onChange={(e) => setDealValue(e.target.value)}
            hint={dealValue ? `= ${formatCents(Math.round(Number(dealValue) * 100))}` : undefined}
          />
          <Select label="Owner" value={dealOwnerId} onChange={(e) => setDealOwnerId(e.target.value)}>
            <option value="">Assign to me… (default)</option>
            {userOptions.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName}
              </option>
            ))}
          </Select>
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
    </div>
  );
}
