import { BadRequestException } from "@nestjs/common";
import { buildLogoUploadPath, mergeAiProviderOverride, mergeNavigationLabelPatch, mergeTenantProfile } from "./settings.mutations";

describe("mergeNavigationLabelPatch", () => {
  it("creates a fresh patch when there are no existing overrides", () => {
    const result = mergeNavigationLabelPatch({}, "nav.projects", "Engineering Projects");
    expect(result).toEqual({ navigation: { patch: { "nav.projects": { label: "Engineering Projects" } } } });
  });

  it("preserves an unrelated item's existing patch", () => {
    const existing = { navigation: { patch: { "nav.tasks": { label: "Work Items" } } } };
    const result = mergeNavigationLabelPatch(existing, "nav.projects", "Engineering Projects");
    expect(result.navigation?.patch).toEqual({
      "nav.tasks": { label: "Work Items" },
      "nav.projects": { label: "Engineering Projects" },
    });
  });

  it("overwrites the label for the same item without touching other patched fields on it", () => {
    const existing = { navigation: { patch: { "nav.projects": { label: "Old Label", icon: "star" } } } };
    const result = mergeNavigationLabelPatch(existing, "nav.projects", "New Label");
    expect(result.navigation?.patch?.["nav.projects"]).toEqual({ label: "New Label", icon: "star" });
  });

  it("preserves existing remove/add entries and other override sections untouched", () => {
    const existing = {
      navigation: { remove: ["nav.old"], add: [{ item: { id: "nav.new", label: "New", pageId: "page.new" } }] },
      pages: { patch: { "page.dashboard": {} } },
    };
    const result = mergeNavigationLabelPatch(existing, "nav.projects", "Renamed");
    expect(result.navigation?.remove).toEqual(["nav.old"]);
    expect(result.navigation?.add).toEqual(existing.navigation.add);
    expect(result.pages).toEqual(existing.pages);
  });
});

describe("mergeAiProviderOverride", () => {
  it("sets a provider from an empty overrides object", () => {
    expect(mergeAiProviderOverride({}, "openai")).toEqual({ ai: { provider: "openai" } });
  });

  it("overwrites an existing provider choice", () => {
    const existing = { ai: { provider: "anthropic" as const } };
    expect(mergeAiProviderOverride(existing, "gemini")).toEqual({ ai: { provider: "gemini" } });
  });

  it("clears the override back to the global default when provider is null", () => {
    const existing = { ai: { provider: "openai" as const } };
    expect(mergeAiProviderOverride(existing, null)).toEqual({});
  });

  it("preserves every other overrides key untouched", () => {
    const existing = { navigation: { patch: { "nav.tasks": { label: "Work Items" } } } };
    const result = mergeAiProviderOverride(existing, "gemini");
    expect(result.navigation).toEqual(existing.navigation);
    expect(result.ai).toEqual({ provider: "gemini" });
  });
});

describe("mergeTenantProfile", () => {
  it("returns just the patch when there's no existing profile", () => {
    expect(mergeTenantProfile({}, { description: "We build things" })).toEqual({ description: "We build things" });
  });

  it("preserves an unrelated existing field when patching a different one", () => {
    const current = { description: "We build things", website: "https://example.com" };
    const result = mergeTenantProfile(current, { website: "https://new-site.com" });
    expect(result).toEqual({ description: "We build things", website: "https://new-site.com" });
  });

  it("overwrites a field without disturbing siblings", () => {
    const current = { description: "Old", contactEmail: "hi@example.com" };
    const result = mergeTenantProfile(current, { description: "New" });
    expect(result).toEqual({ description: "New", contactEmail: "hi@example.com" });
  });

  it("replaces businessHours wholesale, not per-day — a card always submits the full week", () => {
    const current = {
      businessHours: { monday: { closed: false, open: "09:00", close: "17:00" }, tuesday: { closed: true } },
    };
    const patch = { businessHours: { monday: { closed: true } } };
    const result = mergeTenantProfile(current, patch);
    // The whole `businessHours` object is replaced — `tuesday` from the old
    // value does NOT survive, confirming this is a shallow top-level merge,
    // not a deep merge into nested objects.
    expect(result.businessHours).toEqual({ monday: { closed: true } });
  });
});

describe("buildLogoUploadPath", () => {
  it("builds a tenantId/uuid.ext path", () => {
    const path = buildLogoUploadPath("11111111-1111-1111-1111-111111111111", "png");
    expect(path).toMatch(/^11111111-1111-1111-1111-111111111111\/[0-9a-f-]{36}\.png$/);
  });

  it("lowercases and strips a leading dot from the extension", () => {
    const path = buildLogoUploadPath("tenant-1", ".PNG");
    expect(path).toMatch(/^tenant-1\/[0-9a-f-]{36}\.png$/);
  });

  it("rejects an extension outside the allowlist", () => {
    expect(() => buildLogoUploadPath("tenant-1", "exe")).toThrow(BadRequestException);
    expect(() => buildLogoUploadPath("tenant-1", "pdf")).toThrow(BadRequestException);
  });

  it("accepts every allowlisted extension", () => {
    for (const ext of ["png", "jpg", "jpeg", "webp", "svg"]) {
      expect(() => buildLogoUploadPath("tenant-1", ext)).not.toThrow();
    }
  });
});
