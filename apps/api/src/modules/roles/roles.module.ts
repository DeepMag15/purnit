import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { PermissionResolverService } from "../../rbac/permission-resolver.service";
import { rolesListDetailedDataSource, permissionsCatalogDataSource, createUsersEffectivePermissionsDataSource } from "./roles.data-sources";
import { roleCreateCustomMutation, roleUpdateCustomMutation, roleCloneMutation, roleDeleteMutation } from "./roles.mutations";
import { delegationsListDataSource } from "./delegation.data-sources";
import { delegationGrantMutation, delegationRevokeMutation } from "./delegation.mutations";

/** Same registrar pattern as every other module (see attendance.module.ts).
 * `RbacModule` is `@Global()`, so `PermissionResolverService` needs no
 * `imports:` entry here beyond the constructor parameter below. */
@Injectable()
class RolesRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
    private readonly permissionResolver: PermissionResolverService,
  ) {}

  onModuleInit() {
    this.dataSources.register(rolesListDetailedDataSource);
    this.dataSources.register(permissionsCatalogDataSource);
    this.dataSources.register(createUsersEffectivePermissionsDataSource(this.permissionResolver));
    this.dataSources.register(delegationsListDataSource);
    this.mutations.register(roleCreateCustomMutation);
    this.mutations.register(roleUpdateCustomMutation);
    this.mutations.register(roleCloneMutation);
    this.mutations.register(roleDeleteMutation);
    this.mutations.register(delegationGrantMutation);
    this.mutations.register(delegationRevokeMutation);
  }
}

@Module({
  providers: [RolesRegistrar],
})
export class RolesModule {}
