import { Global, Module } from "@nestjs/common";
import { MetricRegistry } from "./metric-registry.service";

/** @Global() so every existing module's own registrar can inject
 * MetricRegistry with zero `imports:` change — same treatment RbacModule's
 * PermissionResolverService already gets. */
@Global()
@Module({ providers: [MetricRegistry], exports: [MetricRegistry] })
export class MetricsModule {}
