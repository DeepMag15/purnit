import { generateTemporaryPassword } from "./users.mutations";

describe("generateTemporaryPassword", () => {
  it("generates a password well above Supabase Auth's 6-char minimum", () => {
    expect(generateTemporaryPassword().length).toBeGreaterThanOrEqual(20);
  });

  it("uses only base64url-safe characters (readable/typeable when shared out of band)", () => {
    expect(generateTemporaryPassword()).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("generates a different password on every call", () => {
    expect(generateTemporaryPassword()).not.toBe(generateTemporaryPassword());
  });
});
