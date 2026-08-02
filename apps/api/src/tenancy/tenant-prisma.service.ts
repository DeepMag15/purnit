import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../generated/prisma/client";

export type PrismaTx = Prisma.TransactionClient;

/**
 * The app always connects as the restricted `app_runtime` role (see CONTEXT.md §9) —
 * RLS is enforced by Postgres itself, this service just has to set the session's
 * `app.tenant_id` GUC before any tenant-scoped query runs. Each `run()` call opens
 * its own short transaction (safe under Supavisor's transaction-mode pooling; a
 * single long-lived per-request transaction is not).
 */
@Injectable()
export class TenantPrismaService implements OnModuleDestroy {
  readonly client: PrismaClient;

  constructor() {
    const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
    this.client = new PrismaClient({ adapter });
  }

  /** Non-tenant-scoped access (tenants, blueprints, plans — platform-root tables). */
  get root(): PrismaClient {
    return this.client;
  }

  async run<T>(tenantId: string, fn: (tx: PrismaTx) => Promise<T>): Promise<T> {
    return this.client.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SELECT set_config('app.tenant_id', $1, true)", tenantId);
        return fn(tx);
      },
      // Prisma's 5s default assumes a resolver only does DB work. A few
      // mutations (e.g. user.invite) also make an external HTTP call
      // (Resend) inside this same transaction — found live when a slow
      // Resend rejection (an unverified-recipient error, not a timeout on
      // Resend's end) pushed total transaction time past 5s, 500ing the
      // whole invite with an opaque "commit cannot be executed on an
      // expired transaction." Raised as a pragmatic mitigation; the real
      // fix is moving external I/O out of the transaction entirely (no
      // mutation resolver can currently do "commit, then do X" — a genuine
      // follow-up, not something to redesign here).
      { timeout: 20_000 },
    );
  }

  async onModuleDestroy() {
    await this.client.$disconnect();
  }
}
