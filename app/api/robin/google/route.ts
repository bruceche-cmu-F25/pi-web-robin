import { NextResponse } from "next/server";
import { authorizeUrl, disconnect, isConnected, readCredentials } from "@/extension/robin/google-calendar";
// Next asserts that a route file exports nothing but handlers and a few config
// keys, so the handshake helpers this and the callback both need live outside.
import { issueState, redirectUriFor } from "@/lib/google-oauth-state";
import { apiRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (req) => {
  const configured = readCredentials() !== null;
  return NextResponse.json({
    configured,
    connected: configured && isConnected(),
    redirectUri: redirectUriFor(req),
    ...(configured
      ? {}
      : { hint: "Set ROBIN_GOOGLE_CLIENT_ID and ROBIN_GOOGLE_CLIENT_SECRET in .env.local" }),
  });
});

/** Starts the consent flow; the browser follows the returned URL. */
export const POST = apiRoute(async (req) => {
  try {
    const body = await req.json() as { action?: unknown };
    if (body.action === "disconnect") {
      disconnect();
      return NextResponse.json({ connected: false });
    }
    if (body.action !== "connect") {
      return NextResponse.json({ error: "action must be connect or disconnect" }, { status: 400 });
    }
    if (!readCredentials()) {
      return NextResponse.json({
        error: "Google client credentials are not configured. "
          + "Set ROBIN_GOOGLE_CLIENT_ID and ROBIN_GOOGLE_CLIENT_SECRET in .env.local and restart.",
      }, { status: 400 });
    }
    return NextResponse.json({ authorizeUrl: authorizeUrl(redirectUriFor(req), issueState()) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
});
