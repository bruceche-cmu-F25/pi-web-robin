import { NextResponse } from "next/server";
import { apiRoute, apiError } from "@/lib/api-route";
import { parseFormDataWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { runLocalTool, toolboxCapabilities, ToolboxError } from "@/extension/robin/toolbox-domain";
import { TOOLBOX_MAX_BYTES } from "@/extension/robin/toolbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 2460; // Probe + preparation + bounded local Whisper inference.
export const GET = apiRoute(() => NextResponse.json(toolboxCapabilities(), { headers: { "Cache-Control": "no-store" } }));
export const POST = apiRoute(async (req) => {
  if (!req.headers.get("content-type")?.startsWith("multipart/form-data;")) return apiError(new Error("Multipart file required"), 415);
  try {
    const form = await parseFormDataWithinLimit(req, TOOLBOX_MAX_BYTES + 65536);
    const file = form.get("file"), options = form.get("options");
    if (!(file instanceof File) || form.getAll("file").length !== 1 || typeof options !== "string" || options.length > 4096) return apiError(new Error("One file and bounded options required"));
    const result = await runLocalTool(file, JSON.parse(options), req.signal);
    return new NextResponse(new Uint8Array(result.bytes), { headers: {
      "Content-Type": result.type, "Content-Disposition": `attachment; filename="${result.name}"`,
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    return apiError(error, error instanceof RequestBodyTooLargeError ? 413 : error instanceof ToolboxError ? error.status : 400);
  }
}, { json: false });
