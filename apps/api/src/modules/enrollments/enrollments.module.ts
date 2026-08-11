import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { enrollmentsListDataSource } from "./enrollments.data-sources";
import { enrollmentEnrollMutation, enrollmentUpdateStatusMutation, enrollmentRecordFinalGradeMutation } from "./enrollments.mutations";

/** Education Domain, Phase A. Same registrar pattern as every other module —
 * see patients.module.ts. */
@Injectable()
class EnrollmentsRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(enrollmentsListDataSource);
    this.mutations.register(enrollmentEnrollMutation);
    this.mutations.register(enrollmentUpdateStatusMutation);
    this.mutations.register(enrollmentRecordFinalGradeMutation);
  }
}

@Module({
  providers: [EnrollmentsRegistrar],
})
export class EnrollmentsModule {}
