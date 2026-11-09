import { NextResponse } from "next/server";
import { applicationAnswerEditor, approveApplicationField, saveApplicationFacts, saveApplicationProfile } from "@/extension/robin/job-application-domain";
import { apiError, apiRoute } from "@/lib/api-route";
import { STANDING_ANSWER_KEYS, type StandingAnswers } from "@/extension/robin/job-applications";

export const dynamic = "force-dynamic";

/** Private, authenticated editor readback; the general board never exposes these answers. */
export const GET = apiRoute(async () => NextResponse.json(applicationAnswerEditor(), {
  headers: { "Cache-Control": "private, no-store" },
}));

export const PATCH = apiRoute(async (request) => {
  const body = await request.json() as Record<string, unknown>;
  if (!body || typeof body !== "object" || Array.isArray(body)) return apiError(new Error("Invalid answer request"));
  if (body.kind === "profile" && Object.keys(body).sort().join() === "confirmedFacts,expectedRevision,generalAnswers,kind,standing") {
    if (typeof body.confirmedFacts !== "string" || typeof body.expectedRevision !== "string"
      || !body.standing || typeof body.standing !== "object" || Array.isArray(body.standing)
      || Object.entries(body.standing).some(([key, value]) => !STANDING_ANSWER_KEYS.includes(key as typeof STANDING_ANSWER_KEYS[number]) || typeof value !== "string")
      || !body.generalAnswers || typeof body.generalAnswers !== "object" || Array.isArray(body.generalAnswers)
      || Object.values(body.generalAnswers).some((value) => typeof value !== "string")) {
      return apiError(new Error("Invalid reusable personal answers"));
    }
    try { saveApplicationProfile(body.confirmedFacts, body.standing as StandingAnswers, body.generalAnswers as Record<string, string>, body.expectedRevision); }
    catch (error) {
      if (error instanceof Error && error.message.includes("changed elsewhere")) return apiError(error, 409);
      throw error;
    }
  } else if (body.kind === "facts" && Object.keys(body).sort().join() === "expected,facts,kind") {
    if (typeof body.facts !== "string" || typeof body.expected !== "string") return apiError(new Error("Invalid confirmed facts"));
    try { saveApplicationFacts(body.facts, body.expected); }
    catch (error) {
      if (error instanceof Error && error.message.includes("changed elsewhere")) return apiError(error, 409);
      throw error;
    }
  } else if (body.kind === "field" && Object.keys(body).sort().join() === "answer,id,kind,label") {
    if (typeof body.id !== "string" || typeof body.label !== "string" || typeof body.answer !== "string") return apiError(new Error("Invalid question approval"));
    approveApplicationField(body.id, body.label, body.answer);
  } else return apiError(new Error("Only a reusable profile or one exact form answer can be changed here"));
  return NextResponse.json(applicationAnswerEditor(), { headers: { "Cache-Control": "private, no-store" } });
});
