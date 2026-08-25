import { NextResponse } from "next/server";
import { setCurrentItem, setStudyTrack } from "@/extension/robin/study-domain";
import { isTrackId } from "@/extension/robin/study";
import { readStudyState } from "@/extension/robin/store";
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

/** Everything the curriculum track keeps: what is open, and which track is showing. */
function snapshotResponse() {
  const state = readStudyState();
  return {
    currentItemId: state.currentItemId ?? null,
    track: state.track ?? null,
  };
}

/**
 * Two ids, and nothing else.
 *
 * There is no progress to report because none is kept: the curriculum offers
 * an order and the resources, and what the user did with them is not the
 * app's to count. The syllabus itself is not in the response either — it is a
 * source file the browser bundle already has, and only changes between
 * deploys.
 */
export async function GET(req: Request) {
  const blocked = guard(req, false);
  if (blocked) return blocked;
  try {
    return NextResponse.json(snapshotResponse());
  } catch (error) {
    return fail(error, 500);
  }
}

/**
 * Which item is open, and which track the rail is showing.
 *
 * The first is why the mentor can answer "explain this" at all: a cross-origin
 * frame reports nothing about itself, so opening a resource has to be written
 * down on the way past.
 */
export async function PATCH(req: Request) {
  const blocked = guard(req, true);
  if (blocked) return blocked;
  try {
    const body = await req.json() as { item?: unknown; track?: unknown };
    const track = isTrackId(body.track) ? body.track : undefined;

    // Changing the track names no item: it is a view preference being mirrored
    // so the mentor's default matches what the rail is showing.
    if (body.item === undefined) {
      if (!track) return fail(new Error("item is required"));
      setStudyTrack(track);
      return NextResponse.json(snapshotResponse());
    }

    if (typeof body.item !== "string" || !body.item.trim()) {
      return fail(new Error("item is required"));
    }

    const opened = setCurrentItem(body.item, track);
    if ("error" in opened) return NextResponse.json({ error: opened.error }, { status: 404 });

    return NextResponse.json(snapshotResponse());
  } catch (error) {
    return fail(error);
  }
}
