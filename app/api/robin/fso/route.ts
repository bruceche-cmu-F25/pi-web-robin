import { NextResponse } from "next/server";
import { fsoSnapshot, openChapter, saveNote } from "@/extension/robin/fso-domain";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

function guard(req: Request, requireJson: boolean): NextResponse | null {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (requireJson && !hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  return null;
}

function fail(error: unknown, status = 400): NextResponse {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  const body = await req.json().catch(() => null) as unknown;
  return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
}

/** The open chapter and every note. Read-only; nothing here writes on GET. */
export async function GET(req: Request) {
  const blocked = guard(req, false);
  if (blocked) return blocked;
  try {
    return NextResponse.json(fsoSnapshot());
  } catch (error) {
    return fail(error, 500);
  }
}

/** `{ chapter }` — the chapter now on screen, so the mentor knows what "this page" is. */
export async function PATCH(req: Request) {
  const blocked = guard(req, true);
  if (blocked) return blocked;
  const body = await readBody(req);
  if (typeof body?.chapter !== "string") return fail(new Error("chapter is required"));
  try {
    openChapter(body.chapter);
    return NextResponse.json(fsoSnapshot());
  } catch (error) {
    return fail(error, 404);
  }
}

/** `{ chapter, text }` — replace one chapter's note; empty text deletes it. */
export async function PUT(req: Request) {
  const blocked = guard(req, true);
  if (blocked) return blocked;
  const body = await readBody(req);
  if (typeof body?.chapter !== "string" || typeof body.text !== "string") {
    return fail(new Error("chapter and text are required"));
  }
  try {
    const note = saveNote(body.chapter, body.text);
    return NextResponse.json({ chapter: body.chapter, note });
  } catch (error) {
    return fail(error);
  }
}
