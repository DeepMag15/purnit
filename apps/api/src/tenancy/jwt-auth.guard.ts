import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { TenantContextService } from "./tenant-context.service";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly tenantContext: TenantContextService) {}

  canActivate(_context: ExecutionContext): boolean {
    if (!this.tenantContext.get()) {
      throw new UnauthorizedException("Missing or invalid authentication");
    }
    return true;
  }
}
