// Visual Polish & Consistency Pass — extracted from Chart.tsx/Treemap.tsx/
// Funnel.tsx, which each independently redeclared this identical literal.
// CSS var() strings, not fixed hex — theme-reactive for free (light/dark)
// since SVG `fill` accepts custom properties in evergreen browsers, and it
// keeps every chart in step with the same token palette as everything else
// rather than a separate hardcoded chart palette.
export const CHART_SERIES_COLORS = [
  "var(--color-accent)",
  "var(--color-info)",
  "var(--color-success)",
  "var(--color-warning)",
  "var(--color-danger)",
];
