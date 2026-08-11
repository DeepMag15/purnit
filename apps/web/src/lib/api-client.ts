import type { WorkspaceManifest, UINode } from "@antigravity/manifest-schema";
import { getAccessToken } from "./session";

const API_URL = process.env.NEXT_PUBLIC_API_URL!;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAccessToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    // Universal backstop: any endpoint behind the mandatory first-login
    // password change (bootstrap, a data source, a mutation) 403s with this
    // code — see apps/api's assertPasswordChanged. Redirect here, once,
    // rather than relying on every call site to check for it individually.
    if (body.code === "PASSWORD_CHANGE_REQUIRED" && typeof window !== "undefined" && window.location.pathname !== "/change-password") {
      window.location.href = "/change-password";
    }
    throw new ApiError(res.status, body.message ?? `Request failed with ${res.status}`, body.code);
  }

  return res.json() as Promise<T>;
}

export interface SignupInput {
  email: string;
  password: string;
  companyName: string;
  displayName: string;
  industry: "IT" | "Healthcare" | "Education";
}

export function signup(input: SignupInput): Promise<{ tenantId: string; userId: string; workspaceId: string }> {
  return apiFetch("/auth/signup", { method: "POST", body: JSON.stringify(input) });
}

// Called before any Supabase sign-in attempt — see AuthService.verifyWorkspace.
// Throws ApiError (401) if the email doesn't belong to that workspace.
export function verifyWorkspace(workspaceId: string, email: string): Promise<{ valid: true }> {
  return apiFetch("/auth/verify-workspace", { method: "POST", body: JSON.stringify({ workspaceId, email }) });
}

export interface Me {
  id: string;
  displayName: string;
  email: string;
  mustChangePassword: boolean;
}

export function getMe(): Promise<Me> {
  return apiFetch("/me");
}

// Called after `supabase.auth.updateUser({ password })` succeeds on the
// change-password page — clears the server-side mustChangePassword flag.
export function completeFirstLogin(): Promise<{ success: true }> {
  return apiFetch("/auth/complete-first-login", { method: "POST" });
}

// Performance-audit addition (CONTEXT.md §47): the server has supported
// `If-None-Match`/304 since Stage 6, but nothing here ever sent it — every
// bootstrap/page fetch paid the full compile cost on every navigation, even
// back to a page just visited. A tiny per-path (etag, last body) cache is
// enough: on a 304, the cached body is definitionally still correct (the
// etag folds in everything that could have changed — blueprint content,
// tenant config version, permissions hash — so a match means nothing this
// user could see has changed). No explicit invalidation is needed: a real
// content change produces a *different* etag server-side, which naturally
// falls through to a fresh 200 and updates the cache — same mechanism that
// already makes 304 safe, just now actually exercised.
const manifestCache = new Map<string, { etag: string; body: unknown }>();

// Performance pass 2 (CONTEXT.md §48): a real bug found via measurement, not
// assumed — the sidebar's hover-intent prefetch calls `getWorkspacePage`
// ahead of a click, but a click is preceded by a hover in the real DOM event
// sequence too (not just in test automation), so the prefetch and the actual
// navigation's own fetch to the *same path* can both fire before either has
// resolved enough to populate `manifestCache`'s etag — measured costing a
// full second identity-resolution round trip (~2s) that a genuine cache hit
// would have skipped entirely. Fixed the general way: de-duplicate by
// awaiting an already-in-flight request to the same path instead of firing
// a second one, cleared once it settles either way.
const inFlight = new Map<string, Promise<unknown>>();

export function clearManifestCache(): void {
  manifestCache.clear();
}

async function apiFetchCached<T>(path: string): Promise<T> {
  const pending = inFlight.get(path);
  if (pending) return pending as Promise<T>;

  const promise = (async () => {
    const cached = manifestCache.get(path);
    const token = getAccessToken();
    const res = await fetch(`${API_URL}${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(cached ? { "If-None-Match": cached.etag } : {}),
      },
    });

    if (res.status === 304 && cached) {
      return cached.body as T;
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({ message: res.statusText }));
      if (body.code === "PASSWORD_CHANGE_REQUIRED" && typeof window !== "undefined" && window.location.pathname !== "/change-password") {
        window.location.href = "/change-password";
      }
      throw new ApiError(res.status, body.message ?? `Request failed with ${res.status}`, body.code);
    }

    const etag = res.headers.get("etag");
    const data = (await res.json()) as T;
    if (etag) manifestCache.set(path, { etag, body: data });
    return data;
  })();

  inFlight.set(path, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(path);
  }
}

export function getWorkspaceBootstrap(): Promise<WorkspaceManifest> {
  return apiFetchCached("/api/workspace/bootstrap");
}

export function getWorkspacePage(pageId: string): Promise<UINode> {
  return apiFetchCached(`/api/workspace/pages/${encodeURIComponent(pageId)}`);
}

export function callDataSource(source: string, params?: Record<string, unknown>): Promise<unknown> {
  return apiFetch(`/api/data/${encodeURIComponent(source)}`, {
    method: "POST",
    body: JSON.stringify(params ?? {}),
  });
}

/** Performance pass 2 (CONTEXT.md §48) — see `DataSourcesController.resolveBatch`.
 * One HTTP round trip (and one backend transaction) for several sources at
 * once, instead of N of each. A per-item `error` doesn't reject the whole
 * call — the caller decides what to do with each result. */
export function callDataSourceBatch(
  requests: { source: string; params?: Record<string, unknown> }[],
): Promise<{ data?: unknown; error?: string }[]> {
  return apiFetch<{ results: { data?: unknown; error?: string }[] }>("/api/data/batch", {
    method: "POST",
    body: JSON.stringify({ requests }),
  }).then((res) => res.results);
}

export function callMutation(mutation: string, input?: unknown): Promise<unknown> {
  return apiFetch(`/api/mutations/${encodeURIComponent(mutation)}`, {
    method: "POST",
    body: JSON.stringify(input ?? {}),
  });
}
