import { ForbiddenException } from "@nestjs/common";
import { assertPasswordChanged } from "./assert-password-changed";
import type { CurrentUser } from "./current-user.service";

const baseUser: CurrentUser = {
  id: "u1",
  authUserId: "au1",
  tenantId: "t1",
  displayName: "Test User",
  email: "test@example.com",
  departmentId: null,
  mustChangePassword: false,
};

describe("assertPasswordChanged", () => {
  it("does nothing when mustChangePassword is false", () => {
    expect(() => assertPasswordChanged(baseUser)).not.toThrow();
  });

  it("throws a ForbiddenException carrying the PASSWORD_CHANGE_REQUIRED code when true", () => {
    const pending = { ...baseUser, mustChangePassword: true };
    try {
      assertPasswordChanged(pending);
      throw new Error("expected assertPasswordChanged to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).getResponse()).toMatchObject({ code: "PASSWORD_CHANGE_REQUIRED" });
    }
  });
});
