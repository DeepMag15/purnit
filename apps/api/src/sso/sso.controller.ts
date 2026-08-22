import { BadRequestException, Controller, Get, Logger, Query, Req, Res, UseGuards } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { z, ZodError } from "zod";
import { TenantPrismaService } from "../tenancy/tenant-prisma.service";
import { SsoStateService } from "./sso-state.service";
import { SsoBrokerService } from "./sso-broker.service";
import { SsoJitProvisionService } from "./sso-jit-provision.service";

const CSRF_COOKIE = "sso_csrf";
const CSRF_COOKIE_PATH = "/auth/sso/callback";
const CSRF_COOKIE_MAX_AGE_MS = 5 * 60 * 1000;

const WorkspaceIdSchema = z.object({ workspaceId: z.string().trim().min(1) });

function appBaseUrl(): string {
  return process.env.APP_BASE_URL ?? "http://localhost:3000";
}

// Not APP_BASE_URL (the frontend's own address, already used by e.g.
// user.invite's login link) — this is the API's own public address, which
// Keycloak needs to redirect back to. No prior env var covers that, so this
// is a new one; defaults to local dev's own port.
function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? `http://localhost:${process.env.PORT ?? "4000"}`;
}

function callbackRedirectUri(): string {
  return `${apiBaseUrl()}/auth/sso/callback`;
}

/** Express only parses `req.cookies` when `cookie-parser` middleware is
 * installed, which this codebase doesn't otherwise need — reading the one
 * CSRF cookie this controller sets is simpler done directly off the raw
 * `Cookie` header than adding a new global middleware dependency for it. */
function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

/**
 * Enterprise SSO — public, unauthenticated routes (same category as
 * AuthController's own signup/verify-workspace; deliberately not guarded by
 * JwtAuthGuard, same reasoning as BillingWebhookController). Brokers login
 * through a self-hosted Keycloak realm (see infra/keycloak/README.md) and
 * federates a successful broker login into a REAL Supabase session
 * (SsoJitProvisionService), so jwt-verifier.service.ts and the
 * custom-access-token-hook Postgres function need zero changes — see the
 * plan's own "why this stays modular" note.
 *
 * `@UseGuards(ThrottlerGuard)` scopes rate limiting to just these 3 routes
 * (via SsoModule's own `ThrottlerModule.forRoot`) — no rate limiting exists
 * anywhere else in this codebase today, and this isn't retrofitting it onto
 * signup/verify-workspace, only bounding this module's own new public
 * surface (`/auth/sso/callback` can trigger a real `supabaseAdmin.createUser`
 * call from unauthenticated traffic, bounded but not zero-cost).
 */
@Controller("auth")
@UseGuards(ThrottlerGuard)
export class SsoController {
  private readonly logger = new Logger(SsoController.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly state: SsoStateService,
    private readonly broker: SsoBrokerService,
    private readonly jitProvision: SsoJitProvisionService,
  ) {}

  // Deliberately does NOT require an existing User row the way
  // verify-workspace does — a genuinely first-time SSO user has none yet,
  // and JIT provisioning exists for exactly that case. Uniform `false` for
  // both "no such workspace" and "SSO disabled" — no new enumeration vector.
  @Get("workspace-sso-status")
  async workspaceSsoStatus(@Query() query: unknown): Promise<{ ssoEnabled: boolean }> {
    const { workspaceId } = this.parseWorkspaceId(query);
    const tenant = await this.tenantPrisma.root.tenant.findUnique({ where: { workspaceId } });
    if (!tenant) return { ssoEnabled: false };
    // sso_configs has RLS (tenant_isolation, same as every other
    // tenant-scoped table) — `tenantPrisma.run`, never `.root`, same
    // footgun `AuthService.verifyWorkspace`'s own doc comment warns about
    // for `User`.
    const config = await this.tenantPrisma.run(tenant.id, (tx) => tx.ssoConfig.findUnique({ where: { tenantId: tenant.id } }));
    return { ssoEnabled: Boolean(config?.enabled && config.idpAlias) };
  }

  @Get("sso/authorize")
  async authorize(@Query() query: unknown, @Res() res: Response) {
    const { workspaceId } = this.parseWorkspaceId(query);
    const tenant = await this.tenantPrisma.root.tenant.findUnique({ where: { workspaceId } });
    const config = tenant
      ? await this.tenantPrisma.run(tenant.id, (tx) => tx.ssoConfig.findUnique({ where: { tenantId: tenant.id } }))
      : null;
    // Same uniform-rejection discipline as verify-workspace — never lets a
    // caller distinguish "no such workspace" from "SSO not configured here".
    if (!tenant || !config?.enabled || !config.idpAlias) {
      throw new BadRequestException("Enterprise SSO is not enabled for this workspace");
    }

    const codeVerifier = this.broker.generateCodeVerifier();
    const oidcNonce = this.broker.generateNonce();
    const csrfNonce = this.state.generateCsrfNonce();
    const stateToken = this.state.sign({ tenantId: tenant.id, codeVerifier, oidcNonce, csrfNonce });

    res.cookie(CSRF_COOKIE, csrfNonce, {
      httpOnly: true,
      // `lax`, not `strict` — this cookie must survive the top-level GET
      // redirect Keycloak sends the browser back with; `strict` wouldn't.
      sameSite: "lax",
      secure: apiBaseUrl().startsWith("https"),
      maxAge: CSRF_COOKIE_MAX_AGE_MS,
      path: CSRF_COOKIE_PATH,
    });

    const authorizationUrl = await this.broker.buildAuthorizationUrl({
      idpAlias: config.idpAlias,
      redirectUri: callbackRedirectUri(),
      state: stateToken,
      nonce: oidcNonce,
      codeVerifier,
    });
    res.redirect(authorizationUrl);
  }

  @Get("sso/callback")
  async callback(@Query() query: Record<string, string>, @Req() req: Request, @Res() res: Response) {
    try {
      const { code, state: stateToken } = query;
      if (!code || !stateToken) throw new Error("Missing code or state");
      const payload = this.state.verify(stateToken);

      // Proves this callback belongs to the browser that started the flow —
      // signing `state` alone only proves it wasn't forged, not that this
      // request came from the right browser (classic OAuth login-CSRF
      // otherwise: an attacker could complete their own flow, capture a
      // valid code+state, and trick a victim into visiting the callback).
      const csrfCookie = readCookie(req, CSRF_COOKIE);
      if (!csrfCookie || csrfCookie !== payload.csrfNonce) {
        throw new Error("CSRF check failed");
      }

      // Re-fetched fresh — never trust anything but tenantId from the
      // signed state, in case an admin disabled SSO mid-flow.
      const config = await this.tenantPrisma.run(payload.tenantId, (tx) =>
        tx.ssoConfig.findUnique({ where: { tenantId: payload.tenantId } }),
      );
      if (!config?.enabled || !config.idpAlias) throw new Error("SSO was disabled during login");

      const claims = await this.broker.exchangeCode({
        redirectUri: callbackRedirectUri(),
        // The FULL raw query object, not a hand-picked {code, state} subset
        // — see exchangeCode's own doc comment for why (RFC 9207's `iss`
        // parameter, found missing live during E2E verification).
        callbackParams: query,
        state: stateToken,
        codeVerifier: payload.codeVerifier,
        nonce: payload.oidcNonce,
      });

      const session = await this.jitProvision.provisionAndFederate(payload.tenantId, config, claims);

      res.clearCookie(CSRF_COOKIE, { path: CSRF_COOKIE_PATH });
      // URL fragment, never a query param — fragments are never sent to any
      // server or appear in any log, same trick Supabase's own hosted
      // magic-link/OAuth redirects already use. The tokens are otherwise a
      // fully-authenticating bearer credential.
      const fragment = `access_token=${encodeURIComponent(session.accessToken)}&refresh_token=${encodeURIComponent(session.refreshToken)}`;
      res.redirect(`${appBaseUrl()}/login/sso-callback#${fragment}`);
    } catch (err) {
      this.logger.error(`SSO callback failed: ${err instanceof Error ? err.message : String(err)}`);
      res.clearCookie(CSRF_COOKIE, { path: CSRF_COOKIE_PATH });
      res.redirect(`${appBaseUrl()}/login?error=sso_failed`);
    }
  }

  private parseWorkspaceId(query: unknown): z.infer<typeof WorkspaceIdSchema> {
    try {
      return WorkspaceIdSchema.parse(query);
    } catch (err) {
      if (err instanceof ZodError) throw new BadRequestException(err.issues);
      throw err;
    }
  }
}
