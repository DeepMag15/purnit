import { z } from "zod";
import { useEffect, useState } from "react";
import { Icon } from "../../ui/Icon";
import type { CommonRenderProps } from "../../sdui/registry";
import { useRenderContext } from "../../sdui/render-context";
import { useDataSourceBatchQuery } from "../../sdui/use-data-binding";
import { EmptyStateView } from "../../sdui/primitives/EmptyState";
import { Card, CardHeader, CardBody } from "../../ui/Card";
import { Input } from "../../ui/Input";
import { Select } from "../../ui/Select";
import { Button } from "../../ui/Button";
import { Badge } from "../../ui/Badge";
import { Alert } from "../../ui/Alert";
import { SkeletonRows } from "../../ui/Skeleton";
import { useToast } from "../../ui/Toast";

export const OrgStructureSchema = z.object({});
type Props = z.infer<typeof OrgStructureSchema>;

interface DepartmentRow {
  id: string;
  name: string;
  type: string | null;
  parentId: string | null;
  parentName: string | null;
  archived: boolean;
}

interface DepartmentTypeOption {
  id: string;
}

interface TeamRow {
  id: string;
  name: string;
  departmentId: string;
  departmentName: string;
  archived: boolean;
}

interface UserRow {
  id: string;
  displayName: string;
  email: string;
  departmentId: string | null;
  departmentName: string | null;
  teamId: string | null;
  teamName: string | null;
  managerId: string | null;
}

// Bind is unused — departments uses `useDataSourceQuery` (CONTEXT.md §48)
// instead of a blueprint `bind`, so the "show archived" toggle can pass a
// live, UI-driven param; `useDataBinding` only resolves static/ref params.
export function OrgStructure({ actions }: Props & CommonRenderProps) {
  const { callMutation } = useRenderContext();
  const toast = useToast();

  const canManageDepartments = actions?.some((a) => a.kind === "mutation" && a.mutation === "department.create") ?? false;
  const canUpdateDepartments = actions?.some((a) => a.kind === "mutation" && a.mutation === "department.update") ?? false;
  const canArchiveDepartments = actions?.some((a) => a.kind === "mutation" && a.mutation === "department.setArchived") ?? false;
  const canDeleteDepartments = actions?.some((a) => a.kind === "mutation" && a.mutation === "department.delete") ?? false;
  const canAssignHead = actions?.some((a) => a.kind === "mutation" && a.mutation === "department.assignHead") ?? false;
  const canManageTeams = actions?.some((a) => a.kind === "mutation" && a.mutation === "team.create") ?? false;
  const canUpdateTeams = actions?.some((a) => a.kind === "mutation" && a.mutation === "team.update") ?? false;
  const canMoveTeams = actions?.some((a) => a.kind === "mutation" && a.mutation === "team.moveToDepartment") ?? false;
  const canArchiveTeams = actions?.some((a) => a.kind === "mutation" && a.mutation === "team.setArchived") ?? false;
  const canDeleteTeams = actions?.some((a) => a.kind === "mutation" && a.mutation === "team.delete") ?? false;
  const canAssignManager = actions?.some((a) => a.kind === "mutation" && a.mutation === "team.assignManager") ?? false;
  const canAssign = actions?.some((a) => a.kind === "mutation" && a.mutation === "user.assignDepartment") ?? false;
  const canSetManager = actions?.some((a) => a.kind === "mutation" && a.mutation === "user.setManager") ?? false;
  const needsUsers = canAssign || canAssignHead || canAssignManager;

  const [showArchived, setShowArchived] = useState(false);

  // Performance pass 2 (CONTEXT.md §48): these 4 fetches used to be 4
  // separate hand-rolled `useEffect`+`useState`+`callDataSource()` calls —
  // 4 network round trips and 4 backend transactions on every mount, none of
  // them cached. Now one `POST /api/data/batch` call — 1 round trip, 1
  // transaction — with each result also seeded into the shared query cache
  // so anything else on the page asking for the same source+params gets an
  // instant hit.
  const teamsEnabled = canManageTeams || canAssign || canMoveTeams || canAssignManager;
  const requests: { source: string; params?: Record<string, unknown> }[] = [{ source: "departments.list", params: { includeArchived: showArchived } }];
  if (teamsEnabled) requests.push({ source: "teams.list", params: { includeArchived: showArchived } });
  if (needsUsers) requests.push({ source: "users.list" });
  if (canManageDepartments) requests.push({ source: "departmentTypes.list" });

  const { results, isPending, refetch } = useDataSourceBatchQuery(requests);
  let resultIndex = 0;
  const departmentsResult = results[resultIndex++];
  const teamsResult = teamsEnabled ? results[resultIndex++] : undefined;
  const usersResult = needsUsers ? results[resultIndex++] : undefined;
  // Last read of resultIndex — no trailing increment needed.
  const departmentTypesResult = canManageDepartments ? results[resultIndex] : undefined;

  const departments = Array.isArray(departmentsResult?.data) ? (departmentsResult.data as DepartmentRow[]) : [];
  const departmentsLoading = isPending;
  const departmentsError = departmentsResult?.error ?? null;
  const teams = Array.isArray(teamsResult?.data) ? (teamsResult.data as TeamRow[]) : [];
  const users = Array.isArray(usersResult?.data) ? (usersResult.data as UserRow[]) : [];
  const departmentTypes = Array.isArray(departmentTypesResult?.data) ? (departmentTypesResult.data as DepartmentTypeOption[]) : [];

  function refetchAll() {
    refetch();
  }

  const [newDeptName, setNewDeptName] = useState("");
  const [newDeptParentId, setNewDeptParentId] = useState("");
  const [newDeptType, setNewDeptType] = useState("");
  const [creatingDept, setCreatingDept] = useState(false);

  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamDeptId, setNewTeamDeptId] = useState("");
  const [creatingTeam, setCreatingTeam] = useState(false);

  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    setNewDeptParentId((current) => current || departments[0]?.id || "");
    setNewTeamDeptId((current) => current || departments[0]?.id || "");
  }, [departments]);

  async function handleCreateDepartment() {
    if (!newDeptName.trim()) return;
    setCreatingDept(true);
    setFormError(null);
    try {
      await callMutation("department.create", {
        name: newDeptName.trim(),
        parentId: newDeptParentId || undefined,
        type: newDeptType || undefined,
      });
      toast.show(`Department "${newDeptName.trim()}" created`);
      setNewDeptName("");
      refetchAll();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Couldn't create department");
    } finally {
      setCreatingDept(false);
    }
  }

  async function handleCreateTeam() {
    if (!newTeamName.trim() || !newTeamDeptId) return;
    setCreatingTeam(true);
    setFormError(null);
    try {
      await callMutation("team.create", { name: newTeamName.trim(), departmentId: newTeamDeptId });
      toast.show(`Team "${newTeamName.trim()}" created`);
      setNewTeamName("");
      refetchAll();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Couldn't create team");
    } finally {
      setCreatingTeam(false);
    }
  }

  async function handleAssign(userId: string, departmentId: string, teamId: string) {
    try {
      await callMutation("user.assignDepartment", { userId, departmentId, teamId: teamId || undefined });
      toast.show("Assignment saved");
      refetchAll();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Couldn't assign department");
    }
  }

  async function handleSetManager(userId: string, managerId: string) {
    try {
      await callMutation("user.setManager", { userId, managerId: managerId || null });
      toast.show("Manager saved");
      refetchAll();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Couldn't set manager");
    }
  }

  const showDepartmentControls = canUpdateDepartments || canArchiveDepartments || canDeleteDepartments || canAssignHead;
  const showTeamControls = canUpdateTeams || canMoveTeams || canArchiveTeams || canDeleteTeams || canAssignManager;

  return (
    <div className="flex flex-col gap-4">
      {formError && <Alert tone="danger">{formError}</Alert>}

      {(canArchiveDepartments || canArchiveTeams) && (
        <label className="flex items-center gap-1.5 self-start text-xs text-text-muted">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
      )}

      <Card>
        <CardHeader title="Departments" />
        <CardBody className="flex flex-col gap-3">
          {canManageDepartments && (
            <div className="flex flex-wrap gap-2">
              <Input value={newDeptName} onChange={(e) => setNewDeptName(e.target.value)} placeholder="Department name" className="flex-1" />
              <Select value={newDeptParentId} onChange={(e) => setNewDeptParentId(e.target.value)}>
                <option value="">No parent</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
              <Select value={newDeptType} onChange={(e) => setNewDeptType(e.target.value)}>
                <option value="">No type</option>
                {departmentTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.id}
                  </option>
                ))}
              </Select>
              <Button onClick={handleCreateDepartment} disabled={creatingDept || !newDeptName.trim()}>
                <Icon name="add" size={14} />
                {creatingDept ? "Adding…" : "New Department"}
              </Button>
            </div>
          )}
          {departmentsLoading && <SkeletonRows rows={2} />}
          {departmentsError && <Alert tone="danger">Couldn&apos;t load departments: {departmentsError}</Alert>}
          {!departmentsLoading && !departmentsError && departments.length === 0 && <EmptyStateView message="No departments yet." />}
          {!departmentsLoading && !departmentsError && departments.length > 0 && (
            <ul className="flex flex-col divide-y divide-border">
              {departments.map((d) => (
                <DepartmentListItem
                  key={d.id}
                  department={d}
                  allDepartments={departments}
                  departmentTypes={departmentTypes}
                  users={users}
                  showControls={showDepartmentControls}
                  canUpdate={canUpdateDepartments}
                  canArchive={canArchiveDepartments}
                  canDelete={canDeleteDepartments}
                  canAssignHead={canAssignHead}
                  onChanged={refetchAll}
                  onError={setFormError}
                />
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {canManageTeams && (
        <Card>
          <CardHeader title="Teams" />
          <CardBody className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <Input value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)} placeholder="Team name" className="flex-1" />
              <Select value={newTeamDeptId} onChange={(e) => setNewTeamDeptId(e.target.value)}>
                {departments.length === 0 && <option value="">No departments yet</option>}
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
              <Button onClick={handleCreateTeam} disabled={creatingTeam || !newTeamName.trim() || !newTeamDeptId}>
                <Icon name="add" size={14} />
                {creatingTeam ? "Adding…" : "New Team"}
              </Button>
            </div>
            {teams.length === 0 ? (
              <EmptyStateView message="No teams yet." />
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {teams.map((t) => (
                  <TeamListItem
                    key={t.id}
                    team={t}
                    allDepartments={departments}
                    users={users}
                    showControls={showTeamControls}
                    canUpdate={canUpdateTeams}
                    canMove={canMoveTeams}
                    canArchive={canArchiveTeams}
                    canDelete={canDeleteTeams}
                    canAssignManager={canAssignManager}
                    onChanged={refetchAll}
                    onError={setFormError}
                  />
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}

      {canAssign && (
        <Card>
          <CardHeader title="Assign teammates" />
          <CardBody>
            {users.length === 0 ? (
              <EmptyStateView message="No teammates yet." />
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {users.map((u) => (
                  <EmployeeAssignmentRow
                    key={u.id}
                    user={u}
                    departments={departments}
                    teams={teams}
                    allUsers={users}
                    onAssign={handleAssign}
                    onSetManager={canSetManager ? handleSetManager : undefined}
                  />
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function DepartmentListItem({
  department,
  allDepartments,
  departmentTypes,
  users,
  showControls,
  canUpdate,
  canArchive,
  canDelete,
  canAssignHead,
  onChanged,
  onError,
}: {
  department: DepartmentRow;
  allDepartments: DepartmentRow[];
  departmentTypes: DepartmentTypeOption[];
  users: UserRow[];
  showControls: boolean;
  canUpdate: boolean;
  canArchive: boolean;
  canDelete: boolean;
  canAssignHead: boolean;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const { callMutation } = useRenderContext();
  const toast = useToast();
  const [name, setName] = useState(department.name);
  const [type, setType] = useState(department.type ?? "");
  const [parentId, setParentId] = useState(department.parentId ?? "");
  const [headUserId, setHeadUserId] = useState("");
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [assigningHead, setAssigningHead] = useState(false);

  const unchanged = name.trim() === department.name && type === (department.type ?? "") && parentId === (department.parentId ?? "");

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await callMutation("department.update", {
        id: department.id,
        name: name.trim(),
        type: type || undefined,
        parentId: parentId || null,
      });
      toast.show(`"${name.trim()}" saved`);
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't update department");
    } finally {
      setSaving(false);
    }
  }

  async function handleArchiveToggle() {
    setArchiving(true);
    try {
      await callMutation("department.setArchived", { id: department.id, archived: !department.archived });
      toast.show(department.archived ? `"${department.name}" restored` : `"${department.name}" archived`);
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't update department");
    } finally {
      setArchiving(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete department "${department.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await callMutation("department.delete", { id: department.id });
      toast.show(`"${department.name}" deleted`);
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't delete department");
    } finally {
      setDeleting(false);
    }
  }

  async function handleAssignHead() {
    if (!headUserId) return;
    setAssigningHead(true);
    try {
      await callMutation("department.assignHead", { departmentId: department.id, userId: headUserId });
      toast.show("Department head assigned");
      setHeadUserId("");
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't assign department head");
    } finally {
      setAssigningHead(false);
    }
  }

  return (
    <li className="flex flex-col gap-2 py-2.5 text-sm text-text">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex-1">
          {department.parentName ? `${department.parentName} / ${department.name}` : department.name}
          {department.type && <span className="ml-2 text-xs text-text-muted">({department.type})</span>}
          {department.archived && (
            <span className="ml-2 inline-block">
              <Badge tone="neutral">Archived</Badge>
            </span>
          )}
        </span>
      </div>

      {showControls && (
        <div className="flex flex-wrap items-center gap-2">
          {canUpdate && (
            <>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="w-40" />
              <Select value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">No type</option>
                {departmentTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.id}
                  </option>
                ))}
              </Select>
              <Select value={parentId} onChange={(e) => setParentId(e.target.value)}>
                <option value="">No parent</option>
                {allDepartments
                  .filter((d) => d.id !== department.id)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </Select>
              <Button variant="secondary" size="sm" onClick={handleSave} disabled={saving || !name.trim() || unchanged}>
                <Icon name="save" size={13} />
                Save
              </Button>
            </>
          )}
          {canArchive && (
            <Button variant="secondary" size="sm" onClick={handleArchiveToggle} disabled={archiving}>
              <Icon name={department.archived ? "unarchive" : "archive"} size={13} />
              {department.archived ? "Unarchive" : "Archive"}
            </Button>
          )}
          {canDelete && (
            <Button variant="danger" size="sm" onClick={handleDelete} disabled={deleting}>
              <Icon name="delete" size={13} />
              Delete
            </Button>
          )}
          {canAssignHead && (
            <>
              <Select value={headUserId} onChange={(e) => setHeadUserId(e.target.value)}>
                <option value="">Assign head…</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName}
                  </option>
                ))}
              </Select>
              <Button variant="secondary" size="sm" onClick={handleAssignHead} disabled={assigningHead || !headUserId}>
                <Icon name="badge" size={13} />
                Assign head
              </Button>
            </>
          )}
        </div>
      )}
    </li>
  );
}

function TeamListItem({
  team,
  allDepartments,
  users,
  showControls,
  canUpdate,
  canMove,
  canArchive,
  canDelete,
  canAssignManager,
  onChanged,
  onError,
}: {
  team: TeamRow;
  allDepartments: DepartmentRow[];
  users: UserRow[];
  showControls: boolean;
  canUpdate: boolean;
  canMove: boolean;
  canArchive: boolean;
  canDelete: boolean;
  canAssignManager: boolean;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const { callMutation } = useRenderContext();
  const toast = useToast();
  const [name, setName] = useState(team.name);
  const [moveDeptId, setMoveDeptId] = useState(team.departmentId);
  const [managerUserId, setManagerUserId] = useState("");
  const [saving, setSaving] = useState(false);
  const [moving, setMoving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [assigningManager, setAssigningManager] = useState(false);

  async function handleSave() {
    if (!name.trim() || name.trim() === team.name) return;
    setSaving(true);
    try {
      await callMutation("team.update", { id: team.id, name: name.trim() });
      toast.show(`"${name.trim()}" saved`);
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't update team");
    } finally {
      setSaving(false);
    }
  }

  async function handleMove() {
    if (!moveDeptId || moveDeptId === team.departmentId) return;
    setMoving(true);
    try {
      await callMutation("team.moveToDepartment", { id: team.id, departmentId: moveDeptId });
      toast.show(`"${team.name}" moved`);
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't move team");
    } finally {
      setMoving(false);
    }
  }

  async function handleArchiveToggle() {
    setArchiving(true);
    try {
      await callMutation("team.setArchived", { id: team.id, archived: !team.archived });
      toast.show(team.archived ? `"${team.name}" restored` : `"${team.name}" archived`);
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't update team");
    } finally {
      setArchiving(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete team "${team.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await callMutation("team.delete", { id: team.id });
      toast.show(`"${team.name}" deleted`);
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't delete team");
    } finally {
      setDeleting(false);
    }
  }

  async function handleAssignManager() {
    if (!managerUserId) return;
    setAssigningManager(true);
    try {
      await callMutation("team.assignManager", { teamId: team.id, userId: managerUserId });
      toast.show("Team manager assigned");
      setManagerUserId("");
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't assign team manager");
    } finally {
      setAssigningManager(false);
    }
  }

  return (
    <li className="flex flex-col gap-2 py-2.5 text-sm text-text">
      <span>
        {team.departmentName} / {team.name}
        {team.archived && (
          <span className="ml-2 inline-block">
            <Badge tone="neutral">Archived</Badge>
          </span>
        )}
      </span>

      {showControls && (
        <div className="flex flex-wrap items-center gap-2">
          {canUpdate && (
            <>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="w-40" />
              <Button variant="secondary" size="sm" onClick={handleSave} disabled={saving || !name.trim() || name.trim() === team.name}>
                <Icon name="save" size={13} />
                Save
              </Button>
            </>
          )}
          {canMove && (
            <>
              <Select value={moveDeptId} onChange={(e) => setMoveDeptId(e.target.value)}>
                {allDepartments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
              <Button variant="secondary" size="sm" onClick={handleMove} disabled={moving || moveDeptId === team.departmentId}>
                <Icon name="compare_arrows" size={13} />
                Move
              </Button>
            </>
          )}
          {canArchive && (
            <Button variant="secondary" size="sm" onClick={handleArchiveToggle} disabled={archiving}>
              <Icon name={team.archived ? "unarchive" : "archive"} size={13} />
              {team.archived ? "Unarchive" : "Archive"}
            </Button>
          )}
          {canDelete && (
            <Button variant="danger" size="sm" onClick={handleDelete} disabled={deleting}>
              <Icon name="delete" size={13} />
              Delete
            </Button>
          )}
          {canAssignManager && (
            <>
              <Select value={managerUserId} onChange={(e) => setManagerUserId(e.target.value)}>
                <option value="">Assign manager…</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName}
                  </option>
                ))}
              </Select>
              <Button variant="secondary" size="sm" onClick={handleAssignManager} disabled={assigningManager || !managerUserId}>
                <Icon name="badge" size={13} />
                Assign manager
              </Button>
            </>
          )}
        </div>
      )}
    </li>
  );
}

function EmployeeAssignmentRow({
  user,
  departments,
  teams,
  allUsers,
  onAssign,
  onSetManager,
}: {
  user: UserRow;
  departments: DepartmentRow[];
  teams: TeamRow[];
  allUsers: UserRow[];
  onAssign: (userId: string, departmentId: string, teamId: string) => void;
  onSetManager?: (userId: string, managerId: string) => void;
}) {
  const [departmentId, setDepartmentId] = useState(user.departmentId ?? "");
  const [teamId, setTeamId] = useState(user.teamId ?? "");
  const [managerId, setManagerId] = useState(user.managerId ?? "");
  const teamsInDepartment = teams.filter((t) => t.departmentId === departmentId);
  // A user can't be their own manager — the mutation rejects it server-side
  // too, but there's no reason to even offer the option here.
  const managerOptions = allUsers.filter((u) => u.id !== user.id);

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2.5">
      <div>
        <div className="text-sm font-medium text-text">{user.displayName}</div>
        <div className="text-xs text-text-muted">
          {user.departmentName ? `${user.departmentName}${user.teamName ? ` / ${user.teamName}` : ""}` : "No department set"}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Select
          value={departmentId}
          onChange={(e) => {
            setDepartmentId(e.target.value);
            setTeamId("");
          }}
        >
          <option value="">No department</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
        <Select value={teamId} onChange={(e) => setTeamId(e.target.value)} disabled={!departmentId}>
          <option value="">No team</option>
          {teamsInDepartment.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
        <Button variant="secondary" size="sm" onClick={() => departmentId && onAssign(user.id, departmentId, teamId)} disabled={!departmentId}>
          <Icon name="save" size={13} />
          Save
        </Button>
        {onSetManager && (
          <>
            <Select value={managerId} onChange={(e) => setManagerId(e.target.value)}>
              <option value="">No manager</option>
              {managerOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                </option>
              ))}
            </Select>
            <Button variant="secondary" size="sm" onClick={() => onSetManager(user.id, managerId)}>
              <Icon name="save" size={13} />
              Set manager
            </Button>
          </>
        )}
      </div>
    </li>
  );
}
