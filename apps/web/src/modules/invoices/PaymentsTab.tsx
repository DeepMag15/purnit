"use client";

import { useState } from "react";
import { useDataSourceQuery } from "../../sdui/use-data-binding";
import { useRenderContext } from "../../sdui/render-context";
import { Card, CardHeader, CardBody } from "../../ui/Card";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Input } from "../../ui/Input";
import { Select } from "../../ui/Select";
import { Icon } from "../../ui/Icon";
import { Alert } from "../../ui/Alert";
import { SkeletonRows } from "../../ui/Skeleton";
import { EmptyStateView } from "../../sdui/primitives/EmptyState";
import { formatCents, dollarsToCents } from "./money";

interface PaymentRow {
  id: string;
  amount: number;
  method: string;
  paidAt: string;
  recordedByName: string;
  notes: string | null;
}

const METHODS = ["cash", "check", "credit_card", "bank_transfer", "other"];

/** Finance Domain, Phase A — nested inside `InvoiceDetail`'s own "Payments"
 * tab, mirrors `AssignmentsGradebookTab.tsx`'s "nested tab component, own
 * data fetch, not SDUI-registered itself" pattern exactly. `canRecordPayments`
 * reflects the separation-of-duties design: a Billing Clerk sees this tab's
 * history (if it also held `payment:read`, which it doesn't in Phase A's
 * default blueprint) but can never record a new one — enforced server-side
 * by `payment.record`'s own `requiredPermission`, this button is just the
 * UX-level reflection of that gate. */
export function PaymentsTab({
  invoiceId,
  invoiceStatus,
  canRecordPayments,
  onRecorded,
}: {
  invoiceId: string;
  invoiceStatus: string;
  canRecordPayments: boolean;
  onRecorded: () => void;
}) {
  const { callMutation } = useRenderContext();
  const [recordOpen, setRecordOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState(METHODS[0]!);
  const [notes, setNotes] = useState("");
  const [recording, setRecording] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);

  const { data, isPending, error, refetch } = useDataSourceQuery<PaymentRow[]>("payments.list", { invoiceId });
  const payments = Array.isArray(data) ? data : [];

  function openRecord() {
    setAmount("");
    setMethod(METHODS[0]!);
    setNotes("");
    setRecordError(null);
    setRecordOpen(true);
  }

  async function handleRecord() {
    const cents = dollarsToCents(amount);
    if (cents <= 0) {
      setRecordError("Enter a payment amount greater than $0");
      return;
    }
    setRecording(true);
    setRecordError(null);
    try {
      await callMutation("payment.record", {
        invoiceId,
        amount: cents,
        method,
        ...(notes ? { notes } : {}),
      });
      setRecordOpen(false);
      refetch();
      onRecorded();
    } catch (err) {
      setRecordError(err instanceof Error ? err.message : "Couldn't record payment");
    } finally {
      setRecording(false);
    }
  }

  const canRecordNow = canRecordPayments && invoiceStatus === "sent";

  return (
    <Card>
      <CardHeader
        title="Payments"
        action={
          canRecordPayments && (
            <Button size="sm" onClick={openRecord} disabled={!canRecordNow}>
              <Icon name="add" size={14} />
              Record Payment
            </Button>
          )
        }
      />
      <CardBody>
        {canRecordPayments && invoiceStatus !== "sent" && (
          <p className="mb-3 text-xs text-text-muted">Payments can only be recorded against a sent invoice.</p>
        )}
        {isPending && <SkeletonRows />}
        {!isPending && error && <Alert tone="danger">Couldn&apos;t load payments: {error instanceof Error ? error.message : String(error)}</Alert>}
        {!isPending && !error && payments.length === 0 && <EmptyStateView message="No payments recorded yet." />}
        {!isPending && !error && payments.length > 0 && (
          <ul className="flex flex-col divide-y divide-border">
            {payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-text">{formatCents(p.amount)}</span>
                  <span className="text-xs text-text-muted">
                    {p.method} · {new Date(p.paidAt).toLocaleDateString()} · recorded by {p.recordedByName}
                  </span>
                  {p.notes && <span className="text-xs text-text-muted">{p.notes}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>

      <Dialog open={recordOpen} onClose={() => setRecordOpen(false)} title="Record Payment">
        <div className="flex flex-col gap-3">
          <Input
            label="Amount"
            type="number"
            min={0}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleRecord()}
            autoFocus
          />
          <Select label="Method" value={method} onChange={(e) => setMethod(e.target.value)}>
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
          <Input label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          {recordError && <Alert tone="danger">{recordError}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRecordOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleRecord} disabled={recording}>
              {recording ? "Recording…" : "Record"}
            </Button>
          </div>
        </div>
      </Dialog>
    </Card>
  );
}
