import { NextResponse } from "next/server";
import { CanvasError, readCanvasAssetLibrary, saveCanvasAssetLibrary } from "@/extension/robin/canvas-domain";
import { MAX_CANVAS_BYTES } from "@/extension/robin/canvas";
import { apiRoute } from "@/lib/api-route";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";

export const dynamic = "force-dynamic";
export const GET = apiRoute(() => NextResponse.json(readCanvasAssetLibrary()));
export const PUT = apiRoute(async (req) => {
  try {
    const input = await parseJsonWithinLimit<Record<string, unknown>>(req, MAX_CANVAS_BYTES + 4096);
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new CanvasError("Invalid library document");
    return NextResponse.json(saveCanvasAssetLibrary(input.revision, input.libraryItems));
  } catch (error) {
    if (error instanceof CanvasError || error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: error.message }, { status: error instanceof CanvasError ? error.status : 413 });
    throw error;
  }
});
