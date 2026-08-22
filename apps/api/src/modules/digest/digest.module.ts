import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { EmailModule } from "../../email/email.module";
import { userUpdateDigestPreferenceMutation } from "./digest.mutations";
import { DigestProcessorService } from "./digest-processor.service";

/** Same registrar pattern as every other module — see calendar.module.ts.
 * `PermissionResolverService` is exported `@Global()` by `RbacModule` so no
 * explicit import is needed to inject it into `DigestProcessorService`,
 * same precedent as `TenantPrismaService` via `TenancyModule`. */
@Injectable()
class DigestRegistrar implements OnModuleInit {
  constructor(private readonly mutations: MutationRegistry) {}

  onModuleInit() {
    this.mutations.register(userUpdateDigestPreferenceMutation);
  }
}

@Module({
  imports: [EmailModule],
  providers: [DigestRegistrar, DigestProcessorService],
})
export class DigestModule {}
