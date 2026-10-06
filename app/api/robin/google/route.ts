import { setOutreachGoogleCredentials } from "@/extension/robin/settings";
import { patchJarvisOutbox } from "@/extension/robin/jarvis-domain";
import { NextResponse } from "next/server";
import { authorizeUrl, canSendGmail, connectedGoogleEmail, disconnect, isConnected, readCredentials } from "@/extension/robin/google-calendar";
// Next asserts that a route file exports nothing but handlers and a few config
// keys, so the handshake helpers this and the callback both need live outside.
import { issueState, redirectUriFor } from "@/lib/google-oauth-state";
import { apiRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (req) => {
  const account = new URL(req.url).searchParams.get("account") === "outreach" ? "outreach" : "primary";
  const configured = readCredentials(account) !== null;
  return NextResponse.json({
    configured,
    connected: configured && isConnected(account),
    canSendGmail: configured && canSendGmail(account),
    email: connectedGoogleEmail(account),
    redirectUri: redirectUriFor(req),
    ...(configured
      ? {}
      : { hint: account === "outreach" ? "Configure the Cold Reach Web application client below" : "Set ROBIN_GOOGLE_CLIENT_ID and ROBIN_GOOGLE_CLIENT_SECRET in .env.local" }),
  });
});

/** Starts the consent flow; the browser follows the returned URL. */
export const POST = apiRoute(async (req) => {
  try {
    const body = await req.json() as { action?: unknown; account?: unknown; clientId?: unknown; clientSecret?: unknown };
    if (body.account !== undefined && body.account !== "primary" && body.account !== "outreach") throw new Error("Unknown Google account destination");
    const account = body.account === "outreach" ? "outreach" : "primary";
    if (body.action === "configure" && account === "outreach") {
      if (setOutreachGoogleCredentials(body.clientId, body.clientSecret)) {
        patchJarvisOutbox({ enabled: false });
        disconnect("outreach");
      }
      return NextResponse.json({ configured: true });
    }
    if (body.action === "disconnect") {
      if (account === "outreach") patchJarvisOutbox({ enabled: false });
      disconnect(account);
      return NextResponse.json({ connected: false });
    }
    if (body.action !== "connect") {
      return NextResponse.json({ error: "action must be connect or disconnect" }, { status: 400 });
    }
    if (!readCredentials(account)) {
      return NextResponse.json({
        error: account === "outreach" ? "Save your Cold Reach Client ID and Client secret first" : "Google client credentials are not configured. Set them in Robin settings.",
      }, { status: 400 });
    }
    if (account === "outreach") patchJarvisOutbox({ enabled: false });
    const redirectUri = redirectUriFor(req);
    return NextResponse.json({ authorizeUrl: authorizeUrl(redirectUri, issueState(account, redirectUri), account) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
});
