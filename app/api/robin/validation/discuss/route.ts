import { NextResponse } from "next/server";
import { discussValidation, VALIDATION_DISCUSSION_PREAMBLE, ValidationError } from "@/extension/robin/validation-domain";
import { apiError, apiRoute } from "@/lib/api-route";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { runScopedAssistantTurn } from "@/lib/robin-assistant";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 150;

/** Draft-only turn. No tools, approvals, web crawling, contact discovery or sending. */
export const POST = apiRoute(async (req) => {
  try {
    const input = await parseJsonWithinLimit(req, 24_000);
    req.signal.throwIfAborted();
    const project = await discussValidation(input, async message => {
      req.signal.throwIfAborted();
      const result = await runScopedAssistantTurn({ remembered: null, remember: () => {}, oneShot: true,
        toolNames: [], preamble: VALIDATION_DISCUSSION_PREAMBLE, message, timeoutMs: 120_000, signal: req.signal });
      req.signal.throwIfAborted();
      return result;
    });
    return NextResponse.json({ project });
  } catch (error) {
    if (error instanceof ValidationError) return apiError(error, error.status);
    if (error instanceof RequestBodyTooLargeError) return apiError(error, 413);
    return apiError(new Error("Discussion did not complete. Reload to inspect its status; the existing plan was not replaced. A retry starts a new model turn."), 502);
  }
});
