import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { listAllSessions } from "@/lib/session-reader";
import { getRunningRpcSessionIds } from "@/lib/rpc-manager";
import { acceptSessionReview, readSessionReviews } from "@/lib/session-ui-state";
import { SESSION_ID_PATTERN } from "@/lib/session-ui-state-shared";
import { pendingSessionReviews } from "@/lib/session-reviews";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const failure = (error: string, status: number) => NextResponse.json({ error }, { status, headers });

export async function GET() {
  try {
    const reviews = readSessionReviews();
    // No transcript scan while the queue is empty; otherwise reuse the catalogue cache.
    const sessions = Object.values(reviews).some(review => !review.reviewed) ? await listAllSessions() : [];
    return NextResponse.json({ reviews: pendingSessionReviews(reviews, sessions, new Set(getRunningRpcSessionIds())) }, { headers });
  } catch {
    return failure("Could not load chat reviews", 500);
  }
}

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) return failure("Untrusted API request", 403);
  if (!hasJsonContentType(req)) return failure("Content-Type must be application/json", 415);
  let body: unknown;
  try { body = await req.json(); } catch { return failure("Invalid JSON body", 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return failure("Expected a JSON object", 400);
  const { id, entryId } = body as Record<string, unknown>;
  const valid = (value: unknown): value is string => typeof value === "string" && value.length <= 128 && SESSION_ID_PATTERN.test(value);
  if (!valid(id) || !valid(entryId)) return failure("Invalid session or reply id", 400);
  try {
    if (!await acceptSessionReview(id, entryId)) return failure("The reply changed; refresh before accepting it", 409);
    return NextResponse.json({ id, entryId }, { headers });
  } catch {
    return failure("Could not save chat review", 500);
  }
}
