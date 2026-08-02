import { Global, Module } from "@nestjs/common";
import { MutationsController } from "./mutations.controller";
import { MutationRegistry } from "./mutation-registry.service";

@Global()
@Module({
  controllers: [MutationsController],
  providers: [MutationRegistry],
  exports: [MutationRegistry],
})
export class MutationsModule {}
