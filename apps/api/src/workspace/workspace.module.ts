import { Module } from "@nestjs/common";
import { ConfigEngineModule } from "../config-engine/config-engine.module";
import { WorkspaceController } from "./workspace.controller";

@Module({
  imports: [ConfigEngineModule],
  controllers: [WorkspaceController],
})
export class WorkspaceModule {}
