import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerModule } from "@nestjs/throttler";
import { SentryGlobalFilter, SentryModule } from "@sentry/nestjs/setup";
import { HealthController } from "./health.controller";
import { THROTTLERS } from "./throttling/throttle.config";
import { ScopedThrottlerGuard } from "./throttling/scoped-throttler.guard";
import { RequestLoggingInterceptor } from "./observability/request-logging.interceptor";
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
import { LeaveModule } from "./modules/leave/leave.module";
import { CrmModule } from "./modules/crm/crm.module";
import { PresenceModule } from "./modules/presence/presence.module";
import { AuditModule } from "./modules/audit/audit.module";
import { BillingModule } from "./billing/billing.module";
import { FeatureFlagsModule } from "./modules/feature-flags/feature-flags.module";
import { SsoModule } from "./sso/sso.module";
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
import { SuppliersModule } from "./modules/suppliers/suppliers.module";
import { InventoryItemsModule } from "./modules/inventory-items/inventory-items.module";
import { BomLinesModule } from "./modules/bom-lines/bom-lines.module";
import { PurchaseOrdersModule } from "./modules/purchase-orders/purchase-orders.module";
import { WorkOrdersModule } from "./modules/work-orders/work-orders.module";
import { DigestModule } from "./modules/digest/digest.module";
import { MeController } from "./me/me.controller";

@Module({
  imports: [
    // Go-Live, Phase 04 — error tracking. Harmless when SENTRY_DSN is unset:
    // `Sentry.init` is never called (observability/sentry.ts), so this
    // registers a module that reports nowhere rather than changing behaviour.
    SentryModule.forRoot(),
    ScheduleModule.forRoot(),
    // Go-Live, Phase 04 — rate limiting, registered ONCE here rather than
    // per-module. The in-memory store is correct for a single always-on API
    // process (which is what Render runs); if the API is ever scaled to
    // multiple instances this needs a shared store, or each instance will
    // enforce its own separate budget.
    ThrottlerModule.forRoot(THROTTLERS),
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
    LeaveModule,
    CrmModule,
    PresenceModule,
    AuditModule,
    BillingModule,
    FeatureFlagsModule,
    SsoModule,
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
    SuppliersModule,
    InventoryItemsModule,
    BomLinesModule,
    PurchaseOrdersModule,
    WorkOrdersModule,
    DigestModule,
  ],
  controllers: [HealthController, MeController],
  providers: [
    // Global by default — the point of Phase 04 is that rate limiting stops
    // being opt-in. Routes that must not be limited (the health probe, the
    // Stripe webhook) opt OUT explicitly with @SkipThrottle, which is a much
    // safer default than opting in and forgetting one.
    { provide: APP_GUARD, useClass: ScopedThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor },
    // Extends Nest's own `BaseExceptionFilter`, so response shapes are
    // unchanged — it reports to Sentry on the way past and otherwise behaves
    // exactly as the default handler this app has always used. Expected
    // errors (`HttpException` — every 400/403/404 this app throws
    // deliberately) are not reported; only genuine unhandled failures are.
    { provide: APP_FILTER, useClass: SentryGlobalFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthContextMiddleware).forRoutes("*");
  }
}
