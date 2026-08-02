import { Controller, Get, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../tenancy/jwt-auth.guard";
import { CurrentUserService } from "../tenancy/current-user.service";
import { PermissionResolverService } from "../rbac/permission-resolver.service";

@Controller("me")
@UseGuards(JwtAuthGuard)
export class MeController {
  constructor(
    private readonly currentUser: CurrentUserService,
    private readonly permissionResolver: PermissionResolverService,
  ) {}

  @Get()
  async me() {
    return this.currentUser.get();
  }

  /**
   * Verification endpoint for Stage 3 — surfaces the resolver's output so it
   * can be checked live, not just via unit tests. Not a permanent API surface
   * consumers should depend on; the Configuration Engine calls
   * PermissionResolverService directly (manifest pruning, and Stage 8+'s
   * data-source authorization).
   */
  @Get("permissions")
  async permissions() {
    const user = await this.currentUser.get();
    const effective = await this.permissionResolver.resolveEffectivePermissions(user.tenantId, user.id);
    return { permissionsHash: effective.permissionsHash, permissions: effective.toArray() };
  }
}
