import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { EmailModule } from "../../email/email.module";
import { calendarListDataSource } from "./calendar.data-sources";
import { calendarEventCreateMutation, calendarEventDeleteMutation } from "./calendar.mutations";
import { CalendarReminderProcessorService } from "./calendar-reminder-processor.service";

/** Same registrar pattern as every other module — see announcements.module.ts. */
@Injectable()
class CalendarRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(calendarListDataSource);
    this.mutations.register(calendarEventCreateMutation);
    this.mutations.register(calendarEventDeleteMutation);
  }
}

@Module({
  imports: [EmailModule],
  providers: [CalendarRegistrar, CalendarReminderProcessorService],
})
export class CalendarModule {}
