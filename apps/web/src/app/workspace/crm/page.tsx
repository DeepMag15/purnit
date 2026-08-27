"use client";

import { CRMWorkspace } from "../../../modules/crm/CRMWorkspace";

// CRM — ships as a dedicated route from day one, same zero-prop shell
// pattern as leave/attendance/calendar's own page.tsx.
export default function CRMPage() {
  return <CRMWorkspace />;
}
