import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { attendanceListDataSource, attendanceRosterDataSource } from "./attendance.data-sources";
import { attendanceMarkMutation, attendanceCorrectMutation } from "./attendance.mutations";

/** Same registrar pattern as every other module — see calendar.module.ts.
 * No factory/injected service needed — no external dependency, no outbox,
 * no poller (simpler than CalendarModule). */
@Injectable()
class AttendanceRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(attendanceListDataSource);
    this.dataSources.register(attendanceRosterDataSource);
    this.mutations.register(attendanceMarkMutation);
    this.mutations.register(attendanceCorrectMutation);
  }
}

@Module({
  providers: [AttendanceRegistrar],
})
export class AttendanceModule {}
