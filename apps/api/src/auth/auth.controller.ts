import { BadRequestException, Body, Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import { z, ZodError } from "zod";
import { AuthService } from "./auth.service";
import { SignupSchema } from "./signup.schema";
import { JwtAuthGuard } from "../tenancy/jwt-auth.guard";
import { StrictThrottle } from "../throttling/throttle.config";
import { CurrentUserService } from "../tenancy/current-user.service";

// `.trim()` matters here specifically: this is a public, unauthenticated
// endpoint, so it can't rely on the frontend having already trimmed input
// (e.g. autofill/password-manager whitespace) before this exact-match
// lookup runs — see AuthService.verifyWorkspace.
const VerifyWorkspaceSchema = z.object({
  workspaceId: z.string().trim().min(1),
  email: z.string().trim().email(),
});

@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly currentUser: CurrentUserService,
  ) {}

  // Go-Live, Phase 04 — the tight unauthenticated bucket. Signup is both an
  // enumeration surface and the most expensive public operation in the app
  // (it provisions a whole tenant and creates a Supabase Auth user), so it
  // gets the strict limit rather than the generous global default.
  @StrictThrottle()
  @Post("signup")
  async signup(@Body() body: unknown) {
    let input;
    try {
      input = SignupSchema.parse(body);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.issues);
      }
      throw err;
    }
    return this.authService.signup(input);
  }

  // Public, unauthenticated — same precedent as /auth/signup. Called by the
  // login page before it ever attempts a Supabase sign-in (see
  // AuthService.verifyWorkspace for why this doesn't change how tenant_id
  // ends up in the JWT).
  // The login pre-flight check — a deliberate anti-enumeration surface
  // (§5.1: one generic rejection for every failure mode). Rate limiting is
  // the other half of that defence: a generic error still leaks information
  // if an attacker can try it thousands of times a minute.
  @StrictThrottle()
  @Post("verify-workspace")
  @HttpCode(200) // A verification check, not a creation — same reasoning as DataSourcesController.
  async verifyWorkspace(@Body() body: unknown) {
    let input;
    try {
      input = VerifyWorkspaceSchema.parse(body);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.issues);
      }
      throw err;
    }
    await this.authService.verifyWorkspace(input.workspaceId, input.email);
    return { valid: true };
  }

  // Deliberately a bespoke endpoint, not a generic mutation — needs to stay
  // reachable while `mustChangePassword` is still true, and the three
  // generic dispatch controllers (workspace/data/mutations) all reject that
  // case outright (see assertPasswordChanged). Only requires JwtAuthGuard;
  // the real password change already happened client-side via
  // supabase.auth.updateUser before this is ever called (AuthService.completeFirstLogin).
  @Post("complete-first-login")
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async completeFirstLogin() {
    const user = await this.currentUser.get();
    await this.authService.completeFirstLogin(user.tenantId, user.id);
    return { success: true };
  }
}
