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
  notifications: "notifications",
  "audit-logs": "history",

  // Role-Based Workspaces, Stage A — these keys were already in use by
  // blueprint nav items but had no entry here, so `iconFor()` fell back to a
  // generic dot: Chat, Leave, CRM and every vertical-domain module rendered
  // as an indistinguishable circle in the sidebar. Visible in the product,
  // not a theoretical gap.
  chat: "forum",
  event_busy: "event_busy",
  handshake: "handshake",
  group: "group",
  school: "school",
  receipt: "receipt_long",
  local_shipping: "local_shipping",
  inventory_2: "inventory_2",
  shopping_cart: "shopping_cart",
  precision_manufacturing: "precision_manufacturing",

  // New group headers introduced by the role-based nav restructure.
  work: "work",
  care: "stethoscope",
  academics: "menu_book",
  accounts: "account_balance",
  operations: "conveyor_belt",
  collaborate: "forum",
  personal: "person",
  people: "diversity_3",
};

export function iconFor(key: string | undefined): string {
  return (key && ICONS[key]) || "circle";
}
