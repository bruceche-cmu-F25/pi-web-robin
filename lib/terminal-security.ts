import { isIP } from "node:net";
import { hasJsonContentType, isApiRequestAllowed } from "./request-security.ts";
import {
  isValidBasicAuthorization,
  isValidWebSessionToken,
  isWebPasswordEnabled,
  PI_WEB_SESSION_COOKIE,
} from "./web-auth.ts";

export interface TerminalAccessError {
  error: string;
  status: number;
}

function requestHostname(request: Request): string | null {
  const host = request.headers.get("host");
  if (!host || /[\s/@\\]/.test(host)) return null;
  try {
    return new URL(`http://${host}`).hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  } catch {
    return null;
  }
}

function readCookie(request: Request, name: string): string | undefined {
  for (const part of request.headers.get("cookie")?.split(";") ?? []) {
    const separator = part.indexOf("=");
    if (separator !== -1 && part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return undefined;
}

export function isLoopbackTerminalRequest(request: Request): boolean {
  const hostname = requestHostname(request);
  if (!hostname) return false;
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "::1") return true;
  if (hostname.startsWith("::ffff:")) return hostname.slice(7).startsWith("127.");
  return isIP(hostname) === 4 && hostname.startsWith("127.");
}

/**
 * Terminal routes deliberately use a stricter policy than the rest of Pi Web:
 * authenticated loopback requests only. A PTY is equivalent to local
 * code execution, so LAN access remains disabled even when ordinary UI access
 * is enabled there.
 */
export function getTerminalAccessError(
  request: Request,
  options: { requireJson?: boolean } = {},
): TerminalAccessError | null {
  if (!isApiRequestAllowed(request)) {
    return { error: "Untrusted terminal request", status: 403 };
  }
  if (!isLoopbackTerminalRequest(request)) {
    return { error: "Interactive terminals are available on loopback only", status: 403 };
  }
  if (!isWebPasswordEnabled()) {
    return { error: "Set PI_WEB_PASSWORD before enabling interactive terminals", status: 503 };
  }
  if (
    !isValidWebSessionToken(readCookie(request, PI_WEB_SESSION_COOKIE))
    && !isValidBasicAuthorization(request.headers.get("authorization"))
  ) {
    return { error: "Authentication required", status: 401 };
  }
  if (options.requireJson && !hasJsonContentType(request)) {
    return { error: "Content-Type must be application/json", status: 415 };
  }
  return null;
}
