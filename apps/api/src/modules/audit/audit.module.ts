import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { auditLogsListDataSource } from "./audit.data-sources";

/** Same registrar pattern as every other module — see leave.module.ts. No
 * mutations to register — `logAudit()` (apps/api/src/audit/log-audit.ts) is
 * a plain helper called directly from other modules' own mutations, not a
 * mutation itself. */
@Injectable()
class AuditRegistrar implements OnModuleInit {
  constructor(private readonly dataSources: DataSourceRegistry) {}

  onModuleInit() {
    this.dataSources.register(auditLogsListDataSource);
  }
}

@Module({
  providers: [AuditRegistrar],
})
export class AuditModule {}
