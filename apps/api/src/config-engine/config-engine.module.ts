import { Module } from "@nestjs/common";
import { ConfigEngineService } from "./compiler.service";

@Module({
  providers: [ConfigEngineService],
  exports: [ConfigEngineService],
})
export class ConfigEngineModule {}
