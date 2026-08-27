/** Finance Domain, Phase A. Money is always stored/transmitted as `Int`
 * cents (see invoice.prisma's own doc comment) — these two helpers are the
 * only place cents<->dollars conversion happens, shared across
 * InvoicesWorkspace/InvoiceDetail/PaymentsTab/ClientDetail rather than
 * duplicated per file. */
export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

export function dollarsToCents(dollars: string | number): number {
  const value = typeof dollars === "string" ? Number(dollars) : dollars;
  return Math.round((Number.isFinite(value) ? value : 0) * 100);
}
