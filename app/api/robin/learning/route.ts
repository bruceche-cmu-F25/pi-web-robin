import { NextResponse } from "next/server";
import { learningSnapshot } from "@/extension/robin/learning-domain";
import { setFullstackCompleted } from "@/extension/robin/fso-domain";
import { FULLSTACK_STEPS } from "@/extension/robin/learning";
import { apiRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async () => {
  return NextResponse.json(learningSnapshot());
});

export const PATCH = apiRoute(async (req) => {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body.step !== "string" || typeof body.completed !== "boolean") {
    return NextResponse.json({ error: "step and completed are required" }, { status: 400 });
  }
  if (!FULLSTACK_STEPS.some((step) => step.id === body.step)) {
    return NextResponse.json({ error: "Unknown course step" }, { status: 404 });
  }
  try {
    const fullstack = setFullstackCompleted(body.step, body.completed);
    return NextResponse.json({ fullstack });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
});
