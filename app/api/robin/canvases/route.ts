import { NextResponse } from "next/server";
import { CanvasError, createCanvas, deleteCanvas, listCanvases, readCanvas, saveCanvas } from "@/extension/robin/canvas-domain";
import { MAX_CANVAS_BYTES } from "@/extension/robin/canvas";
import { clearNotesAgentSession } from "@/extension/robin/notes-agent-state";
import { apiRoute } from "@/lib/api-route";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";

export const dynamic = "force-dynamic";
const route = (handler: (req: Request) => Promise<NextResponse> | NextResponse) => apiRoute(async (req) => {
  try { return await handler(req); }
  catch (error) {
    if (error instanceof CanvasError || error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: error.message }, { status: error instanceof CanvasError ? error.status : 413 });
    throw error;
  }
});
const body = (req: Request) => parseJsonWithinLimit<Record<string, unknown>>(req, req.method === "PATCH" ? MAX_CANVAS_BYTES + 4096 : 4096);

export const GET = route((req) => {
  const id = new URL(req.url).searchParams.get("id");
  return NextResponse.json(id ? { canvas: readCanvas(id) } : { canvases: listCanvases() });
});
export const POST = route(async (req) => NextResponse.json({ canvas: createCanvas((await body(req)).title) }, { status: 201 }));
export const PATCH = route(async (req) => {
  const input = await body(req);
  return NextResponse.json({ canvas: saveCanvas(input.id, input.revision, input) });
});
export const DELETE = route(async (req) => {
  const input = await body(req);
  deleteCanvas(input.id, input.revision);
  clearNotesAgentSession(`canvas:${input.id}`);
  return NextResponse.json({ deleted: true });
});
