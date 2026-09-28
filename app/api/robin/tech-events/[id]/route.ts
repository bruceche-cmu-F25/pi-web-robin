import { NextResponse } from "next/server";
import { techEventPage } from "@/extension/robin/tech-event-domain";
import { apiError, apiRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";

/** One event and its introduction; `?refresh=1` skips the day-long cache. */
export const GET = apiRoute(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  const result = await techEventPage(id, { refresh });
  if ("error" in result) return apiError(new Error(result.error), 404);
  return NextResponse.json(result);
}, { errorStatus: 500 });
