import { NextResponse } from "next/server";
import { createMindmap, deleteMindmap, listMindmaps, mutateMindmap, readMindmap, readMindmapExplanation } from "@/extension/robin/mindmap-domain";
import { MAX_MAP_BODY, mapObject, MindmapError } from "@/extension/robin/mindmap";
import { apiRoute } from "@/lib/api-route";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";

export const dynamic = "force-dynamic";
const route = (handler: (req: Request) => Promise<NextResponse> | NextResponse) => apiRoute(async (req) => {
  try { return await handler(req); }
  catch (error) {
    if (error instanceof MindmapError || error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: error.message }, { status: error instanceof MindmapError ? error.status : 413 });
    throw error;
  }
});
const body = async (req: Request) => mapObject(await parseJsonWithinLimit(req, MAX_MAP_BODY));
export const GET = route((req) => {
  const params = new URL(req.url).searchParams, id = params.get("id"), node = params.get("explanation");
  if (node !== null) return NextResponse.json(readMindmapExplanation(id, node));
  return NextResponse.json(id ? { map: readMindmap(id) } : { maps: listMindmaps() });
});
export const POST = route(async (req) => {
  const input = await body(req);
  return NextResponse.json({ map: createMindmap(input.id, input.root) }, { status: 201 });
});
export const PATCH = route(async (req) => NextResponse.json({ map: mutateMindmap(await body(req)) }));
export const DELETE = route(async (req) => {
  const input = await body(req); deleteMindmap(input.id, input.revision);
  return NextResponse.json({ deleted: true });
});
