import { Injectable } from "@nestjs/common";
import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestAuthContext {
  tenantId: string;
  authUserId: string;
  permissionsHash: string;
}

@Injectable()
export class TenantContextService {
  private readonly als = new AsyncLocalStorage<RequestAuthContext>();

  run<T>(context: RequestAuthContext, fn: () => T): T {
    return this.als.run(context, fn);
  }

  get(): RequestAuthContext | undefined {
    return this.als.getStore();
  }

  getOrThrow(): RequestAuthContext {
    const ctx = this.als.getStore();
    if (!ctx) {
      throw new Error("No request auth context available outside an authenticated request");
    }
    return ctx;
  }
}
