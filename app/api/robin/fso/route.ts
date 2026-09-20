import { NextResponse } from "next/server";
import { fsoSnapshot, openChapter, saveNote } from "@/extension/robin/fso-domain";
import { apiError, apiRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  const body = await req.json().catch(() => null) as unknown;
  return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
}

/** The open chapter and every note. Read-only; nothing here writes on GET. */
export const GET = apiRoute(async () => {
  return NextResponse.json(fsoSnapshot());
});

/** `{ chapter }` — the chapter now on screen, so the mentor knows what "this page" is. */
export const PATCH = apiRoute(async (req) => {
  const body = await readBody(req);
  if (typeof body?.chapter !== "string") return apiError(new Error("chapter is required"));
  try {
    const chapter = openChapter(body.chapter);
    return NextResponse.json({ openChapterId: chapter.id });
  } catch (error) {
    return apiError(error, 404);
  }
});

/** `{ chapter, text }` — replace one chapter's note; empty text deletes it. */
export const PUT = apiRoute(async (req) => {
  const body = await readBody(req);
  if (typeof body?.chapter !== "string" || typeof body.text !== "string") {
    return apiError(new Error("chapter and text are required"));
  }
  try {
    const note = saveNote(body.chapter, body.text);
    return NextResponse.json({ chapter: body.chapter, note });
  } catch (error) {
    return apiError(error);
  }
});
