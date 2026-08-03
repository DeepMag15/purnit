import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { collapsePermissions } from "./permission-collapse";
import { assertPermissionsGrantableByActor } from "./permission-grant-check";

describe("assertPermissionsGrantableByActor", () => {
  it("throws when the actor doesn't hold the resource:action at all", () => {
    const actor = collapsePermissions([]);
    expect(() => assertPermissionsGrantableByActor(actor, ["project:create:own"])).toThrow(ForbiddenException);
  });

  it("succeeds when the actor holds exactly what's requested", () => {
    const actor = collapsePermissions(["project:create:department"]);
    expect(() => assertPermissionsGrantableByActor(actor, ["project:create:department"])).not.toThrow();
  });

  it("succeeds when the actor holds a broader scope than requested", () => {
    const actor = collapsePermissions(["project:create:tenant"]);
    expect(() => assertPermissionsGrantableByActor(actor, ["project:create:own"])).not.toThrow();
  });

  it("throws when the actor holds a narrower scope than requested, even for a resource:action they do hold", () => {
    const actor = collapsePermissions(["project:create:department"]);
    expect(() => assertPermissionsGrantableByActor(actor, ["project:create:tenant"])).toThrow(ForbiddenException);
  });

  it("is all-or-nothing across multiple triples — one ungranted triple fails the whole call", () => {
    const actor = collapsePermissions(["project:create:tenant"]);
    expect(() => assertPermissionsGrantableByActor(actor, ["project:create:own", "task:create:own"])).toThrow(ForbiddenException);
  });

  it("succeeds trivially on an empty request array (label-only role updates)", () => {
    const actor = collapsePermissions([]);
    expect(() => assertPermissionsGrantableByActor(actor, [])).not.toThrow();
  });

  it("throws BadRequestException, not a raw crash, on a malformed permission string", () => {
    const actor = collapsePermissions(["project:create:tenant"]);
    expect(() => assertPermissionsGrantableByActor(actor, ["not-a-valid-triple"])).toThrow(BadRequestException);
  });
});
