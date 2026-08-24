"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useBootstrap } from "../../app/workspace/bootstrap-context";
import { useRenderContext } from "../../sdui/render-context";
import { PageHeader } from "../../ui/PageHeader";
import { Card, CardBody, CardHeader } from "../../ui/Card";
import { Button } from "../../ui/Button";
import { Switch } from "../../ui/Switch";
import { Badge } from "../../ui/Badge";
import { Input } from "../../ui/Input";
import { Alert } from "../../ui/Alert";
import { Icon } from "../../ui/Icon";
import { Dialog } from "../../ui/Dialog";
import { useToast } from "../../ui/Toast";
import { clearAccessToken } from "../../lib/session";

/**
 * Role-Based Workspaces, Stage D — the personal half of Settings.
 *
 * Settings used to be one page holding both "my profile" and workspace
 * administration, shown to every role. Stage A gated the sidebar entry on
 * `settings:manage`, which was right for the workspace half and wrong for the
 * personal half: it took away every non-admin's access to their own profile
 * and digest preference. This page is the other side of that split, and it
 * carries **no permission gate at all** — it acts only on the signed-in
 * person's own account, so ownership is the authorization, the same reasoning
 * `account.deleteSelf` and `notifications.list` already use.
 *
 * Reached from the avatar menu rather than the sidebar, which is where people
 * look for their own settings and keeps the sidebar for the work itself.
 *
 * It also gives the account-deletion and data-export mutations from Go-Live
 * Phase 05 their first real UI — they shipped callable but unreachable, which
 * the Privacy Policy already described as being "in your account settings".
 */
export function AccountSettings() {
  const { manifest } = useBootstrap();
  const user = manifest.user;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader title="Account settings" description="Your profile, preferences and data. Only you can see this page." />
      <div className="mt-6 flex flex-col gap-5">
        <ProfileCard displayName={user.displayName} roles={user.roles} />
        <AppearanceCard />
        <NotificationsCard />
        <SecurityCard />
        <DataPrivacyCard email={(user as { email?: string }).email} />
      </div>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 py-2.5">
      <div className="min-w-0">
        <div className="text-sm text-text">{label}</div>
        {hint && <div className="mt-0.5 text-xs leading-relaxed text-text-muted">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function ProfileCard({ displayName, roles }: { displayName: string; roles: string[] }) {
  return (
    <Card>
      <CardHeader title="Profile" />
      <CardBody className="divide-y divide-border">
        <Row label="Name">
          <span className="text-sm font-medium text-text">{displayName}</span>
        </Row>
        <Row label="Role" hint="Set by your workspace administrator.">
          <div className="flex flex-wrap justify-end gap-1.5">
            {roles.map((r) => (
              <Badge key={r} tone="accent">
                {r}
              </Badge>
            ))}
          </div>
        </Row>
      </CardBody>
    </Card>
  );
}

function AppearanceCard() {
  const { theme, setTheme } = useTheme();
  return (
    <Card>
      <CardHeader title="Appearance" />
      <CardBody>
        <Row label="Dark mode" hint="Applies to this browser only.">
          <Switch checked={theme === "dark"} onChange={(e) => setTheme(e.target.checked ? "dark" : "light")} />
        </Row>
      </CardBody>
    </Card>
  );
}

function NotificationsCard() {
  const { manifest } = useBootstrap();
  const { callMutation, refetchBootstrap } = useRenderContext();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const optedOut = (manifest.user as { digestOptOut?: boolean }).digestOptOut ?? false;

  async function toggle(enabled: boolean) {
    setSaving(true);
    try {
      await callMutation("user.updateDigestPreference", { optOut: !enabled });
      refetchBootstrap();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't update your digest preference", "danger");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Notifications" />
      <CardBody>
        <Row label="Daily digest email" hint="A morning summary of what needs your attention.">
          <Switch checked={!optedOut} disabled={saving} onChange={(e) => toggle(e.target.checked)} />
        </Row>
      </CardBody>
    </Card>
  );
}

function SecurityCard() {
  return (
    <Card>
      <CardHeader title="Security" />
      <CardBody>
        <Row label="Password" hint="You'll be asked to sign in again after changing it.">
          <Link href="/change-password">
            <Button variant="secondary" size="sm">
              Change password
            </Button>
          </Link>
        </Row>
      </CardBody>
    </Card>
  );
}

/**
 * Go-Live Phase 05's data-subject controls, finally reachable. Both act only
 * on the signed-in person's own data.
 */
function DataPrivacyCard({ email }: { email?: string }) {
  const { callDataSource, callMutation } = useRenderContext();
  const router = useRouter();
  const toast = useToast();
  const [exporting, setExporting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typedEmail, setTypedEmail] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    setExporting(true);
    try {
      const data = await callDataSource("account.export", {});
      // Built entirely in the browser from data the server already returned —
      // no new endpoint, and the file never touches a server.
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `purnit-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.show("Your data has been downloaded", "success");
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't export your data", "danger");
    } finally {
      setExporting(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      await callMutation("account.deleteSelf", { confirmEmail: typedEmail.trim() });
      // The account is gone and the session is dead — clear it and leave.
      clearAccessToken();
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete your account");
      setDeleting(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader title="Data & privacy" />
        <CardBody className="divide-y divide-border">
          <Row label="Export my data" hint="A JSON file of your profile and the records you created.">
            <Button variant="secondary" size="sm" onClick={handleExport} disabled={exporting}>
              {exporting ? "Preparing…" : "Download"}
            </Button>
          </Row>
          <Row
            label="Delete my account"
            hint="Removes your access immediately. Your data is permanently erased after 30 days."
          >
            <Button variant="danger" size="sm" onClick={() => setConfirmOpen(true)}>
              Delete account
            </Button>
          </Row>
        </CardBody>
      </Card>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Delete your account">
        <div className="flex flex-col gap-4">
          <p className="text-sm leading-relaxed text-text-muted">
            This removes your access straight away and cannot be undone from your side. Your data is permanently erased after 30 days.
          </p>
          <label className="block">
            <span className="text-sm font-medium text-text">Type {email ?? "your email"} to confirm</span>
            <Input value={typedEmail} onChange={(e) => setTypedEmail(e.target.value)} className="mt-1.5" autoFocus />
          </label>
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDelete} disabled={deleting || !typedEmail.trim()}>
              {deleting ? "Deleting…" : "Delete my account"}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

/** Shown in the avatar menu. Kept here so the label and icon stay next to the
 * page they open. */
export const ACCOUNT_MENU_ITEM = { href: "/workspace/account", label: "Account settings", icon: "account_circle" } as const;

export function AccountMenuIcon() {
  return <Icon name={ACCOUNT_MENU_ITEM.icon} size={15} />;
}
