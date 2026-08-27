"use client";

import { useState } from "react";
import { useDataSourceQuery } from "../../sdui/use-data-binding";
import { PageHeader } from "../../ui/PageHeader";
import { Card, CardBody } from "../../ui/Card";
import { Button } from "../../ui/Button";
import { Select } from "../../ui/Select";
import { Icon } from "../../ui/Icon";
import { SkeletonRows } from "../../ui/Skeleton";
import { EmptyStateView } from "../../sdui/primitives/EmptyState";

interface AuditLogRow {
  id: string;
  actorUserId: string | null;
  actorName: string;
  action: string;
  resource: string;
  resourceId: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
}

const PAGE_SIZE = 30;

// The exact bounded ~15-20 high-value call sites this module instruments —
// confirmed via the mutations themselves, not guessed — power both filter
// dropdowns. Not every mutation in the codebase logs here by design (see
// `logAudit`'s own doc comment): role/permission changes, user lifecycle,
// delegation, a handful of significant deletes, settings/branding.
const ACTION_LABELS: Record<string, string> = {
  "user.invite": "User invited",
  "user.changeRole": "User role changed",
  "user.assignDepartment": "User reassigned department",
  "user.setManager": "User manager changed",
  "role.createCustom": "Custom role created",
  "role.updateCustom": "Custom role updated",
  "role.clone": "Role cloned",
  "role.delete": "Role deleted",
  "delegation.grant": "Permission delegated",
  "delegation.revoke": "Delegation revoked",
  "tenant.updateBranding": "Branding updated",
  "tenant.updateWorkspaceId": "Workspace ID changed",
  "tenant.updateProfile": "Company profile updated",
  "workspaceConfig.updateNavigationLabel": "Nav label customized",
  "project.delete": "Project deleted",
  "department.delete": "Department deleted",
  "team.delete": "Team deleted",
  "announcement.delete": "Announcement deleted",
};

const RESOURCE_LABELS: Record<string, string> = {
  user: "User",
  role: "Role",
  delegation: "Delegation",
  tenant: "Tenant",
  workspaceConfig: "Workspace Config",
  project: "Project",
  department: "Department",
  team: "Team",
  announcement: "Announcement",
};

/**
 * Audit Logs — module 6 of 6, the last of the approved 6-module backlog.
 * Ships as a dedicated route from day one, same zero-prop shell as every
 * module since Leave Management — `auditLogs.list` is server-paginated the
 * same way `notifications.list` first established (`page`/fixed server-side
 * `take`), extended here with `resource`/`action` filters over the exact
 * bounded set every `logAudit()` call site actually produces.
 */
export function AuditLogsPage() {
  const [resource, setResource] = useState("");
  const [action, setAction] = useState("");
  const [page, setPage] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const params = { ...(resource ? { resource } : {}), ...(action ? { action } : {}), page };
  const { data, isPending } = useDataSourceQuery<AuditLogRow[]>("auditLogs.list", params);
  const rows = Array.isArray(data) ? data : [];
  const hasNextPage = rows.length === PAGE_SIZE;

  function updateFilter(next: Partial<{ resource: string; action: string }>) {
    if (next.resource !== undefined) setResource(next.resource);
    if (next.action !== undefined) setAction(next.action);
    setPage(0);
  }

  function toggleExpanded(id: string) {
    setExpandedId((current) => (current === id ? null : id));
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Audit Logs"
        description="Who changed what, and when — role/permission changes, user lifecycle, delegation, significant deletes, and settings/branding."
        filters={
          <>
            <Select aria-label="Filter by resource" value={resource} onChange={(e) => updateFilter({ resource: e.target.value })} className="w-44">
              <option value="">All resources</option>
              {Object.entries(RESOURCE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <Select aria-label="Filter by action" value={action} onChange={(e) => updateFilter({ action: e.target.value })} className="w-56">
              <option value="">All actions</option>
              {Object.entries(ACTION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </>
        }
      />

      <Card>
        <CardBody className="flex flex-col gap-1 p-2">
          {isPending && <SkeletonRows rows={5} />}
          {!isPending && rows.length === 0 && <EmptyStateView message="No audit activity here." />}
          {!isPending &&
            rows.map((row) => (
              <div key={row.id} className="rounded-md border-b border-border last:border-b-0">
                <button
                  type="button"
                  onClick={() => toggleExpanded(row.id)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors duration-[var(--duration-fast)] hover:bg-surface-hover"
                >
                  <Icon name={expandedId === row.id ? "expand_less" : "expand_more"} size={16} className="shrink-0 text-text-muted" />
                  <div className="min-w-0 flex-1">
                    <span className="text-sm text-text">
                      <span className="font-medium">{row.actorName}</span> {(ACTION_LABELS[row.action] ?? row.action).toLowerCase()}
                    </span>
                    <div className="text-xs text-text-muted">
                      {RESOURCE_LABELS[row.resource] ?? row.resource}
                      {row.resourceId ? ` · ${row.resourceId}` : ""}
                    </div>
                  </div>
                  <span className="shrink-0 whitespace-nowrap text-xs text-text-muted">{new Date(row.createdAt).toLocaleString()}</span>
                </button>
                {expandedId === row.id && (row.before !== null || row.after !== null) && (
                  <div className="grid grid-cols-1 gap-3 border-t border-border bg-surface-sunk px-3 py-2.5 sm:grid-cols-2">
                    <div>
                      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-text-muted">Before</div>
                      <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-surface p-2 text-xs text-text">
                        {row.before !== null ? JSON.stringify(row.before, null, 2) : "—"}
                      </pre>
                    </div>
                    <div>
                      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-text-muted">After</div>
                      <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-surface p-2 text-xs text-text">
                        {row.after !== null ? JSON.stringify(row.after, null, 2) : "—"}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            ))}
        </CardBody>
      </Card>

      {(page > 0 || hasNextPage) && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            <Icon name="chevron_left" size={14} />
            Newer
          </Button>
          <span className="text-xs text-text-muted">Page {page + 1}</span>
          <Button variant="secondary" size="sm" disabled={!hasNextPage} onClick={() => setPage((p) => p + 1)}>
            Older
            <Icon name="chevron_right" size={14} />
          </Button>
        </div>
      )}
    </div>
  );
}
