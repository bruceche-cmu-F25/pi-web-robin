import { NextResponse } from "next/server";
import {
  podcastScanRunning,
  readPodcastStore,
  startPodcastScan,
  summarizeEpisode,
  summariesRunning,
} from "@/extension/robin/podcast-scan";
import { INTERVIEW_IDS, isVideoId, podcastView } from "@/extension/robin/podcasts";
import { runScopedAssistantTurn } from "@/lib/robin-assistant";
import { apiError, apiRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SUMMARY_TIMEOUT_MS = 240_000;

/**
 * The stored shelf, answered immediately. Reading never starts a scan: the
 * shelf refreshes only when asked to (POST refresh), so opening the page
 * costs no YouTube requests.
 */
export const GET = apiRoute(async () => {
  const store = readPodcastStore();
  return NextResponse.json({ ...podcastView(store), scanning: podcastScanRunning(), summarizing: summariesRunning() });
});

/**
 * `{ action: "refresh" }` rescans the feeds now.
 * `{ action: "summarize", videoId }` reads that episode's transcript and asks
 * the model for a summary — the only path here that spends tokens, so it is
 * limited to videos the shelf actually shows.
 */
export const POST = apiRoute(async (req) => {
  let body: { action?: unknown; videoId?: unknown };
  try {
    body = await req.json() as typeof body;
  } catch {
    return apiError("Body must be JSON");
  }

  if (body.action === "refresh") {
    await startPodcastScan();
    return NextResponse.json({ ...podcastView(readPodcastStore()), scanning: false, summarizing: summariesRunning() });
  }

  if (body.action !== "summarize") return apiError("Unknown action");
  const videoId = body.videoId;
  if (!isVideoId(videoId)) return apiError("videoId is required");
  const store = readPodcastStore();
  const known = INTERVIEW_IDS.has(videoId) || store.episodes.some((episode) => episode.videoId === videoId);
  if (!known) return apiError("That video is not on the shelf", 404);

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
    return apiError(error, 502);
  }
});
