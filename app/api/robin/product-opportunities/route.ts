import { NextResponse } from "next/server";
import { opportunityBoard, saveCaseOpportunity, saveOpportunity, startOpportunityScan } from "@/extension/robin/product-opportunities";
import { apiError, apiRoute } from "@/lib/api-route";
import { readProductAssessments } from "@/extension/robin/product-assessment-domain";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async () => {
  const board = opportunityBoard();
  return NextResponse.json({ ...board, assessments: readProductAssessments(board.opportunities) });
});
export const POST = apiRoute(async (req) => {
  const body = await req.json() as { id?: unknown; refresh?: unknown; caseId?: unknown; angle?: unknown; locale?: unknown };
  if (typeof body.caseId === "string") {
    if (body.angle !== "improve" && body.angle !== "transfer") return apiError(new Error("Choose improve or transfer"));
    try {
      return NextResponse.json({ idea: saveCaseOpportunity(body.caseId, body.angle, body.locale === "zh" ? "zh" : "en") });
    } catch (error) { return apiError(error, 404); }
  }
  if (body.refresh === true) return NextResponse.json({ started: startOpportunityScan() });
  if (typeof body.id !== "string" || !body.id) return apiError(new Error("id is required"));
  try {
    return NextResponse.json({ idea: saveOpportunity(body.id) });
  } catch (error) {
    return apiError(error, 404);
  }
});
