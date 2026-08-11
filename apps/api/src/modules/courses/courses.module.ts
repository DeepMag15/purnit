import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { coursesListDataSource, courseDetailDataSource, coursesTeacherOptionsDataSource } from "./courses.data-sources";
import { courseCreateMutation, courseUpdateStatusMutation, courseAssignTeacherMutation } from "./courses.mutations";

/** Education Domain, Phase A. Same registrar pattern as every other module —
 * see patients.module.ts. */
@Injectable()
class CoursesRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(coursesListDataSource);
    this.dataSources.register(courseDetailDataSource);
    this.dataSources.register(coursesTeacherOptionsDataSource);
    this.mutations.register(courseCreateMutation);
    this.mutations.register(courseUpdateStatusMutation);
    this.mutations.register(courseAssignTeacherMutation);
  }
}

@Module({
  providers: [CoursesRegistrar],
})
export class CoursesModule {}
