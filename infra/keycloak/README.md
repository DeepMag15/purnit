# Enterprise SSO — self-hosted Keycloak broker

Supabase's own native Enterprise SSO isn't available on this project's
Supabase tier. Rather than wait on upgrading, Enterprise SSO is brokered
through a self-hosted [Keycloak](https://www.keycloak.org/) realm instead —
genuinely Apache 2.0, free, self-hosted, chosen over Zitadel (SAML support
is IdP-only, can't broker a customer's own upstream SAML IdP — the one
thing needed here) and Authentik (multi-tenancy isn't a core, proven
feature). See `CONTEXT.md`'s Enterprise SSO section for the full comparison.

The app only ever speaks OIDC to Keycloak (`apps/api/src/sso/`). Keycloak
itself absorbs all SAML complexity as its own upstream Identity Provider
configuration, per tenant — this codebase never touches SAML/XML directly.

## Local dev setup

1. `docker compose up -d` from this directory. First boot takes ~30s.
2. Set these in the repo root `.env` (see `.env.example`'s own Enterprise
   SSO block for the full explanation of each):
   ```
   KEYCLOAK_ISSUER_URL=http://localhost:8081/realms/purnit
   KEYCLOAK_CLIENT_ID=purnit-api
   KEYCLOAK_CLIENT_SECRET=dev-secret-change-me
   SSO_STATE_SECRET=<any long random string>
   API_BASE_URL=http://localhost:4000
   ```
3. Restart the API dev server so it picks up the new env vars.

`realm-purnit.json` is auto-imported on first boot (`--import-realm` in
`docker-compose.yml`) — it pre-creates:
- The `purnit` realm.
- A confidential OIDC client `purnit-api` (secret `dev-secret-change-me`),
  redirect URI `http://localhost:4000/auth/sso/callback`.
- One Keycloak-local test user (`ssotest` / `ssotest@example.com` /
  `SsoTest123!`, email pre-verified) — enough to prove the whole broker →
  JIT-provisioning → Supabase-session-federation round trip end to end
  without needing a real corporate IdP account (see the root CHANGELOG.md
  for exactly what this proves and what it deliberately doesn't).

Keycloak's own admin console is at `http://localhost:8081` (`admin` /
`admin`, this compose file's own dev-only default — see disclosed
limitations below).

## Onboarding a real tenant

1. In Settings → Enterprise SSO (Admin-only), enable SSO and save — this
   generates a stable, unique `idp-<tenantId>` alias, shown read-only with a
   copy button. This value is never admin-typed (see `sso.prisma`'s own doc
   comment on why: Identity Provider aliases are globally unique within one
   shared Keycloak realm, and an admin-typed alias would let one tenant
   accidentally — or deliberately — point their SSO button at a different
   tenant's real corporate IdP).
2. In Keycloak's Admin Console → your realm → Identity Providers → Add
   provider, create either a SAML 2.0 or OIDC provider using **that exact
   alias**, configured with the tenant's own IdP metadata (their Okta/Azure
   AD/OneLogin SAML metadata XML, or an OIDC discovery URL + client
   credentials). This is the one manual step this codebase doesn't
   automate — same category as Stripe Billing needing a Product/Price
   created by hand in the Stripe Dashboard.
3. Confirm the realm's browser authentication flow includes the **Identity
   Provider Redirector** authenticator (Authentication → Browser flow) —
   this is what makes `?kc_idp_hint=<alias>` actually skip Keycloak's own
   login/picker screen and jump straight to the tenant's upstream IdP. Most
   default realms have this already; verify, don't assume.
4. Set a default role for newly-provisioned SSO sign-ins in the same
   Settings card — required while SSO is enabled; sign-ins are rejected
   with a clear error until one is set (fail closed, not open).

## Disclosed limitations — local dev only, not production-hardened

- `start-dev` mode, the embedded H2 database, no TLS, and the `admin`/`admin`
  console credentials are all fine for local development and are exactly
  what the pre-seeded realm's live-verification pass exercises — none of it
  is suitable for a real deployment as-is.
- A real deployment needs: `start` (not `start-dev`), a real Postgres-backed
  database (Keycloak supports connecting to the same Supabase Postgres
  instance or a separate one), TLS in front of it, and rotating both the
  admin console password and the `purnit-api` client secret away from this
  repo's checked-in dev defaults. Deploying Keycloak to real infrastructure
  (a VPS, Fly.io, Railway, etc.) is the user's own step, same as this
  project's Jitsi self-hosting setup before it.
