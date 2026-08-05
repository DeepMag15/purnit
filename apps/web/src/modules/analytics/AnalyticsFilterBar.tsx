"use client";

import { Select } from "../../ui/Select";
import { Input } from "../../ui/Input";
import { useDataSourceQuery } from "../../sdui/use-data-binding";
import { useRenderContext } from "../../sdui/render-context";
import { useAnalyticsFilters } from "./analytics-filter-state";

interface DepartmentOption {
  id: string;
  name: string;
}
interface TeamOption {
  id: string;
  name: string;
  departmentId: string;
}
interface ProjectOption {
  id: string;
  name: string;
  departmentId: string | null;
}
interface UserOption {
  id: string;
  displayName: string;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const PRESETS = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

export function AnalyticsFilterBar() {
  const { user } = useRenderContext();
  const filters = useAnalyticsFilters();

  // departments.list/teams.list/users.list are all gated on department:manage
  // /user:manage — held only by Company Admin and HR Manager (seed.ts) — so
  // these dropdowns are only ever populated for those two roles, mirroring
  // the identical enabled-gate precedent TeamMembers.tsx/CalendarWorkspace.tsx
  // already use for the same three sources. Every other tier still gets the
  // full date-range control and the Company/Personal view tabs; narrowing by
  // a specific department/team/employee they can't browse simply isn't
  // offered as a picker (their own real data scope already applies
  // server-side regardless of whether they can see this control).
  const canBrowseOrg = ["Company Admin", "HR Manager"].some((r) => user.roles.includes(r));

  const { data: departmentsData } = useDataSourceQuery<DepartmentOption[]>("departments.list", {}, { enabled: canBrowseOrg });
  const { data: teamsData } = useDataSourceQuery<TeamOption[]>("teams.list", {}, { enabled: canBrowseOrg });
  const { data: projectsData } = useDataSourceQuery<ProjectOption[]>("projects.list", {}, { enabled: canBrowseOrg });
  const { data: usersData } = useDataSourceQuery<UserOption[]>("users.list", {}, { enabled: canBrowseOrg });

  const departments = Array.isArray(departmentsData) ? departmentsData : [];
  const teams = Array.isArray(teamsData) ? teamsData : [];
  const projects = Array.isArray(projectsData) ? projectsData : [];
  const users = Array.isArray(usersData) ? usersData : [];

  const teamsInDepartment = filters.departmentId ? teams.filter((t) => t.departmentId === filters.departmentId) : teams;

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface-muted p-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs text-text-muted">From</label>
        <Input type="date" value={filters.from} max={filters.to} onChange={(e) => filters.setDateRange(e.target.value, filters.to)} />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-text-muted">To</label>
        <Input type="date" value={filters.to} min={filters.from} max={isoDate(new Date())} onChange={(e) => filters.setDateRange(filters.from, e.target.value)} />
      </div>
      <div className="flex gap-1">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            className="h-9 rounded-md border border-border px-2.5 text-xs text-text-muted transition-colors hover:bg-surface hover:text-text"
            onClick={() => filters.setDateRange(isoDate(new Date(Date.now() - p.days * 24 * 60 * 60 * 1000)), isoDate(new Date()))}
          >
            {p.label}
          </button>
        ))}
      </div>

      {canBrowseOrg && (
        <>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-text-muted">Department</label>
            <Select
              value={filters.departmentId ?? ""}
              onChange={(e) => {
                const value = e.target.value || undefined;
                filters.setFilter("departmentId", value);
                // Clearing/changing department invalidates a previously
                // selected team that's no longer under it.
                if (filters.teamId && !teams.some((t) => t.id === filters.teamId && t.departmentId === value)) {
                  filters.setFilter("teamId", undefined);
                }
              }}
            >
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-text-muted">Team</label>
            <Select value={filters.teamId ?? ""} onChange={(e) => filters.setFilter("teamId", e.target.value || undefined)}>
              <option value="">All teams</option>
              {teamsInDepartment.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-text-muted">Project</label>
            <Select value={filters.projectId ?? ""} onChange={(e) => filters.setFilter("projectId", e.target.value || undefined)}>
              <option value="">All projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-text-muted">Employee</label>
            <Select value={filters.employeeId ?? ""} onChange={(e) => filters.setFilter("employeeId", e.target.value || undefined)}>
              <option value="">All employees</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName}
                </option>
              ))}
            </Select>
          </div>
        </>
      )}
    </div>
  );
}
