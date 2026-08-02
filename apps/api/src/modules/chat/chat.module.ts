import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { conversationsListDataSource, channelsListDataSource, messagesListDataSource } from "./chat.data-sources";
import {
  conversationCreateChannelMutation,
  conversationCreateDmMutation,
  conversationAddMemberMutation,
  conversationArchiveMutation,
  messageSendMutation,
  messageDeleteMutation,
  conversationMarkReadMutation,
} from "./chat.mutations";

/** Same registrar pattern as every other module — see notifications.module.ts. */
@Injectable()
class ChatRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(conversationsListDataSource);
    this.dataSources.register(channelsListDataSource);
    this.dataSources.register(messagesListDataSource);
    this.mutations.register(conversationCreateChannelMutation);
    this.mutations.register(conversationCreateDmMutation);
    this.mutations.register(conversationAddMemberMutation);
    this.mutations.register(conversationArchiveMutation);
    this.mutations.register(messageSendMutation);
    this.mutations.register(messageDeleteMutation);
    this.mutations.register(conversationMarkReadMutation);
  }
}

@Module({
  providers: [ChatRegistrar],
})
export class ChatModule {}
