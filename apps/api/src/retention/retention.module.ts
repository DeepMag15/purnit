import { Module } from "@nestjs/common";
import { RetentionPurgeService } from "./retention-purge.service";

/**
 * Go-Live, Phase 05 — the retention purge job.
 *
 * A module of its own rather than a service tucked inside an existing one:
 * this is platform-level maintenance that sweeps across every tenant, not a
 * feature belonging to any single module, and keeping it separate makes the
 * one piece of code in the system that hard-deletes data easy to find.
 */
@Module({
  providers: [RetentionPurgeService],
  exports: [RetentionPurgeService],
})
export class RetentionModule {}
