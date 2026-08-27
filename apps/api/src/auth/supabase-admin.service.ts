import { BadRequestException, Injectable } from "@nestjs/common";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Single public-read bucket for tenant logos — created once, manually, via
// the Supabase Dashboard (see CONTEXT.md's Settings module notes), same
// one-time-manual-setup precedent as the custom-access-token-hook. Not
// env-configurable: unlike SUPABASE_URL (genuinely differs per environment),
// the bucket *name* has no reason to vary between environments that each
// already point at their own Supabase project.
const LOGO_BUCKET = "logos";

// Private bucket for Project Documents (Core Workspace Phase 2, Submodule
// 1) — created via a one-off script using this same service-role client
// (see CONTEXT.md), not a manual Dashboard step. Unlike LOGO_BUCKET, this
// bucket has zero public policies: every read goes through
// createDocumentSignedUrl below, only after the caller has already
// confirmed the actor can see the document's parent project.
const DOCUMENTS_BUCKET = "documents";

// Short-lived — a document's contents are re-authorized on every fetch, so
// a longer TTL would only widen the window an already-authorized link could
// be reused/leaked without buying anything (the caller mints a fresh one
// per request anyway).
const DOCUMENT_URL_EXPIRY_SECONDS = 300;

/** Wraps the one service-role Supabase client this codebase uses — both
 * Auth Admin operations (createUser/deleteUser) and Storage admin operations
 * (logo upload URLs) live on this single client, not split across services;
 * a second client would just re-read the same two env vars for no isolation
 * benefit. */
@Injectable()
export class SupabaseAdminService {
  private readonly client: SupabaseClient;

  constructor() {
    this.client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  async createUser(email: string, password: string) {
    const { data, error } = await this.client.auth.admin.createUser({
      email,
      password,
      // Accounts created here (signup's own admin, or an invited teammate)
      // must be usable immediately with the password we just set — there's
      // no self-serve email-confirmation link in this flow, so waiting on
      // one would just lock the account out.
      email_confirm: true,
    });
    if (error?.code === "email_exists") {
      throw new BadRequestException("This email is already registered. Use a different email address.");
    }
    if (error || !data.user) {
      throw new Error(`Failed to create auth user: ${error?.message ?? "unknown error"}`);
    }
    return data.user;
  }

  async deleteUser(authUserId: string) {
    await this.client.auth.admin.deleteUser(authUserId);
  }

  /** Enterprise SSO — the mechanism that lets a Keycloak-brokered login end
   * in a REAL Supabase session, so `custom_access_token_hook` fires exactly
   * as it does for password logins and `tenant_id`/`permissions_hash` land
   * on the JWT with zero changes to jwt-verifier.service.ts or the hook
   * itself. `hashedToken` is a fully-authenticating bearer credential until
   * consumed by `verifyMagicLinkOtp` below — callers must never log it or
   * return it in any response, and must consume it within the same request. */
  async generateMagicLink(email: string): Promise<{ hashedToken: string }> {
    const { data, error } = await this.client.auth.admin.generateLink({ type: "magiclink", email });
    if (error || !data.properties?.hashed_token) {
      throw new Error(`Failed to generate SSO session link: ${error?.message ?? "unknown error"}`);
    }
    return { hashedToken: data.properties.hashed_token };
  }

  /** Consumes a `generateMagicLink` token — `type: "email"` here is correct
   * even though the link above was generated with `type: "magiclink"`; this
   * is Supabase's own asymmetry between the two calls, not a typo. */
  async verifyMagicLinkOtp(hashedToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const { data, error } = await this.client.auth.verifyOtp({ token_hash: hashedToken, type: "email" });
    if (error || !data.session) {
      throw new Error(`Failed to verify SSO session link: ${error?.message ?? "unknown error"}`);
    }
    return { accessToken: data.session.access_token, refreshToken: data.session.refresh_token };
  }

  /** Returns a short-lived signed upload URL + the eventual public URL for
   * `path` — the caller (a mutation) never handles the file's bytes itself;
   * the browser uploads directly to Storage using this URL, keeping the
   * binary payload off our own request/body-size limits entirely. */
  async createLogoSignedUploadUrl(path: string): Promise<{ path: string; signedUrl: string; token: string; publicUrl: string }> {
    const { data, error } = await this.client.storage.from(LOGO_BUCKET).createSignedUploadUrl(path);
    if (error || !data) {
      throw new Error(`Failed to create logo upload URL: ${error?.message ?? "unknown error"}`);
    }
    const { data: publicUrlData } = this.client.storage.from(LOGO_BUCKET).getPublicUrl(path);
    // `path` is echoed back so the caller (browser) can pass it straight to
    // `uploadToSignedUrl(path, token, file)` without parsing it back out of
    // `signedUrl`'s own URL structure.
    return { path, signedUrl: data.signedUrl, token: data.token, publicUrl: publicUrlData.publicUrl };
  }

  /** Same "browser uploads directly to Storage" shape as
   * `createLogoSignedUploadUrl` — but no `publicUrl`, since the Documents
   * bucket is private and has none. */
  async createDocumentSignedUploadUrl(path: string): Promise<{ path: string; signedUrl: string; token: string }> {
    const { data, error } = await this.client.storage.from(DOCUMENTS_BUCKET).createSignedUploadUrl(path);
    if (error || !data) {
      throw new Error(`Failed to create document upload URL: ${error?.message ?? "unknown error"}`);
    }
    return { path, signedUrl: data.signedUrl, token: data.token };
  }

  /** Mints a short-lived, scoped read URL — the caller (`document.getFileUrl`)
   * must confirm the actor can see the document's parent project *before*
   * calling this, same "authorize, then mint a time-limited credential"
   * shape as `meeting.getJoinInfo`. `downloadAs` unset renders inline in the
   * browser (preview); set, it forces a download with that filename. */
  async createDocumentSignedUrl(path: string, downloadAs?: string): Promise<string> {
    const { data, error } = await this.client.storage
      .from(DOCUMENTS_BUCKET)
      .createSignedUrl(path, DOCUMENT_URL_EXPIRY_SECONDS, downloadAs ? { download: downloadAs } : undefined);
    if (error || !data) {
      throw new Error(`Failed to create document signed URL: ${error?.message ?? "unknown error"}`);
    }
    return data.signedUrl;
  }

  /** Phase B (AI Assistant RAG) — unlike every other Storage method here,
   * this returns raw bytes rather than a signed URL: the embedding job
   * processor runs server-side with no browser in the loop to hand a URL
   * to, so it needs the file contents directly. Only ever called after a
   * caller has already confirmed authorization to touch this document (the
   * embedding job's own tenant scoping, not a per-request user action). */
  async downloadDocumentBytes(path: string): Promise<Uint8Array> {
    const { data, error } = await this.client.storage.from(DOCUMENTS_BUCKET).download(path);
    if (error || !data) {
      throw new Error(`Failed to download document "${path}": ${error?.message ?? "unknown error"}`);
    }
    return new Uint8Array(await data.arrayBuffer());
  }
}
