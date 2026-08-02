import { Global, Module } from "@nestjs/common";
import { TenantContextService } from "./tenant-context.service";
import { TenantPrismaService } from "./tenant-prisma.service";
import { JwtVerifierService } from "./jwt-verifier.service";
import { AuthContextMiddleware } from "./auth-context.middleware";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { CurrentUserService } from "./current-user.service";

@Global()
@Module({
  providers: [
    TenantContextService,
    TenantPrismaService,
    JwtVerifierService,
    AuthContextMiddleware,
    JwtAuthGuard,
    CurrentUserService,
  ],
  exports: [TenantContextService, TenantPrismaService, JwtVerifierService, JwtAuthGuard, CurrentUserService],
})
export class TenancyModule {}
