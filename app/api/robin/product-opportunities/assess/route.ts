import { NextResponse } from "next/server";
import { assessProductOpportunity, PRODUCT_ASSESSMENT_PREAMBLE, PRODUCT_ASSESSMENT_TOOLS } from "@/extension/robin/product-assessment-domain";
import { runScopedAssistantTurn } from "@/lib/robin-assistant";
import { apiRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";
export const maxDuration = 240;

/** Explicit only: directory GETs and the daily scanner never spend model tokens. */
export const POST = apiRoute(async (req) => {
  const body = await req.json() as { id?: unknown; locale?: unknown };
  if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.id !== "string" || !body.id || body.id.length > 200) throw new Error("A directory product id is required");
  const assessment = await assessProductOpportunity(body.id, body.locale === "en" ? "en" : "zh", async (message) => {
    req.signal.throwIfAborted();
    const result = await runScopedAssistantTurn({
      remembered: null, remember: () => {}, oneShot: true,
      toolNames: [...PRODUCT_ASSESSMENT_TOOLS], preamble: PRODUCT_ASSESSMENT_PREAMBLE,
      message, timeoutMs: 180_000, signal: req.signal, lockKey: "product-opportunity-assessment",
    });
    req.signal.throwIfAborted();
    return result;
  });
  return NextResponse.json({ assessment });
});
