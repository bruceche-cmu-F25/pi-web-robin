import { NextResponse } from "next/server";
import { opportunityBoard, saveOpportunity, startOpportunityScan } from "@/extension/robin/product-opportunities";
import { apiError, apiRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async () => NextResponse.json(opportunityBoard()));
export const POST = apiRoute(async (req) => {
  const body = await req.json() as { id?: unknown; refresh?: unknown };
  if (body.refresh === true) return NextResponse.json({ started: startOpportunityScan() });
  if (typeof body.id !== "string" || !body.id) return apiError(new Error("id is required"));
  try {
    return NextResponse.json({ idea: saveOpportunity(body.id) });
  } catch (error) {
    return apiError(error, 404);
  }
});
