import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { TenantPrismaService } from "../../tenancy/tenant-prisma.service";
import { AuthModule } from "../../auth/auth.module";
import { SupabaseAdminService } from "../../auth/supabase-admin.service";
import {
  createCreateLogoUploadUrlMutation,
  createUpdateBrandingMutation,
  createUpdateProfileMutation,
  createUpdateWorkspaceIdMutation,
  updateNavigationLabelMutation,
} from "./settings.mutations";

/** Same registrar pattern as every prior module — see projects.module.ts.
 * `TenantPrismaService` is `@Global()` (via `TenancyModule`) and already
 * exported, so no explicit module import is needed to inject it here.
 * `SupabaseAdminService` isn't global, so `AuthModule` is imported below —
 * same precedent as `users.module.ts`. */
@Injectable()
class SettingsRegistrar implements OnModuleInit {
  constructor(
    private readonly mutations: MutationRegistry,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly supabaseAdmin: SupabaseAdminService,
  ) {}

  onModuleInit() {
    this.mutations.register(createUpdateBrandingMutation(this.tenantPrisma));
    this.mutations.register(createUpdateWorkspaceIdMutation(this.tenantPrisma));
    this.mutations.register(updateNavigationLabelMutation);
    this.mutations.register(createUpdateProfileMutation(this.tenantPrisma));
    this.mutations.register(createCreateLogoUploadUrlMutation(this.supabaseAdmin));
  }
}

@Module({
  imports: [AuthModule],
  providers: [SettingsRegistrar],
})
export class SettingsModule {}
