import { NextResponse } from "next/server";
import { mailBoard, markMailDone } from "@/extension/robin/mail-domain";
import { apiError, apiRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";

/**
 * Today's email review, plus the connection state.
 *
 * Read-only: the review is produced by the mail-review turn (see
 * `/api/robin/gmail/check`) and stored on disk; this route just reports it. No
 * Gmail call happens here — the review items carry their own metadata — so the
 * page renders instantly and works even when Gmail is unreachable.
 */
export const GET = apiRoute(async () => NextResponse.json(mailBoard()));

/** `{ id, done }`: mark one of today's items handled, or undo it. Never touches Gmail. */
export const PATCH = apiRoute(async (req) => {
  const body = await req.json() as { id?: unknown; done?: unknown };
  if (typeof body.id !== "string" || typeof body.done !== "boolean") {
    return apiError(new Error("id and done are required"));
  }
  const result = markMailDone(body.id, body.done);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 404 });
  return NextResponse.json(result);
});
