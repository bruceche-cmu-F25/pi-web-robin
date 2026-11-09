import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-route";
import { briefReadingView } from "@/extension/robin/brief-domain";
import { composeBrief } from "@/lib/brief-runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET never initializes storage or pays for generation. An explicit missing version never falls back. */
export const GET = apiRoute(req => {
  const id = new URL(req.url).searchParams.get("edition") ?? undefined;
  const view = briefReadingView(id);
  return NextResponse.json(view, { status: id && !view.edition ? 404 : 200, headers: { "Cache-Control": "private, no-store" } });
});
export const POST = apiRoute(async req => {
  const body = await req.json();
  if (body?.action !== "compose" || typeof body.requestId !== "string" || body.allowPrivateModel !== true) throw new Error("A stable request ID and explicit private-model consent are required");
  if (body.input !== undefined && body.input !== "stored" && body.input !== "gmail" && body.input !== "live") throw new Error("Invalid Brief input mode");
  if (body.requestId.startsWith("daily-brief:")) throw new Error("Scheduled Brief request IDs are reserved");
  const edition = await composeBrief(body.requestId, { allowPrivateModel: true, input: body.input, signal: req.signal });
  return NextResponse.json(briefReadingView(edition.id), { headers: { "Cache-Control": "private, no-store" } });
});
