import { Controller, Get, Headers, NotFoundException, Param, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { JwtAuthGuard } from "../tenancy/jwt-auth.guard";
import { CurrentUserService } from "../tenancy/current-user.service";
import { assertPasswordChanged } from "../tenancy/assert-password-changed";
import { ConfigEngineService } from "../config-engine/compiler.service";
import { etagMatches } from "../config-engine/etag";

/**
 * The real workspace delivery API, per ARCHITECTURE.md §6.7. Replaces Stage
 * 4's temporary `GET /me/workspace` verification route.
 */
@Controller("api/workspace")
@UseGuards(JwtAuthGuard)
export class WorkspaceController {
  constructor(
    private readonly currentUser: CurrentUserService,
    private readonly configEngine: ConfigEngineService,
  ) {}

  /** Eager: shell + navigation + branding + featureFlags + default dashboard page. */
  @Get("bootstrap")
  async bootstrap(@Headers("if-none-match") ifNoneMatch: string | undefined, @Res() res: Response) {
    const user = await this.currentUser.get();
    assertPasswordChanged(user);
    const compilerUser = { id: user.id, displayName: user.displayName };

    // Performance-audit consolidation (CONTEXT.md §47): identity is now
    // resolved exactly once per request — `getIdentity()` already carries
    // the etag, so a cache-hit needs no further work, and a cache-miss
    // passes this same `identity` into `compileWorkspace` instead of it
    // re-resolving identity from scratch a second time.
    const identity = await this.configEngine.getIdentity(user.tenantId, compilerUser);
    res.setHeader("ETag", `"${identity.etag}"`);
    res.setHeader("Cache-Control", "private, no-cache");
    if (etagMatches(ifNoneMatch, identity.etag)) {
      // Full manual control (@Res() without passthrough), not
      // @Res({ passthrough: true }) — a bare `return;` after manually ending
      // the response there let Nest's own response pipeline *also* try to
      // send the (undefined) result afterward, throwing ERR_HTTP_HEADERS_SENT
      // on any second/repeat request matching the same etag (React
      // StrictMode's double-effect-invocation in dev makes this the common
      // case, not a rare one — found live via a hung fetch with zero visible
      // network completion, not by inspection). Taking full manual control
      // for both branches removes the ambiguity entirely.
      res.status(304).end();
      return;
    }

    const manifest = await this.configEngine.compileWorkspace(identity);
    res.json(manifest);
  }

  /** Lazy: a single page's tree, fetched on navigation. */
  @Get("pages/:pageId")
  async page(@Param("pageId") pageId: string, @Headers("if-none-match") ifNoneMatch: string | undefined, @Res() res: Response) {
    const user = await this.currentUser.get();
    assertPasswordChanged(user);
    const compilerUser = { id: user.id, displayName: user.displayName };

    // See the matching comment in bootstrap() above.
    const identity = await this.configEngine.getIdentity(user.tenantId, compilerUser);
    res.setHeader("ETag", `"${identity.etag}"`);
    res.setHeader("Cache-Control", "private, no-cache");
    if (etagMatches(ifNoneMatch, identity.etag)) {
      res.status(304).end();
      return;
    }

    const result = await this.configEngine.compilePage(identity, pageId);
    if (!result) {
      // Same page whether the id never existed or was pruned for this user —
      // the client cannot distinguish "doesn't exist" from "you can't see it".
      throw new NotFoundException(`No page "${pageId}"`);
    }
    res.json(result.page);
  }
}
