import { NextResponse } from "next/server";
import {
  applySettingsSection,
  clearSettingsSection,
  detectTelegramChats,
  settingsView,
} from "@/extension/robin/settings";
import { apiError, apiRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";

/** Turn the domain's `{ error, status? }` into a response. */
function settled(result: { error: string; status?: number } | object): NextResponse {
  return "error" in result
    ? apiError(new Error((result as { error: string }).error), (result as { status?: number }).status)
    : NextResponse.json(result);
}

/**
 * Report configuration state — never the secrets themselves.
 *
 * The `describe*` helpers behind `settingsView()` return presence, origin and a
 * four-character tail. A secret that is never sent cannot leak through the
 * browser's memory, devtools, or a saved HAR.
 *
 * The redirect URI is assembled here rather than in the domain because it is
 * the one field that depends on the request's own origin.
 */
export const GET = apiRoute(async (req) => NextResponse.json({
  ...settingsView(),
  googleRedirectUri: new URL("/api/robin/google/callback", new URL(req.url).origin).toString(),
}));

export const POST = apiRoute(async (req) => {
  const body = await req.json() as { section?: unknown } & Record<string, unknown>;
  return settled(applySettingsSection(body.section, body));
});

export const DELETE = apiRoute(async (req) => {
  const body = await req.json() as { section?: unknown };
  return settled(clearSettingsSection(body.section));
});

/** One-shot Telegram chat-id discovery. */
export const PUT = apiRoute(async (req) => {
  const body = await req.json() as { action?: unknown };
  if (body.action !== "detectChatIds") return apiError(new Error("Unsupported action"));
  return settled(await detectTelegramChats());
});
