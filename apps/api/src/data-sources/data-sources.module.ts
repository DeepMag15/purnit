import { Global, Module } from "@nestjs/common";
import { DataSourcesController } from "./data-sources.controller";
import { DataSourceRegistry } from "./data-source-registry.service";

@Global()
@Module({
  controllers: [DataSourcesController],
  providers: [DataSourceRegistry],
  exports: [DataSourceRegistry],
})
export class DataSourcesModule {}
