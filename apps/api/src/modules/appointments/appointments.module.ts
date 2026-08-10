import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { appointmentsListDataSource } from "./appointments.data-sources";
import { appointmentCreateMutation, appointmentUpdateStatusMutation } from "./appointments.mutations";

/** Healthcare Domain, Phase A. Same registrar pattern as every other
 * module — see attendance.module.ts. `calendar.list`'s own fourth
 * "appointment" source-type branch is a later phase (Phase B), not this
 * one — Phase A ships the model + CRUD only. */
@Injectable()
class AppointmentsRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(appointmentsListDataSource);
    this.mutations.register(appointmentCreateMutation);
    this.mutations.register(appointmentUpdateStatusMutation);
  }
}

@Module({
  providers: [AppointmentsRegistrar],
})
export class AppointmentsModule {}
