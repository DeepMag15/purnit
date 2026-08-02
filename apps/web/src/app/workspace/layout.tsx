"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import type { WorkspaceManifest } from "@antigravity/manifest-schema";
import { getAccessToken, clearAccessToken } from "../../lib/session";
import { getWorkspaceBootstrap, getWorkspacePage, ApiError, callDataSource, callMutation, clearManifestCache } from "../../lib/api-client";
import { RenderContextProvider } from "../../sdui/render-context";
import { collectSourceBindings, dataSourceQueryKey, resolveBindExpr } from "../../sdui/use-data-binding";
import { BootstrapContextProvider } from "./bootstrap-context";
import { registerAllComponents } from "../../sdui/register-all";
import { NotificationBell } from "../../modules/notifications/NotificationBell";
import { AiPanel } from "../../modules/ai/AiPanel";
import { Icon } from "../../ui/Icon";
import { Dropdown, DropdownItem } from "../../ui/Dropdown";
import { CommandPalette, type CommandItem } from "../../ui/CommandPalette";
import { Skeleton } from "../../ui/Skeleton";
import { Alert } from "../../ui/Alert";
import { cn } from "../../ui/utils";
import { WorkspaceSidebar, hrefForNavItem } from "../../ui/WorkspaceSidebar";
import { flattenNavItems } from "../../ui/nav-tree";

// Persisted across navigation/reload — same reasoning as lib/session.ts's
// access-token storage (a plain UI preference, not sensitive, doesn't need
// the tenant-config override mechanism).
const SIDEBAR_COLLAPSED_KEY = "antigravity.sidebarCollapsed";

registerAllComponents();

const hrefFor = hrefForNavItem;

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { theme, setTheme } = useTheme();
  const [manifest, setManifest] = useState<WorkspaceManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiPanelPreset, setAiPanelPreset] = useState<string | undefined>();
  const [aiPanelContext, setAiPanelContext] = useState<unknown>();

  // Performance pass 2 (CONTEXT.md §48): hover-intent prefetch. `next/link`
  // (WorkspaceSidebar) already prefetches the target route's JS bundle; this
  // covers what it can't — the page's own tree and its bound primitives'
  // data — so by the time a click lands, both are already warm in cache.
  // Only finds *blueprint-bound* primitives (`collectSourceBindings`); a
  // composite's own internal reference-data fetches aren't statically
  // knowable from the tree alone, a disclosed limitation, not a bug.
  const prefetchPage = useCallback(
    (pageId: string) => {
      if (!manifest) return;
      getWorkspacePage(pageId)
        .then((page) => {
          const context = { user: manifest.user, tenant: manifest.tenant, filters: {} };
          for (const { source, params: rawParams } of collectSourceBindings(page)) {
            const params = Object.fromEntries(Object.entries(rawParams).map(([key, expr]) => [key, resolveBindExpr(expr, context)]));
            queryClient.prefetchQuery({
              queryKey: dataSourceQueryKey(source, params, manifest.tenant.id, manifest.user.id),
              queryFn: () => callDataSource(source, params),
            });
          }
        })
        .catch(() => {
          // Best-effort — a failed prefetch just means the real navigation
          // fetches normally, same as if nothing had prefetched at all.
        });
    },
    [manifest, queryClient],
  );

  useEffect(() => {
    if (localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true") setCollapsed(true);
  }, []);

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      return next;
    });
  }

  const loadBootstrap = useCallback(() => {
    getWorkspaceBootstrap()
      .then(setManifest)
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) {
          clearAccessToken();
          clearManifestCache();
          router.replace("/login");
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to load workspace");
      });
  }, [router]);

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace("/login");
      return;
    }
    loadBootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadBootstrap is stable in intent (only reads router/getAccessToken); re-running on every render would defeat the point of a manual refetchBootstrap
  }, [router]);

  const commandItems: CommandItem[] = useMemo(() => {
    if (!manifest) return [];
    // Flattened so nested leaves (e.g. under "HR"/"Workspace Administration")
    // are reachable via Cmd/Ctrl+K too; pure disclosure groups (no pageId)
    // aren't navigable, so they're filtered out rather than palette rows.
    return flattenNavItems(manifest.navigation)
      .filter((item) => item.pageId !== undefined)
      .map((item) => ({
        id: item.id,
        label: item.label,
        icon: item.icon,
        onSelect: () => router.push(hrefFor(manifest, item.pageId)!),
      }));
  }, [manifest, router]);

  // Performance pass 2 (CONTEXT.md §48): both context values used to be
  // fresh object literals constructed inline in JSX on every render of this
  // layout (sidebar collapse toggle, command palette open/close, ...) — every
  // consumer of useRenderContext()/useBootstrap() anywhere in the rendered
  // tree re-rendered as a result, even though the underlying values (stable
  // module-level callDataSource/callMutation) never actually changed. Memoized
  // here, unconditionally (before the early returns below), per the Rules of
  // Hooks — `commandItems` above already establishes this same pattern.
  const navigate = useCallback(
    (pageId: string) => {
      if (manifest) router.push(hrefFor(manifest, pageId)!);
    },
    [router, manifest],
  );
  const openAiPanel = useCallback((preset?: string, context?: unknown) => {
    setAiPanelPreset(preset);
    setAiPanelContext(context);
    setAiPanelOpen(true);
  }, []);
  const renderContextValue = useMemo(() => {
    if (!manifest) return null;
    return {
      user: manifest.user,
      tenant: manifest.tenant,
      callDataSource,
      callMutation,
      navigate,
      refetchBootstrap: loadBootstrap,
      openAiPanel,
      aiAvailable: manifest.aiAvailable,
    };
  }, [manifest, navigate, loadBootstrap, openAiPanel]);
  const bootstrapContextValue = useMemo(() => (manifest ? { manifest } : null), [manifest]);

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg p-8">
        <div className="w-full max-w-sm">
          <Alert tone="danger">Couldn&apos;t load your workspace: {error}</Alert>
        </div>
      </main>
    );
  }

  if (!manifest) {
    return (
      <main className="flex min-h-screen bg-bg">
        <div className="hidden w-sidebar-width shrink-0 border-r border-border p-4 md:block">
          <Skeleton className="mb-6 h-6 w-32" />
          <div className="flex flex-col gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        </div>
        <div className="flex-1 p-8">
          <Skeleton className="mb-4 h-8 w-48" />
          <Skeleton className="h-64 w-full" />
        </div>
      </main>
    );
  }

  const branding = manifest.tenant.branding as Record<string, unknown>;
  const accentOverride = typeof branding.accentColor === "string" ? branding.accentColor : undefined;
  const logoUrl = typeof branding.logoUrl === "string" ? branding.logoUrl : undefined;
  const initials = manifest.user.displayName
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const tenantInitials = manifest.tenant.name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  function handleLogout() {
    clearAccessToken();
    clearManifestCache();
    router.replace("/login");
  }

  return (
    <BootstrapContextProvider value={bootstrapContextValue!}>
      <RenderContextProvider value={renderContextValue!}>
        <div
          className="flex min-h-screen bg-bg text-text"
          style={accentOverride ? ({ "--accent": accentOverride } as CSSProperties) : undefined}
        >
          {drawerOpen && (
            <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setDrawerOpen(false)} />
          )}

          <aside
            className={cn(
              "z-40 flex w-sidebar-width shrink-0 flex-col overflow-hidden border-r border-border bg-surface p-3 transition-[width,transform] duration-200 md:sticky md:top-0 md:h-screen md:translate-x-0",
              "fixed inset-y-0 left-0",
              drawerOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
              collapsed ? "md:w-sidebar-collapsed" : "md:w-sidebar-width",
            )}
          >
            <div className="mb-6 flex h-8 items-center justify-between px-1">
              <div className="flex min-w-0 items-center gap-2">
                {logoUrl ? (
                  <img src={logoUrl} alt="" className="h-6 w-6 shrink-0 rounded object-contain" />
                ) : (
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-accent text-[10px] font-semibold text-accent-fg">
                    {tenantInitials}
                  </span>
                )}
                <span className={cn("truncate text-sm font-semibold text-text", collapsed && "md:hidden")}>{manifest.tenant.name}</span>
              </div>
              <button type="button" className="text-text-muted md:hidden" onClick={() => setDrawerOpen(false)}>
                <Icon name="close" size={18} />
              </button>
            </div>
            <WorkspaceSidebar
              items={manifest.navigation}
              manifest={manifest}
              pathname={pathname}
              collapsed={collapsed}
              onNavigate={() => setDrawerOpen(false)}
              onHoverIntent={prefetchPage}
            />
            <button
              type="button"
              onClick={toggleCollapsed}
              className="hidden h-8 w-full shrink-0 items-center justify-center rounded-md border border-border text-text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text md:flex"
            >
              <Icon name={collapsed ? "keyboard_double_arrow_right" : "keyboard_double_arrow_left"} size={16} />
            </button>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="glass-panel sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border px-4">
              <div className="flex items-center gap-3">
                <button type="button" className="text-text-muted md:hidden" onClick={() => setDrawerOpen(true)}>
                  <Icon name="menu" size={20} />
                </button>
              </div>
              <div className="flex items-center gap-2">
                {manifest.aiAvailable && (
                  <button
                    type="button"
                    onClick={() => openAiPanel()}
                    className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text"
                  >
                    <Icon name="auto_awesome" size={15} />
                    Ask AI
                  </button>
                )}
                <NotificationBell />
                <Dropdown
                  align="end"
                  trigger={({ toggle }) => (
                    <button
                      type="button"
                      onClick={toggle}
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-fg"
                    >
                      {initials}
                    </button>
                  )}
                >
                  {({ close }) => (
                    <>
                      <div className="border-b border-border px-3 py-2">
                        <div className="truncate text-sm font-medium text-text">{manifest.user.displayName}</div>
                        <div className="truncate text-xs text-text-muted">{manifest.user.roles.join(", ")}</div>
                      </div>
                      <DropdownItem
                        onClick={() => {
                          setTheme(theme === "dark" ? "light" : "dark");
                          close();
                        }}
                      >
                        <Icon name={theme === "dark" ? "light_mode" : "dark_mode"} size={15} />
                        {theme === "dark" ? "Light mode" : "Dark mode"}
                      </DropdownItem>
                      <DropdownItem danger onClick={handleLogout}>
                        <Icon name="logout" size={15} />
                        Log out
                      </DropdownItem>
                    </>
                  )}
                </Dropdown>
              </div>
            </header>

            <main className="flex-1 p-4 md:p-6">{children}</main>
          </div>
        </div>
        <CommandPalette items={commandItems} />
        <AiPanel open={aiPanelOpen} onClose={() => setAiPanelOpen(false)} preset={aiPanelPreset} context={aiPanelContext} />
      </RenderContextProvider>
    </BootstrapContextProvider>
  );
}
