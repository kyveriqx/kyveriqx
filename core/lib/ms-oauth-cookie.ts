/* Shared cookie constants for the "Connect Microsoft" OAuth transaction.

   These live here (not in the route files) because a Next.js `route.ts` may
   only export HTTP handlers + a small set of config keys — exporting any other
   symbol fails `next build` (the typed-routes check). The start route sets the
   cookie; the callback route reads and clears it. */

/** httpOnly cookie holding the PKCE verifier + anti-CSRF state during sign-in. */
export const OAUTH_TX_COOKIE = "ms_oauth_tx";

/** Scope the cookie to the OAuth routes so it isn't sent on every request. */
export const OAUTH_TX_PATH = "/api/oauth/microsoft";
