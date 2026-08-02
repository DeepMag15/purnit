import type {
  BlueprintDefinition,
  KeyedListPatch,
  TenantConfigOverrides,
  UINode,
} from "@antigravity/manifest-schema";

function findInsertionIndex<T extends { id: string }>(list: T[], after?: string, before?: string): number {
  if (after) {
    const idx = list.findIndex((i) => i.id === after);
    return idx === -1 ? list.length : idx + 1;
  }
  if (before) {
    const idx = list.findIndex((i) => i.id === before);
    return idx === -1 ? list.length : idx;
  }
  return list.length;
}

/**
 * Applies a stable-id add/remove/patch operation set to a list — the one
 * override mechanism reused for navigation and page children (ARCHITECTURE.md
 * §6.3). Never a deep merge: removed/patched/added items are addressed by id,
 * so upgrading a blueprint never silently reorders or clobbers a tenant's
 * customizations. Unknown `after`/`before` anchors fall back to appending at
 * the end rather than inserting at the wrong position.
 */
export function applyKeyedListPatch<T extends { id: string }>(base: T[], patch?: KeyedListPatch<T>): T[] {
  if (!patch) return base;

  let result = base.filter((item) => !patch.remove?.includes(item.id));

  if (patch.patch) {
    const patches = patch.patch;
    result = result.map((item) => (patches[item.id] ? { ...item, ...patches[item.id] } : item));
  }

  if (patch.add) {
    for (const { after, before, item } of patch.add) {
      const insertAt = findInsertionIndex(result, after, before);
      result.splice(insertAt, 0, item);
    }
  }

  return result;
}

/**
 * Layer 1 (blueprint) + Layer 2 (tenant config overrides) → resolved
 * blueprint, per ARCHITECTURE.md §6.4's `applyOverrides` step.
 */
export function applyOverrides(blueprint: BlueprintDefinition, overrides: TenantConfigOverrides): BlueprintDefinition {
  const navigation = applyKeyedListPatch(blueprint.navigation, overrides.navigation);

  const pages = { ...blueprint.pages };
  if (overrides.pages?.patch) {
    for (const [pageId, pagePatch] of Object.entries(overrides.pages.patch)) {
      const page = pages[pageId];
      if (!page) continue; // Unknown page id in a tenant override — skip rather than crash every load.
      const { children: childrenPatch, ...propPatch } = pagePatch;
      const patchedChildren: UINode[] | undefined = childrenPatch
        ? applyKeyedListPatch(page.children ?? [], childrenPatch)
        : page.children;
      pages[pageId] = { ...page, ...propPatch, children: patchedChildren };
    }
  }

  const roles = overrides.roles?.add ? [...blueprint.roles, ...overrides.roles.add] : blueprint.roles;

  return { ...blueprint, navigation, pages, roles };
}
