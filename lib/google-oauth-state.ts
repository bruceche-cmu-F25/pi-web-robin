/**
 * The short-lived pieces of the Google OAuth handshake, shared by the two
 * routes that make up one round trip.
 *
 * They lived in `app/api/robin/google/route.ts` and were imported from the
 * callback next door, which reads naturally and does not build: Next generates
 * a type for every route file asserting that it exports nothing but handlers
 * and a small set of config keys, so a helper alongside them fails the
 * production type check even though it works in dev.
 */
import type { GoogleAccount } from "../extension/robin/google-calendar.ts";
import { randomBytes } from "node:crypto";
import { isApiRequestOriginAllowed } from "./request-security.ts";

/** Abandoned authorize attempts should not accumulate. */
const STATE_TTL_MS = 10 * 60_000;

/**
 * The OAuth `state` nonces, held in memory only.
 *
 * globalThis rather than a module constant so the set survives Next's dev hot
 * reload, matching how pi-web keeps its own cross-reload state. A restart
 * forgets them, which only costs an in-flight authorize its round trip.
 */
interface OAuthState { account: GoogleAccount; redirectUri?: string }
const stateStore = ((globalThis as { __robinGoogleOAuthStates?: Map<string, OAuthState> }).__robinGoogleOAuthStates ??= new Map<string, OAuthState>());

export function issueState(account: GoogleAccount = "primary", redirectUri?: string): string {
  const state = randomBytes(16).toString("hex");
  stateStore.set(state, { account, redirectUri });
  setTimeout(() => stateStore.delete(state), STATE_TTL_MS).unref?.();
  return state;
}

/** The server-issued nonce binds the destination account; query parameters cannot override it. */
export function consumeOAuthState(state: string): OAuthState | null {
  const saved = stateStore.get(state) ?? null;
  stateStore.delete(state);
  return saved;
}
export function consumeAccountState(state: string): GoogleAccount | null {
  return consumeOAuthState(state)?.account ?? null;
}
export function consumeState(state: string): boolean {
  return consumeAccountState(state) !== null;
}

/** The redirect must match what is registered in the Google client exactly. */
export function redirectUriFor(req: Request): string {
  const requestUrl = new URL(req.url);
  let origin = requestUrl.origin;
  // A same-origin relay can rewrite the request scheme. Prefer the validated
  // browser Origin, but never accept another host/port as a callback target.
  const browserOrigin = req.headers.get("origin");
  if (browserOrigin && isApiRequestOriginAllowed(req)) {
    try {
      const browserUrl = new URL(browserOrigin);
      if (["http:", "https:"].includes(browserUrl.protocol) && browserUrl.host === (req.headers.get("host") ?? requestUrl.host)) origin = browserUrl.origin;
    } catch { /* Malformed origins cannot change the redirect. */ }
  }
  return new URL("/api/robin/google/callback", origin).toString();
}
