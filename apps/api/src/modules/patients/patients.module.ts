import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { MetricRegistry } from "../../metrics/metric-registry.service";
import { patientsListDataSource, patientsDoctorOptionsDataSource } from "./patients.data-sources";
import { patientRegisterMutation, patientUpdateStatusMutation, patientAssignDoctorMutation } from "./patients.mutations";
import { patientsTotalCountMetric, patientsStatusBreakdownMetric, doctorsActiveCountMetric } from "./patients.metrics";

/** Healthcare Domain, Phase A. Same registrar pattern as every other
 * module — see attendance.module.ts. */
@Injectable()
class PatientsRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
    private readonly metrics: MetricRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(patientsListDataSource);
    this.dataSources.register(patientsDoctorOptionsDataSource);
    this.mutations.register(patientRegisterMutation);
    this.mutations.register(patientUpdateStatusMutation);
    this.mutations.register(patientAssignDoctorMutation);
    this.metrics.register(patientsTotalCountMetric);
    this.metrics.register(patientsStatusBreakdownMetric);
    this.metrics.register(doctorsActiveCountMetric);
  }
}

@Module({
  providers: [PatientsRegistrar],
})
export class PatientsModule {}
