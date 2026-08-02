import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { commentsListDataSource } from "./comments.data-sources";
import { commentCreateMutation, commentDeleteMutation } from "./comments.mutations";

/** Same registrar pattern as every other module — see notifications.module.ts. */
@Injectable()
class CommentsRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(commentsListDataSource);
    this.mutations.register(commentCreateMutation);
    this.mutations.register(commentDeleteMutation);
  }
}

@Module({
  providers: [CommentsRegistrar],
})
export class CommentsModule {}
