import { NextResponse } from "next/server";
import { setTechEventFlags, techEventBoard } from "@/extension/robin/tech-event-domain";
import { apiError, apiRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";

/** The upcoming list plus its freshness; retention and the weekly sweep are the domain's. */
export const GET = apiRoute(async () => NextResponse.json(techEventBoard()));

/** Save an event, or hide it — the only two fields the browser may write. */
export const PATCH = apiRoute(async (req) => {
  const body = await req.json() as { id?: unknown; saved?: unknown; hidden?: unknown };
  if (typeof body.id !== "string" || !body.id) return apiError(new Error("id is required"));
  if (body.saved !== undefined && typeof body.saved !== "boolean") {
    return apiError(new Error("saved must be true or false"));
  }
  if (body.hidden !== undefined && typeof body.hidden !== "boolean") {
    return apiError(new Error("hidden must be true or false"));
  }

  const result = setTechEventFlags(body.id, {
    ...(typeof body.saved === "boolean" ? { saved: body.saved } : {}),
    ...(typeof body.hidden === "boolean" ? { hidden: body.hidden } : {}),
});
if ("error" in result) return apiError(new Error(result.error), 404);
return NextResponse.json({ event: result });
}, { errorStatus: 500 });
