import { NextResponse } from "next/server";
import { mailBoard } from "@/extension/robin/mail-domain";
import { apiRoute } from "@/lib/api-route";

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
