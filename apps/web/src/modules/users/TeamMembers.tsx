import { z } from "zod";
import { useEffect, useState } from "react";
import { Icon } from "../../ui/Icon";
import type { CommonRenderProps } from "../../sdui/registry";
import { useDataBinding, useDataSourceQuery } from "../../sdui/use-data-binding";
import { useRenderContext } from "../../sdui/render-context";
import { EmptyStateView } from "../../sdui/primitives/EmptyState";
import { Card, CardBody } from "../../ui/Card";
import { Input } from "../../ui/Input";
import { Select } from "../../ui/Select";
import { Button } from "../../ui/Button";
import { Alert } from "../../ui/Alert";
import { Badge } from "../../ui/Badge";
import { SkeletonRows } from "../../ui/Skeleton";
import { useToast } from "../../ui/Toast";

export const TeamMembersSchema = z.object({});
type Props = z.infer<typeof TeamMembersSchema>;

interface UserRow {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  roleIds: string[];
}

interface RoleOption {
  id: string;
  label: string;
}

interface DepartmentOption {
  id: string;
  name: string;
}

interface TeamOption {
  id: string;
  name: string;
  departmentId: string;
}

export function TeamMembers({ bind, actions }: Props & CommonRenderProps) {
  const { data, loading, error, refetch } = useDataBinding(bind);
  const { callMutation, user } = useRenderContext();
  const toast = useToast();

  // Same presence-gate pattern as ProjectBoard/TaskList: the invite form
  // only renders if `user.invite` survived Stage 4's permission pruning.
  const canInvite = actions?.some((a) => a.kind === "mutation" && a.mutation === "user.invite") ?? false;
  const canChangeRole = actions?.some((a) => a.kind === "mutation" && a.mutation === "user.changeRole") ?? false;

  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [selectedDepartmentId, setSelectedDepartmentId] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [lastInvite, setLastInvite] = useState<{ email: string; temporaryPassword?: string; emailSent: boolean } | null>(null);
  const [changeRoleError, setChangeRoleError] = useState<string | null>(null);

  // Fetched directly, not via `bind` — a role picker is this composite's own
  // UI need, same reasoning as TaskList's project picker. Cached and deduped
  // against anything else on the page asking for the same source+params
  // (CONTEXT.md §48). A denied fetch (no `user:manage` grant, shouldn't
  // happen if `canInvite` is true, but fails safe) just leaves the invite
  // form unusable, not an error state.
  const { data: rolesData } = useDataSourceQuery<RoleOption[]>("roles.list", {}, { enabled: canInvite || canChangeRole });
  const roles = Array.isArray(rolesData) ? rolesData : [];

  // `departments.list` is gated on `department:manage`, which Company Admin
  // (the only role with `user:invite` today) always also holds.
  const { data: departmentsData } = useDataSourceQuery<DepartmentOption[]>("departments.list", {}, { enabled: canInvite });
  const departments = Array.isArray(departmentsData) ? departmentsData : [];
  useEffect(() => {
    if (Array.isArray(departmentsData)) setSelectedDepartmentId((current) => current || departmentsData[0]?.id || "");
  }, [departmentsData]);

  const { data: teamsData } = useDataSourceQuery<TeamOption[]>("teams.list", {}, { enabled: canInvite });
  const teams = Array.isArray(teamsData) ? teamsData : [];

  const teamsInDepartment = teams.filter((t) => t.departmentId === selectedDepartmentId);

  async function handleInvite() {
    if (!email.trim() || !displayName.trim() || !selectedRoleId || !selectedDepartmentId) return;
    setInviting(true);
    setInviteError(null);
    setLastInvite(null);
    try {
      const result = (await callMutation("user.invite", {
        email: email.trim(),
        displayName: displayName.trim(),
        roleId: selectedRoleId,
        departmentId: selectedDepartmentId,
        teamId: selectedTeamId || undefined,
      })) as { email: string; temporaryPassword?: string; emailSent: boolean };
      setLastInvite(result);
      toast.show(result.emailSent ? `Invite email sent to ${result.email}` : `${displayName.trim()} invited`);
      setEmail("");
      setDisplayName("");
      setSelectedTeamId("");
      refetch();
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Couldn't invite teammate");
    } finally {
      setInviting(false);
    }
  }

  async function handleChangeRole(userId: string, roleId: string) {
    setChangeRoleError(null);
    try {
      await callMutation("user.changeRole", { userId, roleId });
      refetch();
    } catch (err) {
      setChangeRoleError(err instanceof Error ? err.message : "Couldn't change role");
    }
  }

  const rows = Array.isArray(data) ? (data as UserRow[]) : [];

  return (
    <Card>
      <CardBody className="flex flex-col gap-4">
        {canInvite && (
          <div>
            <div className="flex flex-wrap gap-2">
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Full name" className="flex-1" />
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="flex-1" />
              <Select value={selectedRoleId} onChange={(e) => setSelectedRoleId(e.target.value)}>
                <option value="">Select role…</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </Select>
              <Select
                value={selectedDepartmentId}
                onChange={(e) => {
                  setSelectedDepartmentId(e.target.value);
                  setSelectedTeamId("");
                }}
              >
                {departments.length === 0 && <option value="">No departments yet</option>}
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
              <Select value={selectedTeamId} onChange={(e) => setSelectedTeamId(e.target.value)} disabled={!selectedDepartmentId}>
                <option value="">No team</option>
                {teamsInDepartment.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
              <Button
                onClick={handleInvite}
                disabled={inviting || !email.trim() || !displayName.trim() || !selectedRoleId || !selectedDepartmentId}
              >
                <Icon name="person_add" size={14} />
                {inviting ? "Inviting…" : "Invite teammate"}
              </Button>
            </div>
            {inviteError && (
              <div className="mt-2">
                <Alert tone="danger">{inviteError}</Alert>
              </div>
            )}
            {lastInvite && (
              <div className="mt-2 flex items-start gap-2 rounded-md border border-accent/20 bg-accent/5 px-3 py-2 text-sm text-text">
                <Icon name="key" size={15} className="mt-0.5 shrink-0 text-accent" />
                <span>
                  {lastInvite.emailSent ? (
                    <>
                      An invite email was sent to <strong>{lastInvite.email}</strong> with their temporary password.
                    </>
                  ) : (
                    <>
                      Couldn&apos;t send the invite email — share this with <strong>{lastInvite.email}</strong> manually, it won&apos;t be shown
                      again:{" "}
                      <code className="rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-xs">
                        {lastInvite.temporaryPassword}
                      </code>
                    </>
                  )}
                </span>
              </div>
            )}
          </div>
        )}

        {changeRoleError && <Alert tone="danger">{changeRoleError}</Alert>}

        {loading && <SkeletonRows />}
        {error && <Alert tone="danger">Couldn&apos;t load team: {error}</Alert>}
        {!loading && !error && rows.length === 0 && <EmptyStateView message="No teammates yet." />}
        {!loading && !error && rows.length > 0 && (
          <ul className="flex flex-col divide-y divide-border">
            {rows.map((u) => {
              // The mutation itself rejects self-change server-side — mirrored
              // here so the control isn't shown at all for your own row.
              const isSelf = u.id === user.id;
              const currentRoleId = u.roleIds[0] ?? "";
              return (
                <li key={u.id} className="flex items-center justify-between py-2.5">
                  <div>
                    <div className="text-sm font-medium text-text">{u.displayName}</div>
                    <div className="text-xs text-text-muted">{u.email}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {canChangeRole && !isSelf ? (
                      <Select value={currentRoleId} onChange={(e) => handleChangeRole(u.id, e.target.value)} className="h-8 text-xs">
                        {roles.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.label}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <div className="flex gap-1.5">
                        {u.roles.map((r) => (
                          <Badge key={r}>{r}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
