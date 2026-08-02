import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { AuthModule } from "../../auth/auth.module";
import { SupabaseAdminService } from "../../auth/supabase-admin.service";
import { EmailModule } from "../../email/email.module";
import { EmailService } from "../../email/email.service";
import { TenantPrismaService } from "../../tenancy/tenant-prisma.service";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { rolesListDataSource, usersListDataSource } from "./users.data-sources";
import { createUserInviteMutation, userAssignDepartmentMutation, userChangeRoleMutation, userSetManagerMutation } from "./users.mutations";

/** Same registrar pattern as Projects/Tasks/Notifications — see
 * projects.module.ts for the rationale. */
@Injectable()
class UsersRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
    private readonly supabaseAdmin: SupabaseAdminService,
    private readonly emailService: EmailService,
    private readonly tenantPrisma: TenantPrismaService,
  ) {}

  onModuleInit() {
    this.dataSources.register(usersListDataSource);
    this.dataSources.register(rolesListDataSource);
    this.mutations.register(createUserInviteMutation(this.supabaseAdmin, this.emailService, this.tenantPrisma));
    this.mutations.register(userAssignDepartmentMutation);
    this.mutations.register(userChangeRoleMutation);
    this.mutations.register(userSetManagerMutation);
  }
}

@Module({
  imports: [AuthModule, EmailModule],
  providers: [UsersRegistrar],
})
export class UsersModule {}
