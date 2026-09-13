import { NextResponse } from "next/server";
import {
  podcastScanRunning,
  readPodcastStore,
  startPodcastScan,
  summarizeEpisode,
  summariesRunning,
} from "@/extension/robin/podcast-scan";
import { INTERVIEW_IDS, isPodcastScanDue, isVideoId, podcastView } from "@/extension/robin/podcasts";
import { runScopedAssistantTurn } from "@/lib/robin-assistant";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SUMMARY_TIMEOUT_MS = 240_000;

function guard(req: Request, requireJson: boolean): NextResponse | null {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  if (requireJson && !hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  return null;
}

function fail(error: unknown, status = 400): NextResponse {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

/**
 * The stored shelf, answered immediately. Like the events feed, the read is
 * also the schedule: if the last scan is more than six hours old, one starts
 * in the background and the page picks it up on its next poll. A scan is feed
 * requests only — no model tokens — which is what makes that safe on a GET.
 */
export async function GET(req: Request) {
  const blocked = guard(req, false);
  if (blocked) return blocked;
  try {
    const store = readPodcastStore();
    if (isPodcastScanDue(store)) void startPodcastScan();
    return NextResponse.json({ ...podcastView(store), scanning: podcastScanRunning(), summarizing: summariesRunning() });
  } catch (error) {
    return fail(error, 500);
  }
}

/**
 * `{ action: "refresh" }` rescans the feeds now.
 * `{ action: "summarize", videoId }` reads that episode's transcript and asks
 * the model for a summary — the only path here that spends tokens, so it is
 * limited to videos the shelf actually shows.
 */
export async function POST(req: Request) {
  const blocked = guard(req, true);
  if (blocked) return blocked;
  let body: { action?: unknown; videoId?: unknown };
  try {
    body = await req.json() as typeof body;
  } catch {
    return fail("Body must be JSON");
  }

  if (body.action === "refresh") {
    await startPodcastScan();
    return NextResponse.json({ ...podcastView(readPodcastStore()), scanning: false, summarizing: summariesRunning() });
  }

  if (body.action !== "summarize") return fail("Unknown action");
  const videoId = body.videoId;
  if (!isVideoId(videoId)) return fail("videoId is required");
  const store = readPodcastStore();
  const known = INTERVIEW_IDS.has(videoId) || store.episodes.some((episode) => episode.videoId === videoId);
  if (!known) return fail("That video is not on the shelf", 404);

  const details = store.details[videoId];
  const heading = details ? `Episode: "${details.title}" — ${details.author}` : `Episode: ${videoId}`;
  try {
    const summary = await summarizeEpisode(videoId, async (instructions, transcript) => {
      const { reply } = await runScopedAssistantTurn({
        // One throwaway session per summary: nothing to remember between
        // episodes, and a timed-out summary must stop reading the transcript.
        remembered: null,
        remember: () => {},
        oneShot: true,
        toolNames: [],
        preamble: instructions,
        message: `${heading}\n\nTranscript:\n${transcript}`,
        timeoutMs: SUMMARY_TIMEOUT_MS,
      });
      return reply;
    });
    return NextResponse.json({ summary });
  } catch (error) {
    return fail(error, 502);
  }
}
