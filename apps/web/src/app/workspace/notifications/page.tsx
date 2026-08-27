"use client";

import { NotificationsPage as NotificationsPageContent } from "../../../modules/notifications/NotificationsPage";

// Notifications — ships as a dedicated route from day one, same zero-prop
// shell pattern as leave/crm/attendance/calendar's own page.tsx.
export default function NotificationsPage() {
  return <NotificationsPageContent />;
}
