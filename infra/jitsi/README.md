# Self-hosted Jitsi Meet (local dev, temporary)

Antigravity's Meetings module uses this for video calls, for now, instead of a paid vendor. This is a deliberate, temporary stopgap — the plan is to swap to a properly hosted vendor once the platform is further along. See `CONTEXT.md`/`CHANGELOG.md` for the full "why."

**Real limitation, disclosed up front**: this runs locally via Docker Compose, not on a real internet-reachable server. Two browser sessions on this same machine can call each other. A real remote participant, on a different network, very likely cannot — Jitsi's media relay (JVB) needs a reachable UDP port and a public IP/TURN server, which a home machine behind NAT doesn't have. Don't use this for real cross-network meetings yet.

## What's here

```
infra/jitsi/
  README.md              <- this file
  setup.ps1               <- downloads the latest docker-jitsi-meet release (run once)
  .env.jitsi.sample       <- the config delta this project requires, for reference
  docker-jitsi-meet/      <- THIRD-PARTY, downloaded by setup.ps1, not authored here
```

`docker-jitsi-meet/` is a full copy of Jitsi's own official Docker Compose distribution — not something to hand-edit beyond the `.env` changes below, and not something to treat as part of this codebase. It's excluded from version control (see root `.gitignore`).

## Status (as of 2026-07-22, live-verified)

Docker is installed and the stack is up: `docker compose ps` shows all 4 containers (`prosody`, `jicofo`, `jvb`, `web`) healthy, no restarts, no errors in any container's logs. The generated Prosody config was read directly and confirmed to match this project's intended settings exactly (`authentication = "token"`, `app_id`/`app_secret` matching this repo's root `.env`, `asap_accepted_issuers`/`asap_accepted_audiences` set, `allow_empty_token = false`). `http://localhost:8000/` serves the real Jitsi Meet page (no redirect needed, see below).

A full backend-level pass ran the entire Meetings flow against this live server (throwaway tenant, scripted, cleaned up afterward): scheduling generates a real room name, `meeting.getJoinInfo` mints real signed tokens whose claims were decoded and checked (correct room, correct organizer-vs-participant `moderator` flag, `iss`/`aud` matching the deployed secret), visibility/notifications/cancel/cross-tenant-rejection all passed.

**What this does NOT prove, and no tool in this environment can**: that Jitsi's server actually *accepts* a valid token and *rejects* an invalid one when a real client connects (that happens over the XMPP/WebRTC wire protocol, at the MUC-room-join step — verifying it correctly requires either a real browser or a hand-built XMPP client faithful enough to Jitsi's exact handshake to trust its result, which this environment has neither), and nothing about real audio/video or the visual moderator UI. See "Manual verification" below — it's short.

## Setup (one-time, already done)

1. **Install Docker Desktop** if you don't have it — this whole approach depends on it. ✅ Done.

2. **Download docker-jitsi-meet**:
   ```powershell
   .\infra\jitsi\setup.ps1
   ```
   Already run once as of this writing — `infra/jitsi/docker-jitsi-meet/` exists. Delete that folder and re-run if you ever need a fresh copy.

3. **`.env` already configured** (`infra/jitsi/docker-jitsi-meet/.env`, copied from `env.example` + `gen-passwords.sh` run for the internal service passwords + JWT auth enabled). If you ever need to regenerate it from scratch, see `.env.jitsi.sample` in this directory for the exact delta to apply on top of a fresh `env.example`.

4. **⚠️ Manual sync point, no automation exists**: `JWT_APP_ID`/`JWT_APP_SECRET` in `infra/jitsi/docker-jitsi-meet/.env` must *exactly* match the same two keys in this repo's own root `.env` (used by `apps/api/src/integrations/jitsi.service.ts` to sign join tokens). They're already set to matching values as of this writing (`JWT_APP_ID=antigravity-dev`). If you ever regenerate the secret, update **both** files — a mismatch produces silent auth failures with no clear error message, not a loud one.

5. **Start it**:
   ```powershell
   cd infra\jitsi\docker-jitsi-meet
   docker compose up -d
   ```
   (or `docker-compose up -d`, depending on your Docker Desktop version.)

6. **⚠️ Config-regeneration trap**: the generated Prosody/web config under `.jitsi-meet-cfg/` is *not* regenerated on a plain container restart after an `.env` edit. If you ever change `JWT_APP_ID`/`JWT_APP_SECRET` after the first boot:
   ```powershell
   docker compose down
   Remove-Item -Recurse -Force .jitsi-meet-cfg
   # recreate the empty subdirectories: web, transcripts, prosody/config, prosody/prosody-plugins-custom, jicofo, jvb
   docker compose up -d
   ```
   Otherwise the server keeps enforcing the *old* secret and every new token silently fails.

7. **Verify**:
   ```powershell
   docker compose ps          # everything healthy
   docker compose logs prosody   # no auth errors — the first place to look if JWT auth misbehaves
   ```

## Networking: HTTP vs HTTPS

`env.example`'s own comment claims plain HTTP (`:8000`) "will redirect to HTTPS port" — **verified live that this default setup does not actually do that**: `curl http://localhost:8000/` returns `200 OK` with the real Jitsi Meet page directly, no `Location` header. `localhost` is always a browser-trusted secure context regardless of scheme, so `getUserMedia` (camera/mic) works fine over plain HTTP here. `NEXT_PUBLIC_JITSI_DOMAIN=localhost:8000` — no self-signed certificate warning to deal with. Use `:8443` only if you have a specific reason to need HTTPS.

## Known friction areas (real, not hypothetical — budget real debugging time)

- **JWT auth setup has a documented history of friction** on docker-jitsi-meet (multiple multi-day community-forum threads). If a join fails, decode the minted token first (fast, no browser needed) and check `docker compose logs prosody` before assuming the app code is wrong.
- **Moderator-flag placement** (`context.user.moderator` in the JWT) has known version-dependent quirks — verify the organizer actually gets moderator controls in Jitsi's own UI, not just that their token was accepted.

## Manual verification (needs a real browser — the one thing not done yet)

Everything above is confirmed. This is the short remaining checklist — should take under 5 minutes:

1. Both dev servers running (`pnpm --filter @antigravity/api run dev`, `pnpm --filter @antigravity/web run dev`) and the Jitsi containers up (`docker compose ps` from `infra/jitsi/docker-jitsi-meet/`).
2. Open **http://localhost:3000**, log in, go to **Meetings**, click **Start now** (or schedule one inviting a second real or throwaway user).
3. Click **Join** — confirm the call view fills the screen, the browser prompts for camera/mic permission, and the Jitsi call UI actually renders (not a blank frame or an error page).
4. Open a **second browser** (or a private/incognito window — needs to be a genuinely separate session so it gets its own camera/mic prompt) as the invited participant, and join the same meeting the same way.
5. Confirm both windows can **see and hear each other** — this is the one thing that proves real media flow, not just "the UI loaded."
6. Confirm the **organizer** (whoever clicked "Start now"/scheduled it) has moderator controls in Jitsi's own UI (e.g. can mute others / has admin-looking options) and the **participant** does not — this is what the `context.user.moderator` JWT claim is supposed to control.
7. **Unauthorized-access check**: in the organizer's browser, open Jitsi's dev tools → Network tab, find the room name being used (or just note it from step 2's meeting), then in a fresh incognito tab go directly to `http://localhost:8000/<room-name>` with no token at all. Expect to be blocked/asked to authenticate, not dropped straight into the call — this confirms `ENABLE_GUESTS=0` + JWT auth is actually enforced by Jitsi itself, not just hidden behind our own app's UI.

If any of these fail, the debugging starting points are: `docker compose logs prosody`/`jicofo` (auth issues), the browser console (client-side errors), and re-confirming `NEXT_PUBLIC_JITSI_DOMAIN` matches what's actually running.
