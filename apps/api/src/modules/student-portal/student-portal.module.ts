import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { MetricRegistry } from "../../metrics/metric-registry.service";
import {
  myCoursesListDataSource,
  myAssignmentsListDataSource,
  myProgressGetDataSource,
  myCourseMaterialsListDataSource,
  studentPortalCapabilitiesDataSource,
} from "./student-portal.data-sources";
import { studentLinkLoginMutation } from "./student-portal.mutations";
import {
  myOpenAssignmentsMetric,
  myDueThisWeekMetric,
  myCourseCountMetric,
  myAttendanceRateMetric,
} from "./student-portal.metrics";

/**
 * Student Role — the learner-facing half of the Education domain.
 *
 * Its own module rather than an addition to `students`: that module is the
 * school's register of students, written by staff; this is one student's view
 * of themselves. Keeping them apart is what stops a student-facing source from
 * ever accidentally reusing `studentsWhere`, which answers a staff question.
 *
 * Same registrar pattern as every other module — see students.module.ts.
 */
@Injectable()
class StudentPortalRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
    private readonly metrics: MetricRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(myCoursesListDataSource);
    this.dataSources.register(myAssignmentsListDataSource);
    this.dataSources.register(myProgressGetDataSource);
    this.dataSources.register(myCourseMaterialsListDataSource);
    this.dataSources.register(studentPortalCapabilitiesDataSource);
    this.mutations.register(studentLinkLoginMutation);
    this.metrics.register(myOpenAssignmentsMetric);
    this.metrics.register(myDueThisWeekMetric);
    this.metrics.register(myCourseCountMetric);
    this.metrics.register(myAttendanceRateMetric);
  }
}

@Module({ providers: [StudentPortalRegistrar] })
export class StudentPortalModule {}
