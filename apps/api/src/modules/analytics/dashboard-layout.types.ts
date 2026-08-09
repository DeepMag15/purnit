import { z } from "zod";

// react-grid-layout's own per-item shape (Phase E) — one entry per widget
// key. A widget key present in analytics.dashboard's response but absent
// here (a metric added after this layout was saved, or a newly-granted
// permission surfacing a widget for the first time) is auto-placed by the
// frontend, never treated as an error — see AnalyticsDashboard.tsx.
export const WidgetLayoutEntrySchema = z.object({
  key: z.string(),
  visible: z.boolean(),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
});
export type WidgetLayoutEntry = z.infer<typeof WidgetLayoutEntrySchema>;
