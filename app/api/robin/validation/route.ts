import { NextResponse } from "next/server";
import { executeValidationCommand, exportValidation, initializeValidation, readValidationBoard, readValidationProject, ValidationError } from "@/extension/robin/validation-domain";
import { apiError, apiRoute } from "@/lib/api-route";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = apiRoute((req) => {
  try {
    const query = new URL(req.url).searchParams;
    if (query.get("export") === "1") return NextResponse.json(exportValidation(), { headers: { "Content-Disposition": 'attachment; filename="market-validation.json"', "Cache-Control": "no-store" } });
    const id = query.get("id");
    return NextResponse.json(id ? { project: readValidationProject(id) } : readValidationBoard(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error instanceof ValidationError ? error : new Error("Validation storage is unavailable. No data was initialized or replaced."), error instanceof ValidationError ? error.status : 503);
  }
});

/** Approval is an explicit authenticated UI command; this route is not an AI tool. */
export const POST = apiRoute(async (req) => {
  try {
    const input = await parseJsonWithinLimit<Record<string, unknown>>(req, 128_000);
    if (input && typeof input === "object" && !Array.isArray(input) && input.action === "initialize" && Object.keys(input).length === 1) {
      return NextResponse.json(initializeValidation());
    }
    return NextResponse.json({ project: executeValidationCommand(input) });
  } catch (error) {
    if (error instanceof ValidationError) return apiError(error, error.status);
    if (error instanceof RequestBodyTooLargeError) return apiError(error, 413);
    if (error instanceof SyntaxError) return apiError(new Error("Invalid JSON"), 400);
    return apiError(new Error("Validation write was not confirmed. Reload before retrying; no automatic repair was attempted."), 503);
  }
});
