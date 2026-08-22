import { BadRequestException, ForbiddenException, Injectable, Logger } from "@nestjs/common";
import { TenantPrismaService } from "../tenancy/tenant-prisma.service";
import { SupabaseAdminService } from "../auth/supabase-admin.service";
import { generateTemporaryPassword } from "../modules/users/users.mutations";
import { assertSeatAvailable } from "../billing/assert-seat-available";

export interface SsoClaims {
  email: string;
  emailVerified: boolean;
  name?: string;
}

export interface SsoConfigForProvisioning {
  defaultRoleId: string | null;
  requireEmailVerified: boolean;
}

/**
 * Enterprise SSO — just-in-time provisioning + federation into a REAL
 * Supabase session. Mirrors `createUserInviteMutation`'s shape
 * (`modules/users/users.mutations.ts`: validate role → create the Supabase
 * Auth user → create the `User` row → roll back the orphaned auth user on
 * failure) with fixes specific to SSO, verified against
 * `tenancy/assert-password-changed.ts` directly rather than assumed:
 *
 * - `mustChangePassword: false`, NOT `true`. Copying `user.invite`'s
 *   default verbatim would be a real bug — `assertPasswordChanged` (called
 *   in every controller that grants real access) throws a hard 403 until
 *   that flag clears via `supabase.auth.updateUser({password})`, and an SSO
 *   user has no password to set; their identity lives permanently at the
 *   upstream IdP. Copying the invite default would trap every first SSO
 *   login in an unbreakable redirect loop.
 * - `ssoProvisioned: true` — an informational breadcrumb only, never
 *   consulted for authorization (see user.prisma's own doc comment).
 */
@Injectable()
export class SsoJitProvisionService {
  private readonly logger = new Logger(SsoJitProvisionService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly supabaseAdmin: SupabaseAdminService,
  ) {}

  async provisionAndFederate(
    tenantId: string,
    ssoConfig: SsoConfigForProvisioning,
    claims: SsoClaims,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    // An SSO login delegates "this email belongs to this person" entirely
    // to the upstream IdP's assertion — only a safe trust boundary if that
    // IdP actually verified the email. Checked before touching Supabase at
    // all, same "authorize before any external call" discipline as every
    // mutation's own permission check.
    if (ssoConfig.requireEmailVerified && !claims.emailVerified) {
      throw new ForbiddenException("Your identity provider did not confirm this email address");
    }

    const existing = await this.tenantPrisma.run(tenantId, (tx) =>
      tx.user.findFirst({ where: { tenantId, email: claims.email, deletedAt: null } }),
    );
    // Awaited for its side effect (creating the Supabase Auth user +
    // `User` row) — `generateMagicLink` below requires the Supabase Auth
    // user to already exist, so this must resolve first.
    if (!existing) {
      await this.jitCreate(tenantId, ssoConfig, claims);
    }

    // Federating into a REAL Supabase session (not verifying a Keycloak-
    // issued token ourselves) is what keeps jwt-verifier.service.ts and the
    // custom-access-token-hook completely untouched — this mints the
    // session through Supabase's own normal pipeline, so tenant_id/
    // permissions_hash are stamped exactly as they are for password logins.
    const { hashedToken } = await this.supabaseAdmin.generateMagicLink(claims.email);
    return this.supabaseAdmin.verifyMagicLinkOtp(hashedToken);
  }

  private async jitCreate(
    tenantId: string,
    ssoConfig: SsoConfigForProvisioning,
    claims: SsoClaims,
  ): Promise<{ userId: string; authUserId: string }> {
    if (!ssoConfig.defaultRoleId) {
      throw new ForbiddenException("SSO is enabled but no default role is configured — contact your workspace admin");
    }
    const role = await this.tenantPrisma.run(tenantId, (tx) =>
      tx.role.findFirst({ where: { id: ssoConfig.defaultRoleId!, tenantId } }),
    );
    if (!role) {
      throw new ForbiddenException("SSO is enabled but no default role is configured — contact your workspace admin");
    }

    // Go-Live — the seat ceiling applies to JIT provisioning too, not just
    // `user.invite`. A limit only enforced on one of the two paths that
    // create users isn't a limit: an org with SSO configured could otherwise
    // grow past its purchased seats indefinitely just by having people log
    // in. Checked here, before the Supabase Auth account is created, so a
    // refused login never leaves an orphaned auth user behind.
    //
    // This does mean a genuine employee can be turned away at the door when
    // their org is out of seats. That is the deliberate, disclosed trade-off
    // of a hard limit; the message says exactly what happened and who can fix
    // it, rather than surfacing as an opaque SSO failure.
    await this.tenantPrisma.run(tenantId, (tx) => assertSeatAvailable(tx, this.tenantPrisma, tenantId));

    const temporaryPassword = generateTemporaryPassword();
    let authUser: { id: string };
    try {
      authUser = await this.supabaseAdmin.createUser(claims.email, temporaryPassword);
    } catch (err) {
      // `SupabaseAdminService.createUser` throws BadRequestException only
      // for "email_exists" — a near-simultaneous second SSO login for the
      // same not-yet-provisioned email can lose this race after both
      // requests passed the "no existing user" check above. One targeted
      // re-query (the other request likely just finished), not a generic
      // retry loop.
      if (err instanceof BadRequestException) {
        const raced = await this.tenantPrisma.run(tenantId, (tx) =>
          tx.user.findFirst({ where: { tenantId, email: claims.email, deletedAt: null } }),
        );
        if (raced) return { userId: raced.id, authUserId: raced.authUserId };
      }
      throw err;
    }

    try {
      return await this.tenantPrisma.run(tenantId, async (tx) => {
        const user = await tx.user.create({
          data: {
            tenantId,
            authUserId: authUser.id,
            email: claims.email,
            displayName: claims.name?.trim() || claims.email,
            mustChangePassword: false,
            ssoProvisioned: true,
          },
        });
        await tx.roleAssignment.create({ data: { tenantId, userId: user.id, roleId: role.id } });
        return { userId: user.id, authUserId: user.authUserId };
      });
    } catch (err) {
      // Same all-or-nothing rollback as AuthService.signup/user.invite — an
      // orphaned Supabase Auth user with no matching `User` row permanently
      // blocks this email. Logged (not swallowed) if the cleanup itself fails.
      await this.supabaseAdmin.deleteUser(authUser.id).catch((cleanupErr) => {
        this.logger.error(
          `SSO JIT provisioning for "${claims.email}" failed and rollback of its Supabase Auth user (${authUser.id}) also failed — ` +
            `this email is now orphaned and will block future SSO logins/invites/signups until that auth user is deleted manually: ` +
            `${cleanupErr instanceof Error ? cleanupErr.message : cleanupErr}`,
        );
      });
      throw err;
    }
  }
}
