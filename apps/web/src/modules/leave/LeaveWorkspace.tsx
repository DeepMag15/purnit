"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useRenderContext } from "../../sdui/render-context";
import { useDataSourceQuery, dataSourceQueryKey } from "../../sdui/use-data-binding";
import { Card, CardHeader, CardBody } from "../../ui/Card";
import { PageHeader } from "../../ui/PageHeader";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Input } from "../../ui/Input";
import { Select } from "../../ui/Select";
import { StatusDot, type StatusTone } from "../../ui/StatusDot";
import { Icon } from "../../ui/Icon";
import { Alert } from "../../ui/Alert";
import { SkeletonRows } from "../../ui/Skeleton";
import { EmptyStateView } from "../../sdui/primitives/EmptyState";
import { useToast } from "../../ui/Toast";

export const LeaveWorkspaceSchema = z.object({});

interface LeaveCapabilities {
  canApprove: boolean;
  canManageTypes: boolean;
}

interface LeaveType {
  id: string;
  name: string;
  defaultAnnualDays: number;
}

interface LeaveBalanceRow {
  leaveTypeId: string;
  leaveTypeName: string;
  year: number;
  allottedDays: number;
  usedDays: number;
}

interface LeaveRequestRow {
  id: string;
  userId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  daysRequested: number;
  reason: string | null;
  status: string;
  approverId: string | null;
  decisionNote: string | null;
}

const STATUS_TONE: Record<string, StatusTone> = {
  pending: "queued",
  approved: "done",
  rejected: "danger",
  cancelled: "neutral",
};

function formatDateRange(startDate: string, endDate: string): string {
  const start = new Date(startDate).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const end = new Date(endDate).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return startDate === endDate || start === end ? start : `${start} – ${end}`;
}

/**
 * Leave Management — ORG_HIERARCHY.md §9-10's first real consumer of
 * User.managerId/user.setManager (see resolve-approver.ts). Ships as a
 * dedicated route from day one, same zero-prop/`*.capabilities`-driven
 * shape every Frontend Redesign module since Phase 02 uses — `canApprove`/
 * `canManageTypes` come from `leave.capabilities`, never a role-label guess.
 */
export function LeaveWorkspace() {
  const { user, tenant, callMutation } = useRenderContext();
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data: caps } = useDataSourceQuery<LeaveCapabilities>("leave.capabilities");
  const canApprove = caps?.canApprove ?? false;
  const canManageTypes = caps?.canManageTypes ?? false;

  const { data: typesData } = useDataSourceQuery<LeaveType[]>("leaveTypes.list");
  const types = Array.isArray(typesData) ? typesData : [];
  const typeById = new Map(types.map((t) => [t.id, t]));

  const { data: balancesData, isPending: balancesPending } = useDataSourceQuery<LeaveBalanceRow[]>("leaveBalances.list");
  const balances = Array.isArray(balancesData) ? balancesData : [];

  const { data: myRequestsData, isPending: myRequestsPending } = useDataSourceQuery<LeaveRequestRow[]>("leaveRequests.list");
  const myRequests = Array.isArray(myRequestsData) ? myRequestsData : [];

  const { data: pendingData, isPending: pendingPending } = useDataSourceQuery<LeaveRequestRow[]>("leaveRequests.pendingApprovals", {}, { enabled: canApprove });
  const pendingApprovals = Array.isArray(pendingData) ? pendingData : [];

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: dataSourceQueryKey("leaveBalances.list", {}, tenant.id, user.id) });
    queryClient.invalidateQueries({ queryKey: dataSourceQueryKey("leaveRequests.list", {}, tenant.id, user.id) });
    queryClient.invalidateQueries({ queryKey: dataSourceQueryKey("leaveRequests.pendingApprovals", {}, tenant.id, user.id) });
  }

  const [requestOpen, setRequestOpen] = useState(false);
  const [reqLeaveTypeId, setReqLeaveTypeId] = useState("");
  const [reqStartDate, setReqStartDate] = useState("");
  const [reqEndDate, setReqEndDate] = useState("");
  const [reqReason, setReqReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function openRequest() {
    setReqLeaveTypeId(types[0]?.id ?? "");
    setReqStartDate("");
    setReqEndDate("");
    setReqReason("");
    setSubmitError(null);
    setRequestOpen(true);
  }

  async function handleSubmit() {
    if (!reqLeaveTypeId || !reqStartDate || !reqEndDate) {
      setSubmitError("Choose a leave type and both dates");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      await callMutation("leave.submit", {
        leaveTypeId: reqLeaveTypeId,
        startDate: reqStartDate,
        endDate: reqEndDate,
        ...(reqReason.trim() ? { reason: reqReason.trim() } : {}),
      });
      toast.show("Leave request submitted");
      setRequestOpen(false);
      invalidateAll();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Couldn't submit request");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel(id: string) {
    try {
      await callMutation("leave.cancel", { id });
      toast.show("Request cancelled");
      invalidateAll();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't cancel request", "danger");
    }
  }

  async function handleDecision(id: string, decision: "approve" | "reject") {
    try {
      await callMutation(decision === "approve" ? "leave.approve" : "leave.reject", { id });
      toast.show(decision === "approve" ? "Request approved" : "Request rejected");
      invalidateAll();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't record decision", "danger");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Leave"
        actions={
          <Button onClick={openRequest} disabled={types.length === 0}>
            <Icon name="add" size={14} />
            Request Leave
          </Button>
        }
      />

      <Card>
        <CardHeader title="My balance" />
        <CardBody className="flex flex-wrap gap-6">
          {balancesPending && <SkeletonRows rows={1} />}
          {!balancesPending && balances.length === 0 && <EmptyStateView message="No leave types configured yet." />}
          {!balancesPending &&
            balances.map((b) => (
              <div key={b.leaveTypeId} className="flex flex-col">
                <span className="text-xs text-text-muted">{b.leaveTypeName}</span>
                <span className="text-lg font-semibold text-text">
                  {b.allottedDays - b.usedDays} <span className="text-xs font-normal text-text-muted">/ {b.allottedDays} days left</span>
                </span>
              </div>
            ))}
        </CardBody>
      </Card>

      {canApprove && (
        <Card>
          <CardHeader title="Pending approvals" />
          <CardBody className="flex flex-col gap-2">
            {pendingPending && <SkeletonRows rows={2} />}
            {!pendingPending && pendingApprovals.length === 0 && <EmptyStateView message="Nothing waiting on you." />}
            {!pendingPending &&
              pendingApprovals.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface px-3 py-2">
                  <StatusDot tone={STATUS_TONE[r.status] ?? "neutral"} />
                  <span className="min-w-0 flex-1 text-sm text-text">
                    {typeById.get(r.leaveTypeId)?.name ?? "Leave"} · {formatDateRange(r.startDate, r.endDate)} · {r.daysRequested} day(s)
                  </span>
                  {r.reason && <span className="text-xs text-text-muted">{r.reason}</span>}
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" variant="secondary" onClick={() => handleDecision(r.id, "reject")}>
                      Reject
                    </Button>
                    <Button size="sm" onClick={() => handleDecision(r.id, "approve")}>
                      Approve
                    </Button>
                  </div>
                </div>
              ))}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="My requests" />
        <CardBody className="flex flex-col gap-2">
          {myRequestsPending && <SkeletonRows rows={2} />}
          {!myRequestsPending && myRequests.length === 0 && <EmptyStateView message="No leave requests yet." />}
          {!myRequestsPending &&
            myRequests.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface px-3 py-2">
                <StatusDot tone={STATUS_TONE[r.status] ?? "neutral"} />
                <span className="min-w-0 flex-1 text-sm text-text">
                  {typeById.get(r.leaveTypeId)?.name ?? "Leave"} · {formatDateRange(r.startDate, r.endDate)} · {r.daysRequested} day(s)
                </span>
                <span className="shrink-0 text-xs capitalize text-text-muted">{r.status}</span>
                {(r.status === "pending" || r.status === "approved") && (
                  <Button size="sm" variant="secondary" onClick={() => handleCancel(r.id)}>
                    Cancel
                  </Button>
                )}
              </div>
            ))}
        </CardBody>
      </Card>

      {canManageTypes && <ManageLeaveTypes types={types} onCreated={invalidateAll} />}

      <Dialog open={requestOpen} onClose={() => setRequestOpen(false)} title="Request Leave">
        <div className="flex flex-col gap-3">
          <Select label="Leave type" value={reqLeaveTypeId} onChange={(e) => setReqLeaveTypeId(e.target.value)} autoFocus>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
          <Input label="Start date" type="date" value={reqStartDate} onChange={(e) => setReqStartDate(e.target.value)} />
          <Input label="End date" type="date" value={reqEndDate} onChange={(e) => setReqEndDate(e.target.value)} />
          <Input label="Reason (optional)" value={reqReason} onChange={(e) => setReqReason(e.target.value)} />
          {submitError && <Alert tone="danger">{submitError}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRequestOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? "Submitting…" : "Submit"}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function ManageLeaveTypes({ types, onCreated }: { types: LeaveType[]; onCreated: () => void }) {
  const { callMutation } = useRenderContext();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [defaultAnnualDays, setDefaultAnnualDays] = useState("20");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openCreate() {
    setName("");
    setDefaultAnnualDays("20");
    setError(null);
    setOpen(true);
  }

  async function handleCreate() {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await callMutation("leaveType.create", { name: name.trim(), defaultAnnualDays: Number(defaultAnnualDays) });
      toast.show("Leave type created");
      setOpen(false);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create leave type");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Leave types"
        action={
          <Button size="sm" variant="secondary" onClick={openCreate}>
            <Icon name="add" size={14} />
            Add Type
          </Button>
        }
      />
      <CardBody className="flex flex-col gap-1.5">
        {types.length === 0 && <EmptyStateView message="No leave types yet." />}
        {types.map((t) => (
          <div key={t.id} className="flex items-center justify-between text-sm">
            <span className="text-text">{t.name}</span>
            <span className="text-text-muted">{t.defaultAnnualDays} days/year</span>
          </div>
        ))}
      </CardBody>

      <Dialog open={open} onClose={() => setOpen(false)} title="Add Leave Type">
        <div className="flex flex-col gap-3">
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleCreate()} autoFocus />
          <Input label="Default annual days" type="number" min={1} value={defaultAnnualDays} onChange={(e) => setDefaultAnnualDays(e.target.value)} />
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving ? "Creating…" : "Create"}
            </Button>
          </div>
        </div>
      </Dialog>
    </Card>
  );
}
