import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { notificationsListDataSource, notificationsUnreadCountDataSource } from "./notifications.data-sources";
import { notificationMarkAllReadMutation, notificationMarkReadMutation } from "./notifications.mutations";

/** Same registrar pattern as ProjectsRegistrar/TasksRegistrar — see
 * projects.module.ts for the rationale. */
@Injectable()
class NotificationsRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(notificationsListDataSource);
    this.dataSources.register(notificationsUnreadCountDataSource);
    this.mutations.register(notificationMarkReadMutation);
    this.mutations.register(notificationMarkAllReadMutation);
  }
}

@Module({
  providers: [NotificationsRegistrar],
})
export class NotificationsModule {}
