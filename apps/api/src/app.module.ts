import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { HealthController } from "./health.controller";
import { TenancyModule } from "./tenancy/tenancy.module";
import { AuthContextMiddleware } from "./tenancy/auth-context.middleware";
import { AuthModule } from "./auth/auth.module";
import { RbacModule } from "./rbac/rbac.module";
import { ConfigEngineModule } from "./config-engine/config-engine.module";
import { WorkspaceModule } from "./workspace/workspace.module";
import { DataSourcesModule } from "./data-sources/data-sources.module";
import { MutationsModule } from "./mutations/mutations.module";
import { ProjectsModule } from "./modules/projects/projects.module";
import { TasksModule } from "./modules/tasks/tasks.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { UsersModule } from "./modules/users/users.module";
import { HrModule } from "./modules/hr/hr.module";
import { SettingsModule } from "./modules/settings/settings.module";
import { CommentsModule } from "./modules/comments/comments.module";
import { ChatModule } from "./modules/chat/chat.module";
import { MeetingsModule } from "./modules/meetings/meetings.module";
import { AnnouncementsModule } from "./modules/announcements/announcements.module";
import { CalendarModule } from "./modules/calendar/calendar.module";
import { DocumentsModule } from "./modules/documents/documents.module";
import { AiModule } from "./ai/ai.module";
import { AiAssistantModule } from "./modules/ai-assistant/ai-assistant.module";
import { MeController } from "./me/me.controller";

@Module({
  imports: [
    ScheduleModule.forRoot(),
    TenancyModule,
    AuthModule,
    RbacModule,
    ConfigEngineModule,
    WorkspaceModule,
    DataSourcesModule,
    MutationsModule,
    ProjectsModule,
    TasksModule,
    NotificationsModule,
    UsersModule,
    HrModule,
    SettingsModule,
    CommentsModule,
    ChatModule,
    MeetingsModule,
    AnnouncementsModule,
    CalendarModule,
    DocumentsModule,
    AiModule,
    AiAssistantModule,
  ],
  controllers: [HealthController, MeController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthContextMiddleware).forRoutes("*");
  }
}
