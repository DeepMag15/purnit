import { notificationRecipientFor } from "./tasks.mutations";

describe("notificationRecipientFor", () => {
  it("returns the assignee when they differ from the actor", () => {
    expect(notificationRecipientFor("u2", "u1")).toBe("u2");
  });

  it("returns null when the actor is the assignee (self-action, not notification-worthy)", () => {
    expect(notificationRecipientFor("u1", "u1")).toBeNull();
  });

  it("returns null when there is no assignee", () => {
    expect(notificationRecipientFor(null, "u1")).toBeNull();
    expect(notificationRecipientFor(undefined, "u1")).toBeNull();
  });
});
