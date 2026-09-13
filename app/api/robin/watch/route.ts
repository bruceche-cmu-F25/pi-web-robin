import { NextResponse } from "next/server";
import { setWatched, watchSnapshot } from "@/extension/robin/watch-domain";
import { WATCH_ITEM_IDS } from "@/extension/robin/watch";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  try {
    return NextResponse.json(watchSnapshot());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  if (!hasJsonContentType(req)) return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body.item !== "string" || typeof body.watched !== "boolean") {
    return NextResponse.json({ error: "item and watched are required" }, { status: 400 });
  }
  if (!WATCH_ITEM_IDS.has(body.item)) {
    return NextResponse.json({ error: "Unknown lecture" }, { status: 404 });
  }
  try {
    setWatched(body.item, body.watched);
    return NextResponse.json(watchSnapshot());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
