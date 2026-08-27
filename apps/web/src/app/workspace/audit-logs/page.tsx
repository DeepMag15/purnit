"use client";

import { AuditLogsPage as AuditLogsPageContent } from "../../../modules/audit/AuditLogsPage";

// Audit Logs — ships as a dedicated route from day one, same zero-prop shell
// pattern as leave/crm/notifications/attendance's own page.tsx.
export default function AuditLogsPage() {
  return <AuditLogsPageContent />;
}
