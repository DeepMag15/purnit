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
import { MetricsModule } from "./metrics/metrics.module";
import { ProjectsModule } from "./modules/projects/projects.module";
import { TasksModule } from "./modules/tasks/tasks.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { UsersModule } from "./modules/users/users.module";
import { HrModule } from "./modules/hr/hr.module";
import { RolesModule } from "./modules/roles/roles.module";
import { SettingsModule } from "./modules/settings/settings.module";
import { CommentsModule } from "./modules/comments/comments.module";
import { ChatModule } from "./modules/chat/chat.module";
import { MeetingsModule } from "./modules/meetings/meetings.module";
import { AnnouncementsModule } from "./modules/announcements/announcements.module";
import { CalendarModule } from "./modules/calendar/calendar.module";
import { AttendanceModule } from "./modules/attendance/attendance.module";
import { DocumentsModule } from "./modules/documents/documents.module";
import { AiModule } from "./ai/ai.module";
import { AiAssistantModule } from "./modules/ai-assistant/ai-assistant.module";
import { AnalyticsModule } from "./modules/analytics/analytics.module";
import { PatientsModule } from "./modules/patients/patients.module";
import { AppointmentsModule } from "./modules/appointments/appointments.module";
import { StudentsModule } from "./modules/students/students.module";
import { CoursesModule } from "./modules/courses/courses.module";
import { EnrollmentsModule } from "./modules/enrollments/enrollments.module";
import { AssignmentsModule } from "./modules/assignments/assignments.module";
import { GradesModule } from "./modules/grades/grades.module";
import { ClientsModule } from "./modules/clients/clients.module";
import { InvoicesModule } from "./modules/invoices/invoices.module";
import { PaymentsModule } from "./modules/payments/payments.module";
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
    MetricsModule,
    ProjectsModule,
    TasksModule,
    NotificationsModule,
    UsersModule,
    HrModule,
    RolesModule,
    SettingsModule,
    CommentsModule,
    ChatModule,
    MeetingsModule,
    AnnouncementsModule,
    CalendarModule,
    AttendanceModule,
    DocumentsModule,
    AiModule,
    AiAssistantModule,
    AnalyticsModule,
    PatientsModule,
    AppointmentsModule,
    StudentsModule,
    CoursesModule,
    EnrollmentsModule,
    AssignmentsModule,
    GradesModule,
    ClientsModule,
    InvoicesModule,
    PaymentsModule,
  ],
  controllers: [HealthController, MeController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthContextMiddleware).forRoutes("*");
  }
}
