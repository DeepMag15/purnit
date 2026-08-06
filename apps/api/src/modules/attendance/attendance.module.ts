import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { MetricRegistry } from "../../metrics/metric-registry.service";
import { attendanceListDataSource, attendanceRosterDataSource } from "./attendance.data-sources";
import { attendanceMarkMutation, attendanceCorrectMutation } from "./attendance.mutations";
import {
  attendanceRateThisMonthMetric,
  attendanceRateByDepartmentMetric,
  attendanceStatusByDepartmentMetric,
  attendanceDepartmentLeaderboardMetric,
} from "./attendance.metrics";

/** Same registrar pattern as every other module — see calendar.module.ts.
 * No factory/injected service needed — no external dependency, no outbox,
 * no poller (simpler than CalendarModule). */
@Injectable()
class AttendanceRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
    private readonly metrics: MetricRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(attendanceListDataSource);
    this.dataSources.register(attendanceRosterDataSource);
    this.mutations.register(attendanceMarkMutation);
    this.mutations.register(attendanceCorrectMutation);
    this.metrics.register(attendanceRateThisMonthMetric);
    this.metrics.register(attendanceRateByDepartmentMetric);
    this.metrics.register(attendanceStatusByDepartmentMetric);
    this.metrics.register(attendanceDepartmentLeaderboardMetric);
  }
}

@Module({
  providers: [AttendanceRegistrar],
})
export class AttendanceModule {}
