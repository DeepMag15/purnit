import type { StatusTone } from "../ui/StatusDot";

export type CalendarItemType =
  | "meeting"
  | "calendarEvent"
  | "task"
  | "appointment"
  | "assignmentDue"
  | "invoiceDue"
  | "workOrderDue"
  | "purchaseOrderExpected";

/**
 * Frontend Redesign, Phase 02 — shared by the dashboard's `AgendaWidget`
 * (Phase 01) and `CalendarWorkspace` (this phase), both of which render the
 * exact same `calendar.list` item shape. Extracted here rather than left
 * duplicated in both files, so the two surfaces can't silently drift on
 * what a "meeting" vs. a "task due" is supposed to look like.
 */
export const CALENDAR_ITEM_TONE: Record<CalendarItemType, StatusTone> = {
  meeting: "review",
  calendarEvent: "queued",
  task: "progress",
  appointment: "review",
  assignmentDue: "progress",
  invoiceDue: "danger",
  workOrderDue: "progress",
  purchaseOrderExpected: "review",
};

export const CALENDAR_ITEM_ICON: Record<CalendarItemType, string> = {
  meeting: "groups",
  calendarEvent: "event",
  task: "task_alt",
  appointment: "medical_services",
  assignmentDue: "assignment",
  invoiceDue: "receipt_long",
  workOrderDue: "precision_manufacturing",
  purchaseOrderExpected: "local_shipping",
};

/** "Due"/"Expected"/plain-type-name label — same logic `CalendarWorkspace`'s
 * own `CalendarItemChip` already had, just centralized. */
export function calendarItemTypeLabel(itemType: CalendarItemType): string {
  if (itemType === "task" || itemType === "assignmentDue" || itemType === "invoiceDue" || itemType === "workOrderDue") return "Due";
  if (itemType === "purchaseOrderExpected") return "Expected";
  return itemType;
}
