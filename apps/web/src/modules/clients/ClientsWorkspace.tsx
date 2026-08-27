"use client";

import { z } from "zod";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../../ui/Icon";
import type { DataBinding } from "@purnit/manifest-schema";
import { useDataSourceQuery } from "../../sdui/use-data-binding";
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

export const ClientsWorkspaceSchema = z.object({ title: z.string().optional() });

interface ClientRow {
  id: string;
  name: string;
  status: string;
  accountManagerId: string | null;
  accountManagerName: string | null;
  invoiceCount: number;
}

interface AccountManagerOption {
  id: string;
  displayName: string;
}

const VIEWS: ViewOption[] = [
  { id: "board", label: "Board", icon: "view_kanban" },
  { id: "table", label: "Table", icon: "table_rows" },
  { id: "list", label: "List", icon: "view_list" },
];

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info" | "accent"> = {
  active: "accent",
  inactive: "neutral",
  prospect: "info",
};

/**
 * Finance Domain, Phase A — mirrors `CoursesWorkspace.tsx`'s exact shape
 * (Frontend Structural Redesign, Pattern B). Row click on Table/List
 * navigates to the new `/workspace/clients/[id]` detail page.
 */
export function ClientsWorkspace() {
  const router = useRouter();
  const bind: DataBinding = { source: "clients.list", params: {} };
  const { data, isPending, error, refetch } = useDataSourceQuery<ClientRow[]>("clients.list");
  const { callMutation } = useRenderContext();
  const [view, setView] = useState("board");
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newContactEmail, setNewContactEmail] = useState("");
  const [newContactPhone, setNewContactPhone] = useState("");
  const [newAccountManagerId, setNewAccountManagerId] = useState("");
  const { pending: creating, error: createError, run: runCreate, clearError } = useAsyncAction();
  const { fieldErrors, validate, clearFieldError } = useFormValidation<{ name: string }>({ name: required("Client name is required") });

  const { data: caps } = useDataSourceQuery<{ canCreate: boolean; canUpdateStatus: boolean }>("clients.capabilities");
  const canCreate = caps?.canCreate ?? false;
  const actions = caps?.canUpdateStatus ? [{ kind: "mutation" as const, mutation: "client.updateStatus", input: { const: null } }] : [];

  // An account-manager option list — fetched directly (not via `bind`) since
  // it's this composite's own UI need, not the node's bound data.
  const { data: managerOptionsData } = useDataSourceQuery<AccountManagerOption[]>("clients.accountManagerOptions", {}, { enabled: canCreate });
  const managerOptions = Array.isArray(managerOptionsData) ? managerOptionsData : [];

  const rows = Array.isArray(data) ? data : [];
  const statusColumns = [...new Set(rows.map((c) => c.status))];

  function openCreate() {
    setNewName("");
    setNewContactEmail("");
    setNewContactPhone("");
    setNewAccountManagerId("");
    clearError();
    clearFieldError("name");
    setCreateOpen(true);
  }

  async function handleCreate() {
    if (!validate({ name: newName })) return;
    await runCreate(async () => {
      await callMutation("client.create", {
        name: newName.trim(),
        ...(newContactEmail ? { contactEmail: newContactEmail } : {}),
        ...(newContactPhone ? { contactPhone: newContactPhone } : {}),
        ...(newAccountManagerId ? { accountManagerId: newAccountManagerId } : {}),
      });
      setCreateOpen(false);
      refetch();
    });
  }

  function openDetail(clientId: string) {
    router.push(`/workspace/clients/${clientId}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Clients"
        description="Manage your client relationships and their billing."
        actions={
          canCreate && (
            <Button onClick={openCreate}>
              <Icon name="add" size={14} />
              New Client
            </Button>
          )
        }
        viewSwitcher={<ViewSwitcher views={VIEWS} activeId={view} onChange={setView} />}
      />

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="New Client">
        <div className="flex flex-col gap-3">
          <Input
            label="Name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            error={fieldErrors.name}
            autoFocus
          />
          <Input label="Contact email" value={newContactEmail} onChange={(e) => setNewContactEmail(e.target.value)} />
          <Input label="Contact phone" value={newContactPhone} onChange={(e) => setNewContactPhone(e.target.value)} />
          <Select label="Account manager" value={newAccountManagerId} onChange={(e) => setNewAccountManagerId(e.target.value)}>
            <option value="">Assign to me… (default)</option>
            {managerOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </Select>
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

      {isPending && <SkeletonRows />}
      {error && <Alert tone="danger">Couldn&apos;t load clients: {error.message}</Alert>}
      {!isPending && !error && rows.length === 0 && <EmptyStateView message="No clients yet." />}

      {!isPending && !error && rows.length > 0 && view === "board" && (
        <KanbanBoard
          nodeId="clients-board-kanban"
          groupKey="status"
          labelKey="name"
          columns={statusColumns}
          updateMutation="client.updateStatus"
          updateValueKey="status"
          bind={bind}
          actions={actions}
          renderChild={() => null}
        />
      )}

      {!isPending && !error && rows.length > 0 && view === "table" && (
        <Table3
          nodeId="clients-table"
          columns={["name", "status", "accountManagerName"]}
          sortable
          filterable
          pageSize={20}
          bind={bind}
          actions={[]}
          onRowClick={(row) => openDetail(String(row.id))}
          renderChild={() => null}
        />
      )}

      {!isPending && !error && rows.length > 0 && view === "list" && (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
          {rows.map((client) => (
            <li
              key={client.id}
              onClick={() => openDetail(client.id)}
              className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 transition-colors duration-[var(--duration-fast)] hover:bg-surface-hover"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="min-w-0 truncate text-sm font-medium text-text">{client.name}</span>
                <span className="shrink-0">
                  <Badge tone={STATUS_TONE[client.status] ?? "neutral"}>{client.status}</Badge>
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {client.accountManagerName && <span className="hidden text-xs text-text-muted sm:inline">{client.accountManagerName}</span>}
                <span className="text-xs text-text-muted">{client.invoiceCount} invoices</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
