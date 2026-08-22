"use client";

import { LeaveWorkspace } from "../../../modules/leave/LeaveWorkspace";

// Leave Management — ships as a dedicated route from day one, same
// zero-prop shell pattern as attendance/calendar/meetings' own page.tsx.
export default function LeavePage() {
  return <LeaveWorkspace />;
}
