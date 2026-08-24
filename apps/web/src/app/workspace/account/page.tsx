"use client";

import { AccountSettings } from "../../../modules/account/AccountSettings";

// Role-Based Workspaces, Stage D — the personal half of Settings, split out
// of the workspace-administration page.
//
// Deliberately NOT a blueprint page and deliberately absent from the sidebar:
// it is reached from the avatar menu, which is where people look for their own
// settings, and it needs no permission because it only ever acts on the
// signed-in person's own account. Same zero-prop shell pattern as every other
// dedicated route.
export default function AccountPage() {
  return <AccountSettings />;
}
