import { NextResponse } from "next/server";
import { setWatched, watchSnapshot } from "@/extension/robin/watch-domain";
import { WATCH_ITEM_IDS } from "@/extension/robin/watch";
import { apiRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async () => NextResponse.json(watchSnapshot()));

export const PATCH = apiRoute(async (req) => {
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
  setWatched(body.item, body.watched);
  return NextResponse.json(watchSnapshot());
}, { errorStatus: 500 });
