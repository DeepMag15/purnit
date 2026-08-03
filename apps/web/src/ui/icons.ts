// Maps a blueprint NavItem's `icon` string key (config-driven, not hardcoded
// routes) to a Material Symbols Outlined glyph name (see ui/Icon.tsx — the
// icon font is a ligature font, so the map's values are the actual text
// content an <Icon name={...}> renders, not component references). Add an
// entry here whenever a new icon key shows up in a blueprint fixture —
// `iconFor()` falls back to a generic dot rather than throwing, since an
// unrecognized key shouldn't break rendering.
const ICONS: Record<string, string> = {
  home: "dashboard",
  folder: "layers",
  "check-square": "task_alt",
  users: "group",
  sitemap: "account_tree",
  settings: "settings",
  meetings: "event",
  announcements: "campaign",
  calendar: "calendar_month",
  "team-management": "supervisor_account",
  "hr-group": "diversity_3",
  recruitment: "person_search",
  attendance: "event_available",
  reviews: "reviews",
  insights: "insights",
  "workspace-admin": "admin_panel_settings",
  company: "apartment",
  "roles-permissions": "badge",
  analytics: "monitoring",
  account: "account_circle",
};

export function iconFor(key: string | undefined): string {
  return (key && ICONS[key]) || "circle";
}
