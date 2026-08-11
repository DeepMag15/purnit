"use client";

import { z } from "zod";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../../ui/Icon";
import type { CommonRenderProps } from "../../sdui/registry";
import { useDataBinding, useDataSourceQuery } from "../../sdui/use-data-binding";
import { useRenderContext } from "../../sdui/render-context";
import { useAsyncAction } from "../../sdui/use-async-action";
import { useFormValidation } from "../../sdui/use-form-validation";
import { required } from "../../sdui/validators";
import { EmptyStateView } from "../../sdui/primitives/EmptyState";
import { KanbanBoard } from "../../sdui/primitives/KanbanBoard";
import { Table3 } from "../../sdui/primitives/Table";
import { PageHeader } from "../../ui/PageHeader";
import { ViewSwitcher, type ViewOption } from "../../ui/ViewSwitcher";
import { Dialog } from "../../ui/Dialog";
import { Input } from "../../ui/Input";
import { Select } from "../../ui/Select";
import { Button } from "../../ui/Button";
import { Alert } from "../../ui/Alert";
import { SkeletonRows } from "../../ui/Skeleton";
import { Badge } from "../../ui/Badge";
import { formatCents, dollarsToCents } from "./money";

export const InvoicesWorkspaceSchema = z.object({ title: z.string().optional() });
type Props = z.infer<typeof InvoicesWorkspaceSchema>;

interface InvoiceRow {
  id: string;
  clientId: string;
  clientName: string;
  status: string;
  dueDate: string;
  total: number;
  amountPaid: number;
  paymentStatus: string;
}

interface ClientOption {
  id: string;
  name: string;
}

interface LineItemDraft {
  description: string;
  quantity: string;
  unitPrice: string;
}

const VIEWS: ViewOption[] = [
  { id: "board", label: "Board", icon: "view_kanban" },
  { id: "table", label: "Table", icon: "table_rows" },
  { id: "list", label: "List", icon: "view_list" },
];

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

const EMPTY_LINE_ITEM: LineItemDraft = { description: "", quantity: "1", unitPrice: "" };

/**
 * Finance Domain, Phase A — mirrors `CoursesWorkspace.tsx`'s exact shape
 * (Frontend Structural Redesign, Pattern B), plus a dynamic line-item
 * editor for invoice creation (no precedent in this codebase — a real
 * invoice needs at least one billable line). Row click on Table/List
 * navigates to the new `/workspace/invoices/[id]` detail page.
 */
export function InvoicesWorkspace({ title, bind, actions }: Props & CommonRenderProps) {
  const router = useRouter();
  const { data, loading, error, refetch } = useDataBinding(bind);
  const { callMutation } = useRenderContext();
  const [view, setView] = useState("board");
  const [createOpen, setCreateOpen] = useState(false);
  const [newClientId, setNewClientId] = useState("");
  const [newIssueDate, setNewIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [newDueDate, setNewDueDate] = useState("");
  const [newTax, setNewTax] = useState("");
  const [lineItems, setLineItems] = useState<LineItemDraft[]>([{ ...EMPTY_LINE_ITEM }]);
  const { pending: creating, error: createError, run: runCreate, clearError } = useAsyncAction();
  const { fieldErrors, validate, clearFieldError } = useFormValidation<{ clientId: string; dueDate: string }>({
    clientId: required("Select a client"),
    dueDate: required("Due date is required"),
  });

  const canCreate = actions?.some((a) => a.kind === "mutation" && a.mutation === "invoice.create") ?? false;

  // A client option list — fetched directly (not via `bind`) since it's
  // this composite's own UI need, not the node's bound data.
  const { data: clientOptionsData } = useDataSourceQuery<ClientOption[]>("clients.list", {}, { enabled: canCreate });
  const clientOptions = Array.isArray(clientOptionsData) ? clientOptionsData : [];

  const rows = Array.isArray(data) ? (data as InvoiceRow[]) : [];
  const statusColumns = [...new Set(rows.map((i) => i.status))];

  function openCreate() {
    setNewClientId("");
    setNewIssueDate(new Date().toISOString().slice(0, 10));
    setNewDueDate("");
    setNewTax("");
    setLineItems([{ ...EMPTY_LINE_ITEM }]);
    clearError();
    clearFieldError("clientId");
    clearFieldError("dueDate");
    setCreateOpen(true);
  }

  function updateLineItem(index: number, patch: Partial<LineItemDraft>) {
    setLineItems((prev) => prev.map((li, i) => (i === index ? { ...li, ...patch } : li)));
  }

  function addLineItem() {
    setLineItems((prev) => [...prev, { ...EMPTY_LINE_ITEM }]);
  }

  function removeLineItem(index: number) {
    setLineItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  const lineItemsSubtotal = lineItems.reduce((sum, li) => sum + (Number(li.quantity) || 0) * dollarsToCents(li.unitPrice), 0);

  async function handleCreate() {
    if (!validate({ clientId: newClientId, dueDate: newDueDate })) return;
    const validLineItems = lineItems.filter((li) => li.description.trim() && Number(li.quantity) > 0);
    if (validLineItems.length === 0) {
      return;
    }
    await runCreate(async () => {
      await callMutation("invoice.create", {
        clientId: newClientId,
        issueDate: newIssueDate,
        dueDate: newDueDate,
        lineItems: validLineItems.map((li) => ({
          description: li.description.trim(),
          quantity: Number(li.quantity),
          unitPrice: dollarsToCents(li.unitPrice),
        })),
        ...(newTax ? { tax: dollarsToCents(newTax) } : {}),
      });
      setCreateOpen(false);
      refetch();
    });
  }

  function openDetail(invoiceId: string) {
    router.push(`/workspace/invoices/${invoiceId}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={title ?? "Invoices"}
        description="Create and track client invoices."
        actions={
          canCreate && (
            <Button onClick={openCreate}>
              <Icon name="add" size={14} />
              New Invoice
            </Button>
          )
        }
        viewSwitcher={<ViewSwitcher views={VIEWS} activeId={view} onChange={setView} />}
      />

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="New Invoice">
        <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto">
          <Select label="Client" value={newClientId} onChange={(e) => setNewClientId(e.target.value)} error={fieldErrors.clientId} autoFocus>
            <option value="">Choose a client…</option>
            {clientOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <div className="flex gap-3">
            <Input label="Issue date" type="date" value={newIssueDate} onChange={(e) => setNewIssueDate(e.target.value)} className="flex-1" />
            <Input
              label="Due date"
              type="date"
              value={newDueDate}
              onChange={(e) => setNewDueDate(e.target.value)}
              error={fieldErrors.dueDate}
              className="flex-1"
            />
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-text">Line items</span>
            {lineItems.map((li, index) => (
              <div key={index} className="flex items-end gap-2">
                <Input
                  placeholder="Description"
                  value={li.description}
                  onChange={(e) => updateLineItem(index, { description: e.target.value })}
                  className="flex-1"
                />
                <Input
                  type="number"
                  min={1}
                  placeholder="Qty"
                  value={li.quantity}
                  onChange={(e) => updateLineItem(index, { quantity: e.target.value })}
                  className="w-16"
                />
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="Unit price"
                  value={li.unitPrice}
                  onChange={(e) => updateLineItem(index, { unitPrice: e.target.value })}
                  className="w-24"
                />
                <Button variant="secondary" size="sm" onClick={() => removeLineItem(index)} disabled={lineItems.length === 1}>
                  <Icon name="close" size={14} />
                </Button>
              </div>
            ))}
            <Button variant="secondary" size="sm" onClick={addLineItem} className="self-start">
              <Icon name="add" size={14} />
              Add line
            </Button>
          </div>

          <Input label="Tax (optional)" type="number" min={0} step="0.01" value={newTax} onChange={(e) => setNewTax(e.target.value)} className="max-w-[10rem]" />

          <div className="flex justify-between border-t border-border pt-2 text-sm">
            <span className="text-text-muted">Subtotal</span>
            <span className="font-medium text-text">{formatCents(lineItemsSubtotal)}</span>
          </div>

          {createError && <Alert tone="danger">{createError}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? "Creating…" : "Create"}
            </Button>
          </div>
        </div>
      </Dialog>

      {loading && <SkeletonRows />}
      {error && <Alert tone="danger">Couldn&apos;t load invoices: {error}</Alert>}
      {!loading && !error && rows.length === 0 && <EmptyStateView message="No invoices yet." />}

      {!loading && !error && rows.length > 0 && view === "board" && (
        <KanbanBoard
          nodeId="invoices-board-kanban"
          groupKey="status"
          labelKey="clientName"
          columns={statusColumns}
          updateMutation="invoice.updateStatus"
          updateValueKey="status"
          bind={bind}
          actions={actions}
          renderChild={() => null}
        />
      )}

      {!loading && !error && rows.length > 0 && view === "table" && (
        <Table3
          nodeId="invoices-table"
          columns={["clientName", "status", "dueDate", "total", "paymentStatus"]}
          sortable
          filterable
          pageSize={20}
          bind={bind}
          actions={[]}
          onRowClick={(row) => openDetail(String(row.id))}
          renderChild={() => null}
        />
      )}

      {!loading && !error && rows.length > 0 && view === "list" && (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
          {rows.map((invoice) => (
            <li
              key={invoice.id}
              onClick={() => openDetail(invoice.id)}
              className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 transition-colors duration-[var(--duration-fast)] hover:bg-surface-hover"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="min-w-0 truncate text-sm font-medium text-text">{invoice.clientName}</span>
                <span className="shrink-0">
                  <Badge tone={STATUS_TONE[invoice.status] ?? "neutral"}>{invoice.status}</Badge>
                </span>
                <span className="shrink-0">
                  <Badge tone={PAYMENT_STATUS_TONE[invoice.paymentStatus] ?? "neutral"}>{invoice.paymentStatus}</Badge>
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-xs text-text-muted">Due {new Date(invoice.dueDate).toLocaleDateString()}</span>
                <span className="text-sm font-medium text-text">{formatCents(invoice.total)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
