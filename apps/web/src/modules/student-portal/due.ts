/**
 * Student Role — how a deadline reads to a student.
 *
 * Shared by all three portal screens so a date never renders one way on the
 * course card and another on the assignment list. "Due Thursday" is what a
 * student can act on; "due 2026-08-28" is what a database knows.
 */
const DAY = 24 * 3600 * 1000;

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Whole days from today, negative when past. Compared date-to-date rather
 * than by elapsed hours, so something due at 9am tomorrow reads "tomorrow"
 * whether it is looked at at 8am or 8pm today. */
export function daysUntil(iso: string | Date): number {
  const then = startOfDay(new Date(iso));
  return Math.round((then - startOfDay(new Date())) / DAY);
}

export function dueLabel(iso: string | Date): string {
  const days = daysUntil(iso);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days < -1) return `${Math.abs(days)} days ago`;
  if (days <= 6) {
    return new Date(iso).toLocaleDateString(undefined, { weekday: "long" });
  }
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Colour carries the urgency so a student can scan without reading every
 * date. Overdue is the only thing that turns red; "today" is amber because it
 * is still actionable. */
export function dueTone(iso: string | Date): string {
  const days = daysUntil(iso);
  const base = "inline-flex items-center gap-1.5";
  if (days < 0) return `${base} text-danger`;
  if (days <= 1) return `${base} text-warning`;
  return `${base} text-text-muted`;
}
