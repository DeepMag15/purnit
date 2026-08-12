"use client";

import { z } from "zod";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../../ui/Icon";
import type { CommonRenderProps } from "../../sdui/registry";
import { useDataBinding } from "../../sdui/use-data-binding";
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
import { Button } from "../../ui/Button";
import { Alert } from "../../ui/Alert";
import { SkeletonRows } from "../../ui/Skeleton";
import { Badge } from "../../ui/Badge";

export const SuppliersWorkspaceSchema = z.object({ title: z.string().optional() });
type Props = z.infer<typeof SuppliersWorkspaceSchema>;

interface SupplierRow {
  id: string;
  name: string;
  status: string;
  contactEmail: string | null;
  purchaseOrderCount: number;
}

const VIEWS: ViewOption[] = [
  { id: "board", label: "Board", icon: "view_kanban" },
  { id: "table", label: "Table", icon: "table_rows" },
  { id: "list", label: "List", icon: "view_list" },
];

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info" | "accent"> = {
  active: "accent",
  inactive: "neutral",
};

/**
 * Manufacturing Domain, Phase A — mirrors `ClientsWorkspace.tsx`'s exact
 * shape (Frontend Structural Redesign, Pattern B). Row click on
 * Table/List navigates to the new `/workspace/suppliers/[id]` detail page.
 */
export function SuppliersWorkspace({ title, bind, actions }: Props & CommonRenderProps) {
  const router = useRouter();
  const { data, loading, error, refetch } = useDataBinding(bind);
  const { callMutation } = useRenderContext();
  const [view, setView] = useState("board");
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newContactEmail, setNewContactEmail] = useState("");
  const [newContactPhone, setNewContactPhone] = useState("");
  const { pending: creating, error: createError, run: runCreate, clearError } = useAsyncAction();
  const { fieldErrors, validate, clearFieldError } = useFormValidation<{ name: string }>({ name: required("Supplier name is required") });

  const canCreate = actions?.some((a) => a.kind === "mutation" && a.mutation === "supplier.create") ?? false;

  const rows = Array.isArray(data) ? (data as SupplierRow[]) : [];
  const statusColumns = [...new Set(rows.map((s) => s.status))];

  function openCreate() {
    setNewName("");
    setNewContactEmail("");
    setNewContactPhone("");
    clearError();
    clearFieldError("name");
    setCreateOpen(true);
  }

  async function handleCreate() {
    if (!validate({ name: newName })) return;
    await runCreate(async () => {
      await callMutation("supplier.create", {
        name: newName.trim(),
        ...(newContactEmail ? { contactEmail: newContactEmail } : {}),
        ...(newContactPhone ? { contactPhone: newContactPhone } : {}),
      });
      setCreateOpen(false);
      refetch();
    });
  }

  function openDetail(supplierId: string) {
    router.push(`/workspace/suppliers/${supplierId}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={title ?? "Suppliers"}
        description="Manage your vendor relationships."
        actions={
          canCreate && (
            <Button onClick={openCreate}>
              <Icon name="add" size={14} />
              New Supplier
            </Button>
          )
        }
        viewSwitcher={<ViewSwitcher views={VIEWS} activeId={view} onChange={setView} />}
      />

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="New Supplier">
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
      {error && <Alert tone="danger">Couldn&apos;t load suppliers: {error}</Alert>}
      {!loading && !error && rows.length === 0 && <EmptyStateView message="No suppliers yet." />}

      {!loading && !error && rows.length > 0 && view === "board" && (
        <KanbanBoard
          nodeId="suppliers-board-kanban"
          groupKey="status"
          labelKey="name"
          columns={statusColumns}
          updateMutation="supplier.updateStatus"
          updateValueKey="status"
          bind={bind}
          actions={actions}
          renderChild={() => null}
        />
      )}

      {!loading && !error && rows.length > 0 && view === "table" && (
        <Table3
          nodeId="suppliers-table"
          columns={["name", "status", "contactEmail", "purchaseOrderCount"]}
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
          {rows.map((supplier) => (
            <li
              key={supplier.id}
              onClick={() => openDetail(supplier.id)}
              className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 transition-colors duration-[var(--duration-fast)] hover:bg-surface-hover"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="min-w-0 truncate text-sm font-medium text-text">{supplier.name}</span>
                <span className="shrink-0">
                  <Badge tone={STATUS_TONE[supplier.status] ?? "neutral"}>{supplier.status}</Badge>
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {supplier.contactEmail && <span className="hidden text-xs text-text-muted sm:inline">{supplier.contactEmail}</span>}
                <span className="text-xs text-text-muted">{supplier.purchaseOrderCount} orders</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
