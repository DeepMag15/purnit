import { z } from "zod";
import { useRef, useState, type ChangeEvent } from "react";
import { Icon } from "../../ui/Icon";
import type { CommonRenderProps } from "../../sdui/registry";
import { useRenderContext } from "../../sdui/render-context";
import { useBootstrap } from "../../app/workspace/bootstrap-context";
import { Card, CardHeader, CardBody } from "../../ui/Card";
import { Input } from "../../ui/Input";
import { Select } from "../../ui/Select";
import { Button } from "../../ui/Button";
import { Badge } from "../../ui/Badge";
import { Alert } from "../../ui/Alert";
import { useToast } from "../../ui/Toast";
import { supabase } from "../../lib/supabase-client";

// Must match the bucket name in apps/api/src/auth/supabase-admin.service.ts
// exactly — the upload URL is signed against that bucket server-side, and
// the browser uploads directly to it using the anon client below.
const LOGO_BUCKET = "logos";
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_ACCEPT = "image/png,image/jpeg,image/webp,image/svg+xml";

export const WorkspaceSettingsSchema = z.object({});
type Props = z.infer<typeof WorkspaceSettingsSchema>;

// "Workspace details," "Branding" (read-only half), and "My profile" are
// unconditionally rendered — visible to every authenticated tenant member,
// per the user's explicit "Settings should be visible to all, actions
// controlled by permissions" request. Only the *edit* controls inside each
// section are presence-gated, same mechanism as every prior composite.
export function WorkspaceSettings({ actions }: Props & CommonRenderProps) {
  const { manifest } = useBootstrap();

  const canUpdateBranding = actions?.some((a) => a.kind === "mutation" && a.mutation === "tenant.updateBranding") ?? false;
  const canUpdateWorkspaceId = actions?.some((a) => a.kind === "mutation" && a.mutation === "tenant.updateWorkspaceId") ?? false;
  const canUpdateNavLabel = actions?.some((a) => a.kind === "mutation" && a.mutation === "workspaceConfig.updateNavigationLabel") ?? false;
  const canUpdateProfile = actions?.some((a) => a.kind === "mutation" && a.mutation === "tenant.updateProfile") ?? false;
  const canUploadLogo = actions?.some((a) => a.kind === "mutation" && a.mutation === "tenant.createLogoUploadUrl") ?? false;
  const profile = manifest.tenant.profile as Record<string, unknown>;

  return (
    <div className="flex flex-col gap-4">
      <MyProfileCard user={manifest.user} />
      <WorkspaceDetailsCard tenant={manifest.tenant} editable={canUpdateWorkspaceId} />
      <BrandingCard branding={manifest.tenant.branding as Record<string, unknown>} editable={canUpdateBranding} canUploadLogo={canUploadLogo} />
      <CompanyInfoCard profile={profile} editable={canUpdateProfile} />
      <TimezoneCard profile={profile} editable={canUpdateProfile} />
      <BusinessHoursCard profile={profile} editable={canUpdateProfile} />

      {canUpdateNavLabel && (
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

function MyProfileCard({ user }: { user: { displayName: string; roles: string[] } & Record<string, unknown> }) {
  return (
    <Card>
      <CardHeader title="My profile" />
      <CardBody className="flex flex-col gap-2 text-sm">
        <Row label="Name" value={user.displayName} />
        <Row
          label="Role"
          value={
            <div className="flex gap-1.5">
              {user.roles.map((r) => (
                <Badge key={r} tone="accent">
                  {r}
                </Badge>
              ))}
            </div>
          }
        />
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
