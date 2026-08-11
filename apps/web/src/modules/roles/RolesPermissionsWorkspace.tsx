"use client";

import { useMemo, useState } from "react";
import { z } from "zod";
import type { CommonRenderProps } from "../../sdui/registry";
import { useRenderContext } from "../../sdui/render-context";
import { useDataSourceQuery } from "../../sdui/use-data-binding";
import { Card, CardHeader, CardBody } from "../../ui/Card";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Select } from "../../ui/Select";
import { Badge } from "../../ui/Badge";
import { Alert } from "../../ui/Alert";
import { useToast } from "../../ui/Toast";
import { SectionLabel } from "../../ui/SectionLabel";

export const RolesPermissionsWorkspaceSchema = z.object({});
type Props = z.infer<typeof RolesPermissionsWorkspaceSchema>;

interface RoleDetailed {
  id: string;
  label: string;
  sourceBlueprintRoleId: string | null;
  extendsRoleId: string | null;
  permissions: string[];
  assignmentCount: number;
}

interface CatalogEntry {
  resource: string;
  action: string;
  label: string;
}
interface CatalogModule {
  module: string;
  entries: CatalogEntry[];
}

interface UserOption {
  id: string;
  displayName: string;
  email: string;
}

interface EffectivePermissionsResult {
  userId: string;
  permissions: string[];
  roles: { id: string; label: string; sourceBlueprintRoleId: string | null }[];
}

interface DelegationRow {
  id: string;
  permission: string;
  grantedById: string;
  grantedByName: string;
  createdAt: string;
}

// Narrowest to broadest — same order as rbac/scope.ts's SCOPE_RANK, fixed
// frontend-only vocabulary (same treatment as AttendanceWorkspace's
// ATTENDANCE_STATUSES; the shared enum lives server-side and has no
// existing precedent for being imported into this app).
const SCOPES = ["own", "team", "department", "department-subtree", "tenant"] as const;
type ScopeValue = (typeof SCOPES)[number];

function scopeRank(scope: string): number {
  return SCOPES.indexOf(scope as ScopeValue);
}

function permKey(resource: string, action: string): string {
  return `${resource}:${action}`;
}

/** `["project:create:tenant", ...]` -> `Map<"project:create", "tenant">`. */
function toScopeMap(permissions: readonly string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const raw of permissions) {
    const parts = raw.split(":");
    if (parts.length !== 3) continue;
    map.set(permKey(parts[0]!, parts[1]!), parts[2]!);
  }
  return map;
}

/**
 * Core Workspace Modules, Phase 3, priority insert ahead of Leave
 * Management: Roles & Permissions Management — a blueprint-registered
 * composite, mirrors AttendanceWorkspace's "manages its own data via
 * useDataSourceQuery" shape. Role assignment itself isn't duplicated here —
 * it already lives on the Team page (TeamMembers.tsx, `user.changeRole`),
 * and any custom role created here shows up in that picker automatically
 * (`roles.list` is unfiltered by `sourceBlueprintRoleId`).
 */
export function RolesPermissionsWorkspace({ actions }: Props & CommonRenderProps) {
  const { user, callMutation } = useRenderContext();
  const toast = useToast();

  const canManageRoles = actions?.some((a) => a.kind === "mutation" && a.mutation === "role.createCustom") ?? false;
  const canDelegate = actions?.some((a) => a.kind === "mutation" && a.mutation === "delegation.grant") ?? false;

  const { data: rolesData, refetch: refetchRoles } = useDataSourceQuery<RoleDetailed[]>("roles.listDetailed");
  const roles = rolesData ?? [];

  const { data: catalogData } = useDataSourceQuery<CatalogModule[]>("permissions.catalog");
  const catalog = catalogData ?? [];

  // The current actor's own effective permissions — drives the editor's
  // client-side "you can't grant more than you hold" hint. The real gate is
  // server-side (`assertPermissionsGrantableByActor`); this is UX only.
  const { data: selfEffective } = useDataSourceQuery<EffectivePermissionsResult>(
    "users.effectivePermissions",
    { userId: user.id },
    { enabled: canManageRoles },
  );
  const actorScopeMap = useMemo(() => toScopeMap(selfEffective?.permissions ?? []), [selfEffective]);

  const [editingRoleId, setEditingRoleId] = useState<string | "new" | null>(null);
  const [cloningSourceId, setCloningSourceId] = useState<string | null>(null);

  function afterMutation() {
    refetchRoles();
    setEditingRoleId(null);
    setCloningSourceId(null);
  }

  const editingRole = typeof editingRoleId === "string" && editingRoleId !== "new" ? (roles.find((r) => r.id === editingRoleId) ?? null) : null;
  const cloningSource = cloningSourceId ? (roles.find((r) => r.id === cloningSourceId) ?? null) : null;

  return (
    <div className="flex flex-col gap-4">
      <RoleListPanel
        roles={roles}
        canManageRoles={canManageRoles}
        onCreateNew={() => setEditingRoleId("new")}
        onEdit={(id) => setEditingRoleId(id)}
        onClone={(id) => setCloningSourceId(id)}
        onDelete={async (role) => {
          if (!confirm(`Delete role "${role.label}"? This cannot be undone.`)) return;
          try {
            await callMutation("role.delete", { roleId: role.id });
            toast.show(`Deleted "${role.label}"`);
            refetchRoles();
          } catch (err) {
            toast.show(err instanceof Error ? err.message : "Couldn't delete role", "danger");
          }
        }}
        onReordered={refetchRoles}
      />

      {(editingRoleId !== null) && (
        <RoleEditorPanel
          mode={editingRoleId === "new" ? "create" : "edit"}
          role={editingRole}
          catalog={catalog}
          actorScopeMap={actorScopeMap}
          onCancel={() => setEditingRoleId(null)}
          onSaved={afterMutation}
        />
      )}

      {cloningSource && <ClonePicker source={cloningSource} onCancel={() => setCloningSourceId(null)} onCloned={afterMutation} />}

      <UserPermissionViewer catalog={catalog} enabled={canManageRoles} actorScopeMap={actorScopeMap} canDelegate={canDelegate} />
    </div>
  );
}

function RoleListPanel({
  roles,
  canManageRoles,
  onCreateNew,
  onEdit,
  onClone,
  onDelete,
  onReordered,
}: {
  roles: RoleDetailed[];
  canManageRoles: boolean;
  onCreateNew: () => void;
  onEdit: (roleId: string) => void;
  onClone: (roleId: string) => void;
  onDelete: (role: RoleDetailed) => void;
  onReordered: () => void;
}) {
  const { callMutation } = useRenderContext();
  const toast = useToast();
  const [reordering, setReordering] = useState(false);

  async function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= roles.length) return;
    const next = [...roles];
    [next[index], next[target]] = [next[target]!, next[index]!];
    setReordering(true);
    try {
      await callMutation("role.reorder", { roleIds: next.map((r) => r.id) });
      onReordered();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't reorder roles", "danger");
    } finally {
      setReordering(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Roles"
        action={
          canManageRoles ? (
            <Button size="sm" onClick={onCreateNew}>
              New role
            </Button>
          ) : undefined
        }
      />
      <CardBody className="flex flex-col gap-2">
        {roles.length === 0 && <div className="text-sm text-text-muted">No roles yet.</div>}
        {roles.map((role, index) => {
          const isCustom = role.sourceBlueprintRoleId === null;
          return (
            <div key={role.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5">
              {canManageRoles && (
                <div className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={index === 0 || reordering}
                    aria-label={`Move ${role.label} up`}
                    className="leading-none text-text-muted hover:text-text disabled:opacity-30"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={index === roles.length - 1 || reordering}
                    aria-label={`Move ${role.label} down`}
                    className="leading-none text-text-muted hover:text-text disabled:opacity-30"
                  >
                    ▼
                  </button>
                </div>
              )}
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">{role.label}</span>
              {!isCustom && <Badge>System</Badge>}
              <Badge tone={role.assignmentCount > 0 ? "info" : "neutral"}>
                {role.assignmentCount} assigned
              </Badge>
              <div className="flex gap-1.5">
                {canManageRoles && <Button size="sm" variant="secondary" onClick={() => onClone(role.id)}>Clone</Button>}
                {canManageRoles && isCustom && (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => onEdit(role.id)}>Edit</Button>
                    <Button size="sm" variant="danger" onClick={() => onDelete(role)}>Delete</Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </CardBody>
    </Card>
  );
}

function RoleEditorPanel({
  mode,
  role,
  catalog,
  actorScopeMap,
  onCancel,
  onSaved,
}: {
  mode: "create" | "edit";
  role: RoleDetailed | null;
  catalog: CatalogModule[];
  actorScopeMap: Map<string, string>;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { callMutation } = useRenderContext();
  const toast = useToast();
  const [label, setLabel] = useState(role?.label ?? "");
  const [selected, setSelected] = useState<Map<string, string>>(() => toScopeMap(role?.permissions ?? []));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(resource: string, action: string) {
    const key = permKey(resource, action);
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        const actorScope = actorScopeMap.get(key);
        next.set(key, actorScope ?? "own");
      }
      return next;
    });
  }

  function setScope(resource: string, action: string, scope: string) {
    const key = permKey(resource, action);
    setSelected((prev) => new Map(prev).set(key, scope));
  }

  async function handleSave() {
    if (!label.trim()) return;
    setSaving(true);
    setError(null);
    const permissions = [...selected.entries()].map(([key, scope]) => `${key}:${scope}`);
    try {
      if (mode === "create") {
        await callMutation("role.createCustom", { label: label.trim(), permissions });
        toast.show(`Created role "${label.trim()}"`);
      } else if (role) {
        await callMutation("role.updateCustom", { roleId: role.id, label: label.trim(), permissions });
        toast.show(`Updated "${label.trim()}"`);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save role");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader title={mode === "create" ? "New role" : `Edit "${role?.label}"`} />
      <CardBody className="flex flex-col gap-3">
        {error && <Alert tone="danger">{error}</Alert>}
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Role name" className="max-w-sm" />

        <div className="flex flex-col gap-3">
          {catalog.map((mod) => (
            <div key={mod.module}>
              <SectionLabel className="mb-1">{mod.module}</SectionLabel>
              <div className="flex flex-col gap-1">
                {mod.entries.map((entry) => {
                  const key = permKey(entry.resource, entry.action);
                  const checked = selected.has(key);
                  const actorScope = actorScopeMap.get(key);
                  const grantable = actorScope !== undefined;
                  const allowedScopes = SCOPES.filter((s) => !grantable || scopeRank(s) <= scopeRank(actorScope!));
                  return (
                    <label key={key} className="flex items-center gap-2 py-0.5 text-sm text-text">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!grantable}
                        onChange={() => toggle(entry.resource, entry.action)}
                        className="h-3.5 w-3.5"
                      />
                      <span className={grantable ? undefined : "text-text-muted line-through"}>{entry.label}</span>
                      {checked && (
                        <Select
                          value={selected.get(key) ?? "own"}
                          onChange={(e) => setScope(entry.resource, entry.action, e.target.value)}
                          className="h-7 w-40 text-xs"
                        >
                          {allowedScopes.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </Select>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={saving || !label.trim()}>
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button variant="secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function ClonePicker({ source, onCancel, onCloned }: { source: RoleDetailed; onCancel: () => void; onCloned: () => void }) {
  const { callMutation } = useRenderContext();
  const toast = useToast();
  const [label, setLabel] = useState(`${source.label} (copy)`);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClone() {
    if (!label.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await callMutation("role.clone", { sourceRoleId: source.id, label: label.trim() });
      toast.show(`Cloned "${source.label}" as "${label.trim()}"`);
      onCloned();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't clone role");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader title={`Clone "${source.label}"`} />
      <CardBody className="flex flex-col gap-3">
        {error && <Alert tone="danger">{error}</Alert>}
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="New role name" className="max-w-sm" />
        <div className="flex gap-2">
          <Button onClick={handleClone} disabled={saving || !label.trim()}>
            {saving ? "Cloning…" : "Clone"}
          </Button>
          <Button variant="secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function UserPermissionViewer({
  catalog,
  enabled,
  actorScopeMap,
  canDelegate,
}: {
  catalog: CatalogModule[];
  enabled: boolean;
  actorScopeMap: Map<string, string>;
  canDelegate: boolean;
}) {
  const [query, setQuery] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const { data: usersData } = useDataSourceQuery<UserOption[]>("users.list", {}, { enabled });
  const users = usersData ?? [];
  const filtered = query.trim()
    ? users.filter((u) => u.displayName.toLowerCase().includes(query.toLowerCase()) || u.email.toLowerCase().includes(query.toLowerCase()))
    : users;

  const { data: effective, isPending, refetch: refetchEffective } = useDataSourceQuery<EffectivePermissionsResult>(
    "users.effectivePermissions",
    { userId: selectedUserId ?? "" },
    { enabled: enabled && !!selectedUserId },
  );

  if (!enabled) return null;

  const heldKeys = new Set((effective?.permissions ?? []).map((p) => p.split(":").slice(0, 2).join(":")));
  const scopeByKey = toScopeMap(effective?.permissions ?? []);

  return (
    <Card>
      <CardHeader title="Effective permissions" />
      <CardBody className="flex flex-col gap-3">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search users…" className="max-w-sm" />
        <div className="flex flex-wrap gap-1.5">
          {filtered.slice(0, 30).map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => setSelectedUserId(u.id)}
              className={`rounded-full px-2.5 py-1 text-xs ${selectedUserId === u.id ? "bg-accent text-accent-fg" : "bg-surface-hover text-text-muted hover:text-text"}`}
            >
              {u.displayName}
            </button>
          ))}
        </div>

        {selectedUserId && isPending && <div className="text-sm text-text-muted">Loading…</div>}
        {selectedUserId && effective && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-1.5">
              {effective.roles.map((r) => (
                <Badge key={r.id} tone={r.sourceBlueprintRoleId === null ? "accent" : "neutral"}>
                  {r.label}
                </Badge>
              ))}
            </div>
            {catalog.map((mod) => {
              const heldEntries = mod.entries.filter((e) => heldKeys.has(permKey(e.resource, e.action)));
              if (heldEntries.length === 0) return null;
              return (
                <div key={mod.module}>
                  <SectionLabel className="mb-1">{mod.module}</SectionLabel>
                  <div className="flex flex-wrap gap-1.5">
                    {heldEntries.map((e) => (
                      <Badge key={permKey(e.resource, e.action)} tone="success">
                        {e.label} · {scopeByKey.get(permKey(e.resource, e.action))}
                      </Badge>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {selectedUserId && canDelegate && (
          <div className="flex flex-col gap-3 border-t border-border pt-3">
            <ActiveDelegationsList
              userId={selectedUserId}
              onChanged={() => {
                refetchEffective();
              }}
            />
            <DelegationGrantEditor
              userId={selectedUserId}
              catalog={catalog}
              actorScopeMap={actorScopeMap}
              heldKeys={heldKeys}
              onGranted={() => {
                refetchEffective();
              }}
            />
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/** Mirrors RoleEditorPanel's checkbox-per-catalog-entry + scope <Select>
 * loop exactly, same actorScopeMap-driven graying-out of ungrantable
 * entries — the only differences are the target (a specific user, not a
 * role) and the mutation called. Entries already held via the target's
 * current role(s) get an "already held" badge — UX only, not a backend
 * block, since a redundant delegation is harmless. */
function DelegationGrantEditor({
  userId,
  catalog,
  actorScopeMap,
  heldKeys,
  onGranted,
}: {
  userId: string;
  catalog: CatalogModule[];
  actorScopeMap: Map<string, string>;
  heldKeys: Set<string>;
  onGranted: () => void;
}) {
  const { callMutation } = useRenderContext();
  const toast = useToast();
  const [selected, setSelected] = useState<Map<string, string>>(new Map());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(resource: string, action: string) {
    const key = permKey(resource, action);
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        const actorScope = actorScopeMap.get(key);
        next.set(key, actorScope ?? "own");
      }
      return next;
    });
  }

  function setScope(resource: string, action: string, scope: string) {
    const key = permKey(resource, action);
    setSelected((prev) => new Map(prev).set(key, scope));
  }

  async function handleGrant() {
    if (selected.size === 0) return;
    setSaving(true);
    setError(null);
    const permissions = [...selected.entries()].map(([key, scope]) => `${key}:${scope}`);
    try {
      await callMutation("delegation.grant", { userId, permissions });
      toast.show(`Granted ${permissions.length} permission(s)`);
      setSelected(new Map());
      onGranted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't grant permission");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <SectionLabel>Delegate an extra permission</SectionLabel>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex flex-col gap-3">
        {catalog.map((mod) => (
          <div key={mod.module}>
            <SectionLabel className="mb-1">{mod.module}</SectionLabel>
            <div className="flex flex-col gap-1">
              {mod.entries.map((entry) => {
                const key = permKey(entry.resource, entry.action);
                const checked = selected.has(key);
                const actorScope = actorScopeMap.get(key);
                const grantable = actorScope !== undefined;
                const allowedScopes = SCOPES.filter((s) => !grantable || scopeRank(s) <= scopeRank(actorScope!));
                const alreadyHeld = heldKeys.has(key);
                return (
                  <label key={key} className="flex items-center gap-2 py-0.5 text-sm text-text">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!grantable}
                      onChange={() => toggle(entry.resource, entry.action)}
                      className="h-3.5 w-3.5"
                    />
                    <span className={grantable ? undefined : "text-text-muted line-through"}>{entry.label}</span>
                    {alreadyHeld && <Badge tone="neutral">already held via role</Badge>}
                    {checked && (
                      <Select
                        value={selected.get(key) ?? "own"}
                        onChange={(e) => setScope(entry.resource, entry.action, e.target.value)}
                        className="h-7 w-40 text-xs"
                      >
                        {allowedScopes.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </Select>
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div>
        <Button size="sm" onClick={handleGrant} disabled={saving || selected.size === 0}>
          {saving ? "Granting…" : "Grant"}
        </Button>
      </div>
    </div>
  );
}

function ActiveDelegationsList({ userId, onChanged }: { userId: string; onChanged: () => void }) {
  const { callMutation } = useRenderContext();
  const toast = useToast();
  const { data, refetch } = useDataSourceQuery<DelegationRow[]>("delegations.list", { userId }, { enabled: !!userId });
  const delegations = data ?? [];

  async function handleRevoke(row: DelegationRow) {
    try {
      await callMutation("delegation.revoke", { delegationId: row.id });
      toast.show(`Revoked "${row.permission}"`);
      refetch();
      onChanged();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't revoke delegation", "danger");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <SectionLabel>Delegated permissions</SectionLabel>
      {delegations.length === 0 && <div className="text-sm text-text-muted">None active.</div>}
      {delegations.map((row) => (
        <div key={row.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5">
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">{row.permission}</span>
          <span className="text-xs text-text-muted">
            granted by {row.grantedByName} · {new Date(row.createdAt).toLocaleDateString()}
          </span>
          <Button size="sm" variant="danger" onClick={() => handleRevoke(row)}>
            Revoke
          </Button>
        </div>
      ))}
    </div>
  );
}
