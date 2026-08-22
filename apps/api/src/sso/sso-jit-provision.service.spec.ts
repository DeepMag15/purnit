import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { SsoJitProvisionService } from "./sso-jit-provision.service";
import type { TenantPrismaService } from "../tenancy/tenant-prisma.service";
import type { SupabaseAdminService } from "../auth/supabase-admin.service";

function fakeTenantPrisma(params: {
  existingUser?: { id: string; authUserId: string } | null;
  role?: { id: string } | null;
  userCreate?: jest.Mock;
  roleAssignmentCreate?: jest.Mock;
  /** Go-Live — seat-limit inputs. Defaults describe an uncapped tenant
   * (`planId: null`, no subscription), so every pre-existing test in this
   * file exercises exactly what it did before the seat check was added. */
  tenant?: Record<string, unknown> | null;
  plan?: { maxSeats: number | null } | null;
  activeUsers?: number;
}) {
  const userFindFirst = jest.fn().mockResolvedValue(params.existingUser ?? null);
  const userCreate = params.userCreate ?? jest.fn().mockResolvedValue({ id: "u1", authUserId: "au1" });
  const roleFindFirst = jest.fn().mockResolvedValue(params.role === undefined ? { id: "role-1" } : params.role);
  const roleAssignmentCreate = params.roleAssignmentCreate ?? jest.fn().mockResolvedValue({});
  const userCount = jest.fn().mockResolvedValue(params.activeUsers ?? 0);
  return {
    root: {
      tenant: {
        findUnique: jest
          .fn()
          .mockResolvedValue(
            params.tenant === undefined ? { id: "t1", stripeSubscriptionId: null, seatsPurchased: 1, planId: null } : params.tenant,
          ),
      },
      plan: { findUnique: jest.fn().mockResolvedValue(params.plan ?? null) },
    },
    run: jest.fn((_tenantId: string, fn: (tx: unknown) => unknown) =>
      fn({
        user: { findFirst: userFindFirst, create: userCreate, count: userCount },
        role: { findFirst: roleFindFirst },
        roleAssignment: { create: roleAssignmentCreate },
      }),
    ),
    _userFindFirst: userFindFirst,
    _userCreate: userCreate,
    _roleAssignmentCreate: roleAssignmentCreate,
  } as unknown as TenantPrismaService & { _userFindFirst: jest.Mock; _userCreate: jest.Mock; _roleAssignmentCreate: jest.Mock };
}

function fakeSupabaseAdmin(params: {
  createUser?: jest.Mock;
  deleteUser?: jest.Mock;
  generateMagicLink?: jest.Mock;
  verifyMagicLinkOtp?: jest.Mock;
}) {
  return {
    createUser: params.createUser ?? jest.fn().mockResolvedValue({ id: "auth-1" }),
    deleteUser: params.deleteUser ?? jest.fn().mockResolvedValue(undefined),
    generateMagicLink: params.generateMagicLink ?? jest.fn().mockResolvedValue({ hashedToken: "hashed-1" }),
    verifyMagicLinkOtp: params.verifyMagicLinkOtp ?? jest.fn().mockResolvedValue({ accessToken: "at", refreshToken: "rt" }),
  } as unknown as SupabaseAdminService;
}

describe("SsoJitProvisionService", () => {
  it("does not call supabaseAdmin.createUser when the user already exists", async () => {
    const tenantPrisma = fakeTenantPrisma({ existingUser: { id: "u1", authUserId: "au1" } });
    const supabaseAdmin = fakeSupabaseAdmin({});
    const service = new SsoJitProvisionService(tenantPrisma, supabaseAdmin);

    const session = await service.provisionAndFederate(
      "t1",
      { defaultRoleId: "role-1", requireEmailVerified: true },
      { email: "a@b.com", emailVerified: true },
    );

    expect(supabaseAdmin.createUser).not.toHaveBeenCalled();
    expect(session).toEqual({ accessToken: "at", refreshToken: "rt" });
  });

  it("JIT-creates a new user with mustChangePassword false and ssoProvisioned true", async () => {
    const tenantPrisma = fakeTenantPrisma({ existingUser: null });
    const supabaseAdmin = fakeSupabaseAdmin({});
    const service = new SsoJitProvisionService(tenantPrisma, supabaseAdmin);

    await service.provisionAndFederate(
      "t1",
      { defaultRoleId: "role-1", requireEmailVerified: true },
      { email: "new@b.com", emailVerified: true, name: "New User" },
    );

    expect(supabaseAdmin.createUser).toHaveBeenCalledWith("new@b.com", expect.any(String));
    expect(tenantPrisma._userCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "t1",
        authUserId: "auth-1",
        email: "new@b.com",
        displayName: "New User",
        mustChangePassword: false,
        ssoProvisioned: true,
      }),
    });
    expect(tenantPrisma._roleAssignmentCreate).toHaveBeenCalledWith({ data: { tenantId: "t1", userId: "u1", roleId: "role-1" } });
  });

  it("falls back to email as displayName when no name claim is present", async () => {
    const tenantPrisma = fakeTenantPrisma({ existingUser: null });
    const supabaseAdmin = fakeSupabaseAdmin({});
    const service = new SsoJitProvisionService(tenantPrisma, supabaseAdmin);

    await service.provisionAndFederate("t1", { defaultRoleId: "role-1", requireEmailVerified: true }, { email: "new@b.com", emailVerified: true });

    expect(tenantPrisma._userCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ displayName: "new@b.com" }) }));
  });

  it("fails closed with no defaultRoleId configured — never calls createUser", async () => {
    const tenantPrisma = fakeTenantPrisma({ existingUser: null });
    const supabaseAdmin = fakeSupabaseAdmin({});
    const service = new SsoJitProvisionService(tenantPrisma, supabaseAdmin);

    await expect(
      service.provisionAndFederate("t1", { defaultRoleId: null, requireEmailVerified: true }, { email: "a@b.com", emailVerified: true }),
    ).rejects.toThrow(ForbiddenException);
    expect(supabaseAdmin.createUser).not.toHaveBeenCalled();
  });

  it("fails closed when the configured defaultRoleId no longer exists in this tenant", async () => {
    const tenantPrisma = fakeTenantPrisma({ existingUser: null, role: null });
    const supabaseAdmin = fakeSupabaseAdmin({});
    const service = new SsoJitProvisionService(tenantPrisma, supabaseAdmin);

    await expect(
      service.provisionAndFederate("t1", { defaultRoleId: "stale-role", requireEmailVerified: true }, { email: "a@b.com", emailVerified: true }),
    ).rejects.toThrow(ForbiddenException);
    expect(supabaseAdmin.createUser).not.toHaveBeenCalled();
  });

  // Go-Live — the seat ceiling has to hold on BOTH user-creating paths.
  // Enforcing it only in `user.invite` would let any org with SSO configured
  // grow past its purchased seats indefinitely just by having people log in.
  it("refuses to JIT-provision past the tenant's purchased seat count", async () => {
    const tenantPrisma = fakeTenantPrisma({
      existingUser: null,
      tenant: { id: "t1", stripeSubscriptionId: "sub_1", seatsPurchased: 5, planId: "p1" },
      activeUsers: 5,
    });
    const supabaseAdmin = fakeSupabaseAdmin({});
    const service = new SsoJitProvisionService(tenantPrisma, supabaseAdmin);

    await expect(
      service.provisionAndFederate("t1", { defaultRoleId: "role-1", requireEmailVerified: true }, { email: "a@b.com", emailVerified: true }),
    ).rejects.toThrow(BadRequestException);
    // Checked before Supabase is touched, so a refused login never leaves an
    // orphaned auth account behind.
    expect(supabaseAdmin.createUser).not.toHaveBeenCalled();
  });

  it("still provisions an existing member when seats are full — the limit is on new users only", async () => {
    const tenantPrisma = fakeTenantPrisma({
      existingUser: { id: "u1", authUserId: "au1" },
      tenant: { id: "t1", stripeSubscriptionId: "sub_1", seatsPurchased: 5, planId: "p1" },
      activeUsers: 5,
    });
    const supabaseAdmin = fakeSupabaseAdmin({});
    const service = new SsoJitProvisionService(tenantPrisma, supabaseAdmin);

    await expect(
      service.provisionAndFederate("t1", { defaultRoleId: "role-1", requireEmailVerified: true }, { email: "a@b.com", emailVerified: true }),
    ).resolves.toBeDefined();
  });

  it("rolls back the orphaned Supabase Auth user if the DB transaction fails", async () => {
    const deleteUser = jest.fn().mockResolvedValue(undefined);
    const tenantPrisma = fakeTenantPrisma({ existingUser: null, userCreate: jest.fn().mockRejectedValue(new Error("db down")) });
    const supabaseAdmin = fakeSupabaseAdmin({ deleteUser });
    const service = new SsoJitProvisionService(tenantPrisma, supabaseAdmin);

    await expect(
      service.provisionAndFederate("t1", { defaultRoleId: "role-1", requireEmailVerified: true }, { email: "a@b.com", emailVerified: true }),
    ).rejects.toThrow("db down");
    expect(deleteUser).toHaveBeenCalledWith("auth-1");
  });

  it("rejects an unverified email when requireEmailVerified is true, before any Supabase call", async () => {
    const tenantPrisma = fakeTenantPrisma({});
    const supabaseAdmin = fakeSupabaseAdmin({});
    const service = new SsoJitProvisionService(tenantPrisma, supabaseAdmin);

    await expect(
      service.provisionAndFederate("t1", { defaultRoleId: "role-1", requireEmailVerified: true }, { email: "a@b.com", emailVerified: false }),
    ).rejects.toThrow(ForbiddenException);
    expect(supabaseAdmin.createUser).not.toHaveBeenCalled();
    expect(supabaseAdmin.generateMagicLink).not.toHaveBeenCalled();
  });

  it("allows an unverified email when requireEmailVerified is false", async () => {
    const tenantPrisma = fakeTenantPrisma({ existingUser: { id: "u1", authUserId: "au1" } });
    const supabaseAdmin = fakeSupabaseAdmin({});
    const service = new SsoJitProvisionService(tenantPrisma, supabaseAdmin);

    const session = await service.provisionAndFederate(
      "t1",
      { defaultRoleId: "role-1", requireEmailVerified: false },
      { email: "a@b.com", emailVerified: false },
    );
    expect(session).toEqual({ accessToken: "at", refreshToken: "rt" });
  });

  it("a concurrent email_exists re-queries and proceeds instead of failing", async () => {
    const createUser = jest.fn().mockRejectedValue(new BadRequestException("This email is already registered."));
    let userFindFirstCalls = 0;
    const runMock = jest.fn((_tenantId: string, fn: (tx: unknown) => unknown) => {
      const tx = {
        user: {
          findFirst: jest.fn(() => {
            userFindFirstCalls += 1;
            return Promise.resolve(userFindFirstCalls === 1 ? null : { id: "raced-user", authUserId: "raced-auth" });
          }),
          create: jest.fn(),
          count: jest.fn().mockResolvedValue(0),
        },
        role: { findFirst: jest.fn().mockResolvedValue({ id: "role-1" }) },
        roleAssignment: { create: jest.fn() },
      };
      return fn(tx);
    });
    const tenantPrisma = {
      run: runMock,
      root: {
        tenant: { findUnique: jest.fn().mockResolvedValue({ id: "t1", stripeSubscriptionId: null, seatsPurchased: 1, planId: null }) },
        plan: { findUnique: jest.fn().mockResolvedValue(null) },
      },
    } as unknown as TenantPrismaService;
    const supabaseAdmin = fakeSupabaseAdmin({ createUser });
    const service = new SsoJitProvisionService(tenantPrisma, supabaseAdmin);

    const session = await service.provisionAndFederate(
      "t1",
      { defaultRoleId: "role-1", requireEmailVerified: true },
      { email: "a@b.com", emailVerified: true },
    );

    expect(session).toEqual({ accessToken: "at", refreshToken: "rt" });
    expect(createUser).toHaveBeenCalledTimes(1);
  });
});
