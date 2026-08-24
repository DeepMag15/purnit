import { z } from "zod";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "../../ui/Icon";
import { useRenderContext } from "../../sdui/render-context";
import { useDataSourceQuery } from "../../sdui/use-data-binding";
import { useBootstrap } from "../../app/workspace/bootstrap-context";
import { Card, CardHeader, CardBody } from "../../ui/Card";
import { Input } from "../../ui/Input";
import { Select } from "../../ui/Select";
import { Button } from "../../ui/Button";
import { Badge } from "../../ui/Badge";
import { Alert } from "../../ui/Alert";
import { Switch } from "../../ui/Switch";
import { useToast } from "../../ui/Toast";
import { supabase } from "../../lib/supabase-client";
import { formatCents } from "../invoices/money";

// Must match the bucket name in apps/api/src/auth/supabase-admin.service.ts
// exactly — the upload URL is signed against that bucket server-side, and
// the browser uploads directly to it using the anon client below.
const LOGO_BUCKET = "logos";
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_ACCEPT = "image/png,image/jpeg,image/webp,image/svg+xml";

// Kept exported (unused by this file itself) — register-all.ts's old
// catch-all registration for "WorkspaceSettings" still imports it, and is
// deliberately left registered, not removed, same precedent as every prior
// Phase 02/03 migration (see AnalyticsDashboardSchema).
export const WorkspaceSettingsSchema = z.object({});

interface SettingsCapabilities {
  canManageSettings: boolean;
  canManageBilling: boolean;
  canManageFeatureFlags: boolean;
  canManageSso: boolean;
}

// Role-Based Workspaces, Stage D — this page is now workspace ADMINISTRATION
// only, gated on `settings:manage`. "My profile" moved to /workspace/account,
// reached from the avatar menu and carrying no permission gate, because it
// acts solely on the signed-in person's own account.
//
// That split supersedes the earlier "Settings visible to all, actions
// controlled by permissions" arrangement: the reason Settings was shown to
// everyone was the personal card inside it, and once that has its own home
// there is nothing left here a non-admin needs. Within the remaining cards,
// edit controls are still presence-gated the same way as every other
// composite, since a Company Admin is not the only role that may hold some of
// these grants in a customised setup.
//
// Frontend Redesign Phase 04 — a dedicated route, replacing the generic
// `/workspace/page.settings` catch-all. `actions` (the old Renderer-supplied
// mutation-presence list) is gone; `settings.capabilities` (new, additive,
// read-only backend data source) replaces it. 6 of the old 9 flags collapsed
// to one `canManageSettings` (all share `requiredPermission: "settings:manage"`,
// confirmed directly per-mutation, not assumed from "same card" framing);
// billing/feature-flags/SSO each keep their own flag since each is a
// genuinely different real resource (`billing:manage`/`featureFlag:manage`/
// `sso:manage`) — same `canBrowseOrg`/`canBrowseProjects`-style split Phase
// 03 needed for Analytics.
export function WorkspaceSettings() {
  const { manifest } = useBootstrap();
  const { data: caps } = useDataSourceQuery<SettingsCapabilities>("settings.capabilities");
  const canManageSettings = caps?.canManageSettings ?? false;
  const canManageBilling = caps?.canManageBilling ?? false;
  const canManageFeatureFlags = caps?.canManageFeatureFlags ?? false;
  const canManageSso = caps?.canManageSso ?? false;
  const profile = manifest.tenant.profile as Record<string, unknown>;

  return (
    <div className="flex flex-col gap-4">
      {/* Role-Based Workspaces, Stage D — "My profile" moved out to
        * /workspace/account, reached from the avatar menu. This page is now
        * workspace administration only and is gated on `settings:manage`;
        * leaving a personal card here would have meant a non-admin losing
        * access to their own profile when that gate was added. */}
      <WorkspaceDetailsCard tenant={manifest.tenant} editable={canManageSettings} />
      <BrandingCard branding={manifest.tenant.branding as Record<string, unknown>} editable={canManageSettings} canUploadLogo={canManageSettings} />
      <CompanyInfoCard profile={profile} editable={canManageSettings} />
      <TimezoneCard profile={profile} editable={canManageSettings} />
      <BusinessHoursCard profile={profile} editable={canManageSettings} />
      {canManageBilling && <BillingCard />}
      {canManageFeatureFlags && <FeatureFlagsCard />}
      {canManageSettings && <AiProviderCard />}
      {canManageSso && <EnterpriseSsoCard />}

      {canManageSettings && (
        <Card>
          <CardHeader title="Navigation labels" />
          <CardBody className="flex flex-col divide-y divide-border">
            {manifest.navigation.map((item) => (
              <NavLabelRow key={item.id} itemId={item.id} initialLabel={item.label} />
            ))}
          </CardBody>
        </Card>
      )}
    </div>
  );
}

interface BillingCapabilities {
  currentPlan: { key: string; name: string } | null;
  subscriptionStatus: string | null;
  hasStripeCustomer: boolean;
  stripeConfigured: boolean;
  availablePlans: { key: string; name: string; priceCents: number | null; selfServe: boolean }[];
}

// Stripe Billing — whole-card presence gate (billing:manage, Admin-only), no
// partial-field editing the way most other Settings cards allow. Uses
// `useDataSourceQuery` (cached/deduped) rather than the ad hoc `useEffect`+
// `callDataSource` pattern `NotificationBell.tsx` still uses — that older
// pattern predates `useDataSourceQuery`'s own doc comment explicitly calling
// it out as superseded; nothing about being a plain Settings sub-component
// (not blueprint-bound) requires the older style.
function BillingCard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { callMutation } = useRenderContext();
  const toast = useToast();
  const [redirecting, setRedirecting] = useState<string | null>(null);

  const { data, isPending, refetch } = useDataSourceQuery<BillingCapabilities>("billing.capabilities");

  useEffect(() => {
    const billingResult = searchParams.get("billing");
    if (!billingResult) return;
    if (billingResult === "success") {
      toast.show("Subscription updated — this may take a few seconds to fully reflect.");
    } else if (billingResult === "cancelled") {
      toast.show("Checkout cancelled", "danger");
    }
    router.replace("/workspace/settings");
    refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once on mount to consume the one-time redirect query param, not on every searchParams identity change
  }, []);

  async function handleUpgrade(planKey: string) {
    setRedirecting(planKey);
    try {
      const result = (await callMutation("billing.createCheckoutSession", { planKey })) as { url: string };
      window.location.assign(result.url);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't start checkout", "danger");
      setRedirecting(null);
    }
  }

  async function handleManageBilling() {
    setRedirecting("portal");
    try {
      const result = (await callMutation("billing.createPortalSession", {})) as { url: string };
      window.location.assign(result.url);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't open billing portal", "danger");
      setRedirecting(null);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Billing & Plan"
        action={
          data?.hasStripeCustomer ? (
            <Button size="sm" variant="secondary" onClick={handleManageBilling} disabled={redirecting !== null}>
              {redirecting === "portal" ? "Opening…" : "Manage Billing"}
            </Button>
          ) : undefined
        }
      />
      <CardBody className="flex flex-col gap-4 text-sm">
        {isPending && <div className="text-text-muted">Loading…</div>}
        {!isPending && !data?.stripeConfigured && (
          <Alert tone="info">Stripe isn&apos;t configured in this environment yet — plan changes aren&apos;t available.</Alert>
        )}
        {!isPending && data && (
          <>
            <Row
              label="Current plan"
              value={
                <div className="flex items-center gap-2">
                  <Badge tone="accent">{data.currentPlan?.name ?? "None"}</Badge>
                  {data.subscriptionStatus && <span className="text-xs capitalize text-text-muted">{data.subscriptionStatus}</span>}
                </div>
              }
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {data.availablePlans.map((plan) => {
                const isCurrent = plan.key === data.currentPlan?.key;
                return (
                  <div key={plan.key} className="flex flex-col gap-2 rounded-lg border border-border p-3">
                    <div className="text-sm font-semibold text-text">{plan.name}</div>
                    <div className="text-lg font-semibold text-text">
                      {plan.priceCents === null ? "Contact us" : plan.priceCents === 0 ? "Free" : `${formatCents(plan.priceCents)}/mo`}
                    </div>
                    {isCurrent ? (
                      <Badge>Current plan</Badge>
                    ) : plan.selfServe && data.stripeConfigured ? (
                      <Button size="sm" onClick={() => handleUpgrade(plan.key)} disabled={redirecting !== null}>
                        {redirecting === plan.key ? "Redirecting…" : "Upgrade"}
                      </Button>
                    ) : !plan.selfServe ? (
                      <a href="mailto:sales@example.com" className="text-xs font-medium text-accent hover:underline">
                        Contact sales
                      </a>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}

interface FeatureFlagRow {
  id: string;
  key: string;
  enabled: boolean;
  createdAt: string;
}

// Feature Flags (module 3 of the 4-initiative backlog) — same whole-card
// presence gate as BillingCard above (featureFlag:manage, Admin-only).
// `featureFlags.list` is the admin-facing view (row metadata included);
// separate from the manifest's own `featureFlags` map every authenticated
// user already gets unconditionally for components that check a key
// directly — see feature-flags.data-sources.ts's own doc comment.
function FeatureFlagsCard() {
  const { callMutation } = useRenderContext();
  const toast = useToast();
  const { data, isPending, refetch } = useDataSourceQuery<FeatureFlagRow[]>("featureFlags.list");
  const flags = Array.isArray(data) ? data : [];

  const [newKey, setNewKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleToggle(key: string, enabled: boolean) {
    try {
      await callMutation("featureFlag.set", { key, enabled });
      refetch();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't update flag", "danger");
    }
  }

  async function handleAdd() {
    const key = newKey.trim();
    if (!key) return;
    setSaving(true);
    setError(null);
    try {
      await callMutation("featureFlag.set", { key, enabled: true });
      toast.show(`Flag "${key}" created`);
      setNewKey("");
      refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create flag");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Feature Flags" />
      <CardBody className="flex flex-col gap-3 text-sm">
        <p className="text-xs text-text-muted">
          Per-tenant overrides layered on top of your plan. A key matching a module (e.g. &quot;leave&quot;, &quot;crm&quot;) hides or
          force-shows that module regardless of plan; any other key is just exposed to components that check it directly.
        </p>
        {isPending && <div className="text-text-muted">Loading…</div>}
        {!isPending && flags.length === 0 && <div className="text-text-muted">No flags set yet.</div>}
        {!isPending && flags.length > 0 && (
          <div className="flex flex-col divide-y divide-border">
            {flags.map((flag) => (
              <div key={flag.id} className="flex items-center justify-between py-2">
                <span className="font-mono text-xs text-text">{flag.key}</span>
                <Switch checked={flag.enabled} onChange={(e) => handleToggle(flag.key, e.target.checked)} />
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2 border-t border-border pt-3">
          <Input label="New flag key" placeholder="e.g. leave" value={newKey} onChange={(e) => setNewKey(e.target.value)} className="flex-1" />
          <Button size="sm" onClick={handleAdd} disabled={saving || !newKey.trim()}>
            {saving ? "Adding…" : "Add"}
          </Button>
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
      </CardBody>
    </Card>
  );
}

interface AiProviderSettings {
  currentOverride: "anthropic" | "gemini" | "openai" | null;
  globalDefault: string;
  configuredProviders: string[];
}

const AI_PROVIDER_LABELS: Record<string, string> = { anthropic: "Anthropic", gemini: "Gemini", openai: "OpenAI" };

// AI Assistant Phase F — a tenant's own AI completion-provider override, on
// top of the workspace-wide AI_COMPLETION_PROVIDER default. Same
// whole-card presence gate as BillingCard/FeatureFlagsCard (settings:manage,
// Admin-only).
function AiProviderCard() {
  const { callMutation } = useRenderContext();
  const toast = useToast();
  const { data, isPending, refetch } = useDataSourceQuery<AiProviderSettings>("ai.providerSettings");
  const [saving, setSaving] = useState(false);

  async function handleChange(value: string) {
    setSaving(true);
    try {
      await callMutation("workspaceConfig.updateAiProvider", { provider: value === "default" ? null : value });
      toast.show("AI provider updated");
      refetch();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't update AI provider", "danger");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader title="AI Provider" />
      <CardBody className="flex flex-col gap-3 text-sm">
        <p className="text-xs text-text-muted">
          Overrides which AI provider your workspace&apos;s assistant uses, on top of the platform-wide default. A provider greyed out
          below has no API key configured in this environment.
        </p>
        {isPending && <div className="text-text-muted">Loading…</div>}
        {!isPending && data && (
          <Select
            aria-label="AI provider"
            value={data.currentOverride ?? "default"}
            onChange={(e) => handleChange(e.target.value)}
            disabled={saving}
            className="max-w-xs"
          >
            <option value="default">Workspace default ({AI_PROVIDER_LABELS[data.globalDefault] ?? data.globalDefault})</option>
            {(["anthropic", "gemini", "openai"] as const).map((provider) => (
              <option key={provider} value={provider} disabled={!data.configuredProviders.includes(provider)}>
                {AI_PROVIDER_LABELS[provider]}
                {!data.configuredProviders.includes(provider) ? " (not configured)" : ""}
              </option>
            ))}
          </Select>
        )}
      </CardBody>
    </Card>
  );
}

interface SsoConfigView {
  enabled: boolean;
  idpAlias: string | null;
  displayName: string | null;
  defaultRoleId: string | null;
  requireEmailVerified: boolean;
}

// Enterprise SSO (SSO/SAML initiative) — same whole-card presence gate as
// BillingCard/FeatureFlagsCard above (sso:manage, Admin-only). `idpAlias` is
// system-generated server-side (sso.configure) and shown read-only here,
// never an editable field — see sso.prisma's own doc comment on why an
// admin-typed alias would be a real cross-tenant confusion risk in a shared
// Keycloak realm. The admin's own manual step is creating an Identity
// Provider in Keycloak's Admin Console using this exact alias.
function EnterpriseSsoCard() {
  const { callMutation } = useRenderContext();
  const toast = useToast();
  const { data, isPending, refetch } = useDataSourceQuery<SsoConfigView>("sso.get");
  const { data: rolesData } = useDataSourceQuery<{ id: string; label: string }[]>("roles.list");
  const roles = Array.isArray(rolesData) ? rolesData : [];

  const [enabled, setEnabled] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [defaultRoleId, setDefaultRoleId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setEnabled(data.enabled);
    setDisplayName(data.displayName ?? "");
    setDefaultRoleId(data.defaultRoleId ?? "");
  }, [data]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await callMutation("sso.configure", {
        enabled,
        displayName: displayName.trim() || undefined,
        defaultRoleId: defaultRoleId || undefined,
      });
      toast.show("Enterprise SSO settings saved");
      refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save Enterprise SSO settings");
    } finally {
      setSaving(false);
    }
  }

  async function handleCopyAlias() {
    if (!data?.idpAlias) return;
    await navigator.clipboard.writeText(data.idpAlias);
    toast.show("Copied");
  }

  return (
    <Card>
      <CardHeader title="Enterprise SSO" />
      <CardBody className="flex flex-col gap-3 text-sm">
        <p className="text-xs text-text-muted">
          Brokered through a self-hosted Keycloak realm. Once saved, create an Identity Provider in Keycloak using the alias below, pointed at
          your own SAML or OIDC identity provider.
        </p>
        {isPending && <div className="text-text-muted">Loading…</div>}
        {!isPending && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-text">Enabled</span>
              <Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            </div>
            {data?.idpAlias && (
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                <div>
                  <div className="text-xs text-text-muted">Keycloak Identity Provider alias</div>
                  <code className="font-mono text-xs text-text">{data.idpAlias}</code>
                </div>
                <Button size="sm" variant="secondary" onClick={handleCopyAlias}>
                  Copy
                </Button>
              </div>
            )}
            <Input label="Display name" placeholder="e.g. Okta" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-muted">Default role for new SSO sign-ins</label>
              <Select value={defaultRoleId} onChange={(e) => setDefaultRoleId(e.target.value)}>
                <option value="">Select a role…</option>
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.label}
                  </option>
                ))}
              </Select>
            </div>
            {enabled && !defaultRoleId && (
              <Alert tone="danger">A default role is required while Enterprise SSO is enabled — sign-ins will be rejected until one is set.</Alert>
            )}
            {error && <Alert tone="danger">{error}</Alert>}
            <Button size="sm" onClick={handleSave} disabled={saving} className="self-start">
              {saving ? "Saving…" : "Save"}
            </Button>
          </>
        )}
      </CardBody>
    </Card>
  );
}

function WorkspaceDetailsCard({ tenant, editable }: { tenant: { name: string; industry: string; workspaceId: string | null }; editable: boolean }) {
  const { callMutation, refetchBootstrap } = useRenderContext();
  const toast = useToast();
  const [workspaceId, setWorkspaceId] = useState(tenant.workspaceId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!workspaceId.trim() || workspaceId.trim() === tenant.workspaceId) return;
    setSaving(true);
    setError(null);
    try {
      // The backend slugifies whatever was typed (e.g. "Magar Limited" ->
      // "magar-limited") rather than rejecting anything that isn't already
      // kebab-case — sync the field to what was *actually* saved, not the
      // raw text typed, so it doesn't look unsaved/wrong afterward.
      const result = (await callMutation("tenant.updateWorkspaceId", { workspaceId: workspaceId.trim() })) as { workspaceId: string };
      setWorkspaceId(result.workspaceId);
      toast.show(`Workspace ID updated to "${result.workspaceId}"`);
      refetchBootstrap();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update workspace ID");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Workspace details" />
      <CardBody className="flex flex-col gap-2 text-sm">
        <Row label="Name" value={tenant.name} />
        <Row label="Industry" value={tenant.industry} />
        <Row
          label="Workspace ID"
          value={
            editable ? (
              <div className="flex items-center gap-2">
                <Input value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} className="w-48 font-mono" />
                <Button variant="secondary" size="sm" onClick={handleSave} disabled={saving || !workspaceId.trim() || workspaceId.trim() === tenant.workspaceId}>
                  <Icon name="save" size={13} />
                  Save
                </Button>
              </div>
            ) : (
              <code className="font-mono text-text">{tenant.workspaceId ?? "—"}</code>
            )
          }
        />
        {error && <Alert tone="danger">{error}</Alert>}
        {!editable && <p className="text-xs text-text-muted">Used to log in — entered alongside your email and password.</p>}
      </CardBody>
    </Card>
  );
}

function BrandingCard({
  branding,
  editable,
  canUploadLogo,
}: {
  branding: Record<string, unknown>;
  editable: boolean;
  canUploadLogo: boolean;
}) {
  const { callMutation, refetchBootstrap } = useRenderContext();
  const toast = useToast();
  const currentAccent = typeof branding.accentColor === "string" ? branding.accentColor : "#4f46e5";
  const currentLogoUrl = typeof branding.logoUrl === "string" ? branding.logoUrl : undefined;
  const [accentColor, setAccentColor] = useState(currentAccent);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await callMutation("tenant.updateBranding", { accentColor });
      toast.show("Branding updated");
      refetchBootstrap();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update branding");
    } finally {
      setSaving(false);
    }
  }

  async function handleLogoSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file next time
    if (!file) return;
    if (file.size > LOGO_MAX_BYTES) {
      setError("Logo must be under 2MB");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const ext = file.name.split(".").pop() ?? "";
      const { path, token, publicUrl } = (await callMutation("tenant.createLogoUploadUrl", { fileExt: ext })) as {
        path: string;
        token: string;
        publicUrl: string;
      };
      const { error: uploadError } = await supabase.storage.from(LOGO_BUCKET).uploadToSignedUrl(path, token, file);
      if (uploadError) throw new Error(uploadError.message);
      // Reuses the existing accentColor-persistence path — logoUrl rides
      // alongside it in the same branding JSON bag.
      await callMutation("tenant.updateBranding", { accentColor, logoUrl: publicUrl });
      toast.show("Logo updated");
      refetchBootstrap();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't upload logo");
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Branding" />
      <CardBody className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          {currentLogoUrl ? (
            <img src={currentLogoUrl} alt="Workspace logo" className="h-12 w-12 rounded-md border border-border object-contain" />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-md border border-border text-text-muted">
              <Icon name="apartment" size={20} />
            </div>
          )}
          {canUploadLogo && (
            <>
              <Button variant="secondary" size="sm" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                <Icon name="upload" size={13} />
                {uploading ? "Uploading…" : "Upload logo"}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept={LOGO_ACCEPT}
                onChange={handleLogoSelected}
                className="hidden"
                disabled={uploading}
              />
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          {editable ? (
            <>
              <input
                type="color"
                value={accentColor}
                onChange={(e) => setAccentColor(e.target.value)}
                className="h-9 w-14 cursor-pointer rounded-md border border-border bg-surface"
                aria-label="Accent color"
              />
              <Input value={accentColor} onChange={(e) => setAccentColor(e.target.value)} className="w-32 font-mono" />
              <Button onClick={handleSave} disabled={saving}>
                <Icon name="save" size={14} />
                {saving ? "Saving…" : "Save"}
              </Button>
            </>
          ) : (
            <>
              <div className="h-9 w-9 rounded-md border border-border" style={{ backgroundColor: currentAccent }} />
              <code className="font-mono text-sm text-text">{currentAccent}</code>
            </>
          )}
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
      </CardBody>
    </Card>
  );
}

function profileString(profile: Record<string, unknown>, key: string): string {
  return typeof profile[key] === "string" ? (profile[key] as string) : "";
}

function CompanyInfoCard({ profile, editable }: { profile: Record<string, unknown>; editable: boolean }) {
  const { callMutation, refetchBootstrap } = useRenderContext();
  const toast = useToast();
  const initial = {
    description: profileString(profile, "description"),
    website: profileString(profile, "website"),
    contactEmail: profileString(profile, "contactEmail"),
    address: profileString(profile, "address"),
  };
  const [fields, setFields] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unchanged = Object.entries(fields).every(([key, value]) => value === initial[key as keyof typeof initial]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await callMutation("tenant.updateProfile", fields);
      toast.show("Company information updated");
      refetchBootstrap();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update company information");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Company information" />
      <CardBody className="flex flex-col gap-3 text-sm">
        {editable ? (
          <>
            <LabeledField label="Description">
              <Input value={fields.description} onChange={(e) => setFields({ ...fields, description: e.target.value })} />
            </LabeledField>
            <LabeledField label="Website">
              <Input
                value={fields.website}
                onChange={(e) => setFields({ ...fields, website: e.target.value })}
                placeholder="https://example.com"
              />
            </LabeledField>
            <LabeledField label="Contact email">
              <Input value={fields.contactEmail} onChange={(e) => setFields({ ...fields, contactEmail: e.target.value })} />
            </LabeledField>
            <LabeledField label="Address">
              <Input value={fields.address} onChange={(e) => setFields({ ...fields, address: e.target.value })} />
            </LabeledField>
            <div>
              <Button onClick={handleSave} disabled={saving || unchanged}>
                <Icon name="save" size={14} />
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </>
        ) : (
          <>
            <Row label="Description" value={initial.description || "—"} />
            <Row label="Website" value={initial.website || "—"} />
            <Row label="Contact email" value={initial.contactEmail || "—"} />
            <Row label="Address" value={initial.address || "—"} />
          </>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
      </CardBody>
    </Card>
  );
}

const TIMEZONES = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];

function TimezoneCard({ profile, editable }: { profile: Record<string, unknown>; editable: boolean }) {
  const { callMutation, refetchBootstrap } = useRenderContext();
  const toast = useToast();
  const initial = profileString(profile, "timezone");
  const [timezone, setTimezone] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await callMutation("tenant.updateProfile", { timezone });
      toast.show("Timezone updated");
      refetchBootstrap();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update timezone");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Timezone" />
      <CardBody className="flex flex-col gap-3 text-sm">
        {editable ? (
          <div className="flex items-center gap-2">
            <Select value={timezone} onChange={(e) => setTimezone(e.target.value)} className="w-64">
              <option value="">Select a timezone…</option>
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </Select>
            <Button variant="secondary" size="sm" onClick={handleSave} disabled={saving || timezone === initial}>
              <Icon name="save" size={13} />
              Save
            </Button>
          </div>
        ) : (
          <Row label="Timezone" value={initial || "—"} />
        )}
        {error && <Alert tone="danger">{error}</Alert>}
      </CardBody>
    </Card>
  );
}

interface DayHours {
  closed: boolean;
  open: string;
  close: string;
}

const DEFAULT_OPEN_DAY: DayHours = { closed: false, open: "09:00", close: "17:00" };

const WEEKDAYS: Array<{ key: string; label: string }> = [
  { key: "monday", label: "Monday" },
  { key: "tuesday", label: "Tuesday" },
  { key: "wednesday", label: "Wednesday" },
  { key: "thursday", label: "Thursday" },
  { key: "friday", label: "Friday" },
  { key: "saturday", label: "Saturday" },
  { key: "sunday", label: "Sunday" },
];

function readDay(businessHours: Record<string, unknown>, key: string): DayHours {
  const raw = businessHours[key] as Partial<DayHours> | undefined;
  if (!raw) return { ...DEFAULT_OPEN_DAY, closed: true };
  return {
    closed: raw.closed === true,
    open: typeof raw.open === "string" ? raw.open : DEFAULT_OPEN_DAY.open,
    close: typeof raw.close === "string" ? raw.close : DEFAULT_OPEN_DAY.close,
  };
}

function BusinessHoursCard({ profile, editable }: { profile: Record<string, unknown>; editable: boolean }) {
  const { callMutation, refetchBootstrap } = useRenderContext();
  const toast = useToast();
  const businessHours = (profile.businessHours as Record<string, unknown>) ?? {};
  const [hours, setHours] = useState<Record<string, DayHours>>(() =>
    Object.fromEntries(WEEKDAYS.map((d) => [d.key, readDay(businessHours, d.key)])),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateDay(key: string, patch: Partial<DayHours>) {
    setHours((current) => ({ ...current, [key]: { ...current[key]!, ...patch } }));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await callMutation("tenant.updateProfile", { businessHours: hours });
      toast.show("Business hours updated");
      refetchBootstrap();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update business hours");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Business hours" />
      <CardBody className="flex flex-col gap-2 text-sm">
        {WEEKDAYS.map(({ key, label }) => {
          const day = hours[key]!;
          return (
            <div key={key} className="flex items-center gap-3">
              <span className="w-24 shrink-0 text-text-muted">{label}</span>
              {editable ? (
                <>
                  <label className="flex items-center gap-1.5 text-xs text-text-muted">
                    <input type="checkbox" checked={day.closed} onChange={(e) => updateDay(key, { closed: e.target.checked })} />
                    Closed
                  </label>
                  {!day.closed && (
                    <>
                      <input
                        type="time"
                        value={day.open}
                        onChange={(e) => updateDay(key, { open: e.target.value })}
                        className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-text"
                      />
                      <span className="text-text-muted">–</span>
                      <input
                        type="time"
                        value={day.close}
                        onChange={(e) => updateDay(key, { close: e.target.value })}
                        className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-text"
                      />
                    </>
                  )}
                </>
              ) : (
                <span className="text-text">{day.closed ? "Closed" : `${day.open} – ${day.close}`}</span>
              )}
            </div>
          );
        })}
        {editable && (
          <div className="mt-1">
            <Button onClick={handleSave} disabled={saving}>
              <Icon name="save" size={14} />
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
      </CardBody>
    </Card>
  );
}

function LabeledField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-text-muted">{label}</span>
      {children}
    </label>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-text-muted">{label}</span>
      <span className="text-text">{value}</span>
    </div>
  );
}

function NavLabelRow({ itemId, initialLabel }: { itemId: string; initialLabel: string }) {
  const { callMutation, refetchBootstrap } = useRenderContext();
  const toast = useToast();
  const [label, setLabel] = useState(initialLabel);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!label.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await callMutation("workspaceConfig.updateNavigationLabel", { itemId, label: label.trim() });
      toast.show(`"${label.trim()}" saved`);
      refetchBootstrap();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save label");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-2 py-2.5">
      <Input value={label} onChange={(e) => setLabel(e.target.value)} className="flex-1" />
      <Button variant="secondary" size="sm" onClick={handleSave} disabled={saving || !label.trim() || label.trim() === initialLabel}>
        <Icon name="save" size={13} />
        Save
      </Button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
