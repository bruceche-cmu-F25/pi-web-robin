/**
 * The shared shape of a JSON API route.
 *
 * Seventeen routes had each written their own `guard()` and `fail()`, which is
 * seventeen places that had to remember the same four facts: that an untrusted
 * request is 403, that a write without a JSON content type is 415, that a
 * thrown error becomes 400 unless it is a read, and what the error body looks
 * like. Seventeen chances to get one of them wrong, and nothing to notice if
 * a new route simply forgot.
 *
 * `apiRoute` owns all four. A handler writes only the path that succeeds, plus
 * whatever status codes are its own business (a 404 for an id that is not
 * there), and returns a `NextResponse` as before.
 *
 * This is defence in depth, not the only defence: `proxy.ts` already runs the
 * same origin check over every `/api/*` request. Keeping it here too means a
 * route is still safe if it is ever mounted somewhere the proxy does not
 * match.
 */
import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "./request-security";

export interface ApiRouteOptions {
  /**
   * Require `Content-Type: application/json`. Defaults to true for every
   * method that carries a body, which is every one except GET and HEAD — a
   * cross-site form post reaches a write that does not check.
   */
  json?: boolean;
  /**
   * Status for an error the handler threw rather than returned.
   *
   * Defaults by method for the same reason `json` does: a read that throws got
   * there without any input from the caller, so it is the server's fault (500),
   * while a write that throws is usually a malformed body (400). Pass this only
   * where the method is a poor guide — a GET whose query string can be wrong.
   */
  errorStatus?: number;
}

/** The one error-response shape. */
export function apiError(error: unknown, status = 400): NextResponse {
  return NextResponse.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status },
  );
}

/**
 * Reject an untrusted or wrongly-typed request; null means it may proceed.
 *
 * Exported for the handful of routes that cannot use `apiRoute` because they
 * return a stream or a non-JSON body.
 */
export function guardApiRequest(req: Request, options: { json?: boolean } = {}): NextResponse | null {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (options.json && !hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  return null;
}

type RouteHandler<Context> = (req: Request, context: Context) => Promise<NextResponse> | NextResponse;

/**
 * Wrap a route handler in the guard and the error shape.
 *
 * ```ts
 * export const GET = apiRoute(async () => NextResponse.json(listTodos()), { errorStatus: 500 });
 * ```
 *
 * The second argument is passed straight through, so a dynamic segment's
 * `{ params }` reaches the handler untouched.
 */
export function apiRoute<Context = unknown>(
  handler: RouteHandler<Context>,
  options: ApiRouteOptions = {},
): (req: Request, context: Context) => Promise<NextResponse> {
  return async (req, context) => {
    const isRead = ["GET", "HEAD"].includes(req.method.toUpperCase());
    const blocked = guardApiRequest(req, { json: options.json ?? !isRead });
    if (blocked) return blocked;
    try {
      return await handler(req, context);
    } catch (error) {
      return apiError(error, options.errorStatus ?? (isRead ? 500 : 400));
    }
  };
}
