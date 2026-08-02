import { Injectable } from "@nestjs/common";
import { SignJWT } from "jose";

/**
 * Signs a Jitsi join JWT locally — no HTTP call, unlike DailyService (the
 * vendor this replaced), since self-hosted Jitsi has no "create a room"
 * REST step at all: a room exists implicitly the moment someone joins it.
 * Uses `jose`'s `SignJWT` (already a dependency — `jwt-verifier.service.ts`
 * uses the same package to *verify* Supabase JWTs; this is the same
 * library's signing half, no new dependency).
 *
 * Requires `JWT_APP_ID`/`JWT_APP_SECRET`, which must exactly match the same
 * two values in the separately downloaded `infra/jitsi/docker-jitsi-meet/.env`
 * — see `infra/jitsi/README.md`'s manual-sync warning. A mismatch produces
 * silent auth failures at the Jitsi server, not a clear error here.
 */
@Injectable()
export class JitsiService {
  private readonly appId = process.env.JWT_APP_ID ?? "";
  private readonly secret = new TextEncoder().encode(process.env.JWT_APP_SECRET ?? "");

  async createJoinToken(roomName: string, user: { id: string; name: string; email?: string }, options: { isModerator: boolean; exp: number }): Promise<string> {
    return new SignJWT({
      room: roomName,
      context: { user: { id: user.id, name: user.name, email: user.email ?? "", moderator: options.isModerator } },
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer(this.appId)
      .setAudience(this.appId)
      // "*" per the most common docker-jitsi-meet JWT setup — some configs
      // instead want the actual Jitsi domain here. Unverified against a live
      // server yet (Docker wasn't available in this environment); check
      // `docker compose logs prosody` first if joins are rejected.
      .setSubject("*")
      .setExpirationTime(options.exp)
      .sign(this.secret);
  }
}
