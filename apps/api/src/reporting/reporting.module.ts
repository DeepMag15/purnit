import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DataSourceRegistry } from "../data-sources/data-source-registry.service";
import { MutationRegistry } from "../mutations/mutation-registry.service";
import { TenantPrismaService } from "../tenancy/tenant-prisma.service";
import { PermissionResolverService } from "../rbac/permission-resolver.service";
import { AiProviderService } from "../ai/provider/ai-provider.service";
import { SupabaseAdminService } from "../auth/supabase-admin.service";
import { ReportLensRegistry } from "./report-lens-registry.service";
import { DOMAIN_ANCHORS } from "./domain-lenses";
import { createDocumentAnalyzeMutation } from "./report-analysis.mutations";
import { createDocumentAnalysesDataSource } from "./report-analysis.data-sources";

/**
 * Contextual Reporting — the analysis step between "uploaded" and "reviewed".
 *
 * Its own module rather than an addition to Documents: Documents is about
 * files and is domain-agnostic, while this is entirely about what a file
 * *means* to a particular person in a particular domain. Keeping them apart
 * is what lets a domain add a lens without touching the documents module.
 */
@Injectable()
class ReportingRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
    private readonly lenses: ReportLensRegistry,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly aiProvider: AiProviderService,
    private readonly supabaseAdmin: SupabaseAdminService,
    private readonly permissionResolver: PermissionResolverService,
  ) {}

  onModuleInit() {
    for (const anchor of DOMAIN_ANCHORS) this.lenses.register(anchor);
    this.dataSources.register(createDocumentAnalysesDataSource(this.lenses));
    this.mutations.register(
      createDocumentAnalyzeMutation(this.tenantPrisma, this.aiProvider, this.supabaseAdmin, this.lenses, this.permissionResolver),
    );
  }
}

// `AuthModule` for `SupabaseAdminService` (downloading the report's bytes) —
// the same import DocumentsModule needs for exactly the same reason. Everything
// else here (the registries, TenantPrisma, the AI provider, the permission
// resolver) is provided by a global module.
@Module({ imports: [AuthModule], providers: [ReportLensRegistry, ReportingRegistrar], exports: [ReportLensRegistry] })
export class ReportingModule {}
