import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { studentsListDataSource, studentDetailDataSource } from "./students.data-sources";
import { studentRegisterMutation, studentUpdateStatusMutation } from "./students.mutations";

/** Education Domain, Phase A. Same registrar pattern as every other module —
 * see patients.module.ts. */
@Injectable()
class StudentsRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(studentsListDataSource);
    this.dataSources.register(studentDetailDataSource);
    this.mutations.register(studentRegisterMutation);
    this.mutations.register(studentUpdateStatusMutation);
  }
}

@Module({
  providers: [StudentsRegistrar],
})
export class StudentsModule {}
