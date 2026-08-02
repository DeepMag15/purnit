import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { SupabaseAdminService } from "./supabase-admin.service";

@Module({
  controllers: [AuthController],
  providers: [AuthService, SupabaseAdminService],
  exports: [SupabaseAdminService],
})
export class AuthModule {}
