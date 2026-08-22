import { resolveCorsOptions } from "./cors";

describe("resolveCorsOptions", () => {
  const originalOrigins = process.env.CORS_ALLOWED_ORIGINS;
  const originalEnv = process.env.APP_ENV;

  afterEach(() => {
    if (originalOrigins === undefined) delete process.env.CORS_ALLOWED_ORIGINS;
    else process.env.CORS_ALLOWED_ORIGINS = originalOrigins;
    if (originalEnv === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = originalEnv;
  });

  it("stays permissive in development when no allowlist is set", () => {
    // Requiring every contributor to configure CORS before the app works
    // would be friction with no security benefit on their own machine.
    delete process.env.CORS_ALLOWED_ORIGINS;
    process.env.APP_ENV = "development";
    expect(resolveCorsOptions().options.origin).toBe(true);
  });

  it("uses the exact allowlist when one is configured", () => {
    process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com,https://staging.example.com";
    process.env.APP_ENV = "production";
    expect(resolveCorsOptions().options.origin).toEqual(["https://app.example.com", "https://staging.example.com"]);
  });

  it("trims whitespace and ignores empty entries", () => {
    process.env.CORS_ALLOWED_ORIGINS = " https://a.example.com , , https://b.example.com ";
    expect(resolveCorsOptions().options.origin).toEqual(["https://a.example.com", "https://b.example.com"]);
  });

  it.each(["production", "staging"])("fails CLOSED in %s when the allowlist is missing", (env) => {
    // The whole point of the change is to stop reflecting arbitrary origins.
    // Silently falling back to permissive in a real environment would undo it
    // exactly when it matters, and a missing env var is a realistic mistake.
    delete process.env.CORS_ALLOWED_ORIGINS;
    process.env.APP_ENV = env;
    const { options, description } = resolveCorsOptions();
    expect(options.origin).toBe(false);
    expect(description).toMatch(/DENIED/);
  });

  it("exposes ETag, or manifest 304 caching would silently break", () => {
    // The browser cannot read a response header it isn't granted access to,
    // so omitting this would disable If-None-Match round-trips (§6.7).
    expect(resolveCorsOptions().options.exposedHeaders).toContain("ETag");
  });

  it("allows the headers the client actually sends", () => {
    const allowed = resolveCorsOptions().options.allowedHeaders as string[];
    expect(allowed).toEqual(expect.arrayContaining(["Content-Type", "Authorization", "If-None-Match"]));
  });
});
