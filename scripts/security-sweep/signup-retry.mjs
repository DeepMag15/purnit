/**
 * Tenant signup, retried.
 *
 * ⚠️ Not papering over a product bug. `/auth/signup` calls out to Supabase
 * Auth to create the admin user, and that call intermittently loses its race
 * with a 10s connect timeout from this machine:
 *
 *   ConnectTimeoutError: Connect Timeout Error
 *     (attempted address: <project>.supabase.co:443, timeout: 10000ms)
 *   ERROR [ExceptionsHandler] Error: Failed to create auth user: fetch failed
 *
 * The API answers 500 and the probe records a failure for a domain whose code
 * is fine — twice in two consecutive runs of the delivery-workflow probe, on
 * a different domain each time. A verification script that reports a network
 * blip as a product finding is worse than useless: it trains you to discount
 * its own red output.
 *
 * So: retry only what is genuinely transient, and let a real refusal through
 * on the first try. A 4xx is the server's considered answer and is returned
 * immediately; only a 5xx or a thrown fetch error is retried.
 */
/**
 * The same transience, one layer up: `user.invite` also creates a Supabase
 * auth user, so it fails the same way and just as randomly. `call` is the
 * caller's own mutation helper, so this stays agnostic about how each probe
 * talks to the API.
 */
export async function inviteWithRetry(call, token, body, { attempts = 4, baseDelayMs = 1500 } = {}) {
  let last = null;
  for (let i = 0; i < attempts; i++) {
    const r = await call(token, "user.invite", body);
    if (r.b?.temporaryPassword) return r;
    last = r;
    if (r.s < 500) break; // a considered refusal, not a blip
    if (i < attempts - 1) {
      const wait = baseDelayMs * 2 ** i;
      console.log(`        invite attempt ${i + 1} failed (${r.s}) — retrying in ${wait}ms`);
      await new Promise((res) => setTimeout(res, wait));
    }
  }
  return last;
}

export async function signupWithRetry(API, body, { attempts = 4, baseDelayMs = 1500 } = {}) {
  let last = { status: 0, body: null, error: null };
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(`${API}/auth/signup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      let parsed = null;
      try {
        parsed = await r.json();
      } catch {
        /* a 5xx can arrive with no JSON body at all */
      }
      if (parsed?.tenantId) return parsed;
      last = { status: r.status, body: parsed, error: null };
      // A 4xx means the server understood and refused — retrying cannot change
      // that answer, and hiding it behind three more attempts would mask a
      // real regression (a duplicate email, a bad industry, a seat cap).
      if (r.status < 500) break;
    } catch (e) {
      last = { status: 0, body: null, error: e };
    }
    if (i < attempts - 1) {
      const wait = baseDelayMs * 2 ** i;
      console.log(`        signup attempt ${i + 1} failed (${last.status || last.error?.cause?.code || "network"}) — retrying in ${wait}ms`);
      await new Promise((res) => setTimeout(res, wait));
    }
  }
  const why = last.error ? `${last.error.message} (${last.error.cause?.code ?? "?"})` : `HTTP ${last.status} ${JSON.stringify(last.body ?? {}).slice(0, 120)}`;
  console.log(`        signup gave up after ${attempts} attempts: ${why}`);
  return null;
}
