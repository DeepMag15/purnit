# Self-hosted Jitsi Meet (local dev, temporary)

Purnit's Meetings module uses this for video calls, for now, instead of a paid vendor. This is a deliberate, temporary stopgap — the plan is to swap to a properly hosted vendor once the platform is further along. See `CONTEXT.md`/`CHANGELOG.md` for the full "why."

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

**⚠️ Update (2026-08-03): a real frontend bug was found and fixed** — see the `@jitsi/react-sdk` hardcoded-`https://` entry under "Known friction areas" below; a new `NEXT_PUBLIC_JITSI_PROTOCOL` env var is now required. **The Docker containers themselves were found stopped** (Docker Desktop hadn't been running), and restarting them hit a separate, unrelated blocker: the Windows drive backing Docker Desktop's data disk had **zero free space**, which fails container creation with an opaque `overlayfs`/`metadata.db` I/O error (see the disk-space entry below) — not something retrying `docker compose up` fixes. **The stack is not currently confirmed running** — free disk space (or relocate Docker Desktop's disk image to a drive with room) and re-run `docker compose up -d` from `infra/jitsi/docker-jitsi-meet/`, then re-verify against the checklist below.

**⚠️ Update (2026-08-04): root cause of the above found, fixed, and mitigated.** The disk-full incident hadn't just blocked *new* container creation — it had silently left **zero-byte core binaries** inside the already-cached `jitsi/web`, `jitsi/jicofo`, and `jitsi/jvb` images (`/usr/sbin/nginx`, `jicofo.sh`, `jvb.sh` all truncated to 0 bytes; `prosody`'s image was unaffected, which is exactly why it was the one container that stayed up during the original incident). This produced a misleading `exec format error` — architecture matched (`linux/amd64` host and image both), so it looked unrelated to the disk issue until the binaries themselves were inspected directly (`ls -la` inside a throwaway container). **Fixed** by removing the three corrupted images and re-pulling clean copies (`docker rmi ...` then `docker compose pull`) — all four containers verified healthy afterward (no restarts, jicofo/jvb correctly joined Prosody's MUC, `:8000` and `:8000/external_api.js` both `200`). **Mitigated** by relocating Docker Desktop's entire WSL2 data disk off the constrained `C:` drive — see `docs/DEVELOPMENT.md`'s "Docker storage location" section for the how/why; this doesn't guarantee `C:` can never fill up again, but removes the specific drive that was actually exhausted.

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
- **⚠️ `@jitsi/react-sdk`'s own `external_api.js` loader hardcodes `https://`, with no override — a real bug found and fixed, not hypothetical.** Confirmed by reading its source (`node_modules/@jitsi/react-sdk/lib/init.js`): `loadExternalApi` builds `script.src = \`https://${domain}/external_api.js\`` unconditionally; `IMeetingProps` has no `protocol`/scheme option at all. Since this project's dev Jitsi deliberately runs plain HTTP on `:8000` (see the networking note above), that hardcoded HTTPS request fails outright — nothing listens for TLS on `:8000` — and `JitsiMeeting` never mounts. **Fixed in `JitsiCallFrame.tsx`**: `loadExternalApi` checks `window.JitsiMeetExternalAPI` first and skips its own fetch if already present, so the component now preloads the script itself (a plain `<script>` tag, correct protocol) before ever rendering `<JitsiMeeting>`, gated behind a small loading/error state. The protocol is now a separate env var, **`NEXT_PUBLIC_JITSI_PROTOCOL`** (`http` for this local dev setup; set to `https` once a real hosted vendor replaces it — no further code change needed then).
- **Docker container creation can fail with `commit failed: write .../overlayfs/metadata.db: input/output error`** if the Windows drive backing Docker Desktop's WSL2 data disk is out of free space — a real failure mode hit during this project's own debugging, not hypothetical, and easy to misdiagnose as a Jitsi-specific problem when it's actually host disk exhaustion. **Worse, and non-obvious: the same disk-full condition can silently corrupt *already-cached* image layers into zero-byte binaries** (confirmed here — see the 2026-08-04 update above), which then fails later with a completely different, misleading symptom (`exec format error`) that looks unrelated to disk space entirely. If any container in this stack fails to start with `exec format error` despite the image architecture matching the host, don't assume it's a Jitsi/config problem — inspect the actual binary inside the image first (`docker run --rm --entrypoint /bin/bash <image> -c "ls -la <path-to-binary>"`) before debugging anything else; a 0-byte file means the image needs `docker rmi` + a fresh `docker compose pull`, not a config fix. Docker Desktop's data disk lives at `%LOCALAPPDATA%\Docker\wsl\disk\docker_data.vhdx` by default (a dynamically-expanding VHDX — it needs free space on its *host* drive to grow, regardless of how much space is configured/allocated to it); **as of 2026-08-04 this project's dev machine has that disk relocated off `C:` via an NTFS junction** (no in-app "Disk image location" setting was found in this Docker Desktop version's containerd-snapshotter backend — see `docs/DEVELOPMENT.md`'s "Docker storage location" section for the exact steps and why the junction approach was used instead). Check `Get-PSDrive -PSProvider FileSystem` for free space on whichever drive the junction/disk actually resolves to before assuming the compose config or the images themselves are at fault; a `docker compose down && docker compose up -d` retry will not fix either failure mode — only freeing host disk space (and, if corruption already happened, re-pulling the affected images) will.

## Manual verification (needs a real browser — the one thing not done yet)

Everything above is confirmed. This is the short remaining checklist — should take under 5 minutes:

1. Both dev servers running (`pnpm --filter @purnit/api run dev`, `pnpm --filter @purnit/web run dev`) and the Jitsi containers up (`docker compose ps` from `infra/jitsi/docker-jitsi-meet/`).
2. Open **http://localhost:3000**, log in, go to **Meetings**, click **Start now** (or schedule one inviting a second real or throwaway user).
3. Click **Join** — confirm the call view fills the screen, the browser prompts for camera/mic permission, and the Jitsi call UI actually renders (not a blank frame or an error page).
4. Open a **second browser** (or a private/incognito window — needs to be a genuinely separate session so it gets its own camera/mic prompt) as the invited participant, and join the same meeting the same way.
5. Confirm both windows can **see and hear each other** — this is the one thing that proves real media flow, not just "the UI loaded."
6. Confirm the **organizer** (whoever clicked "Start now"/scheduled it) has moderator controls in Jitsi's own UI (e.g. can mute others / has admin-looking options) and the **participant** does not — this is what the `context.user.moderator` JWT claim is supposed to control.
7. **Unauthorized-access check**: in the organizer's browser, open Jitsi's dev tools → Network tab, find the room name being used (or just note it from step 2's meeting), then in a fresh incognito tab go directly to `http://localhost:8000/<room-name>` with no token at all. Expect to be blocked/asked to authenticate, not dropped straight into the call — this confirms `ENABLE_GUESTS=0` + JWT auth is actually enforced by Jitsi itself, not just hidden behind our own app's UI.

If any of these fail, the debugging starting points are: `docker compose logs prosody`/`jicofo` (auth issues), the browser console (client-side errors), and re-confirming `NEXT_PUBLIC_JITSI_DOMAIN` matches what's actually running.
