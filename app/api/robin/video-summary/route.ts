import { apiRoute } from "@/lib/api-route";
import { parseJsonWithinLimit } from "@/lib/bounded-form-data";
import { runScopedAssistantTurn } from "@/lib/robin-assistant";
import { summarizeVideoUrl, videoSummaryHistory } from "@/extension/robin/podcast-scan";
import { videoIdFromUrl, type VideoSummaryEvent } from "@/extension/robin/video-summary";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export const GET = apiRoute(() => Response.json({ results: videoSummaryHistory() }, { headers: { "Cache-Control": "no-store" } }));

export const POST = apiRoute(async (req) => {
  const body = await parseJsonWithinLimit<{ url?: unknown } | null>(req, 4096);
  const url = body?.url;
  videoIdFromUrl(url); // Reject unsupported input before opening a successful stream.
  let connected = true;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: VideoSummaryEvent) => {
        if (!connected) return;
        try { controller.enqueue(new TextEncoder().encode(`${JSON.stringify(event)}\n`)); }
        catch { connected = false; } // Progress transport must not abort shared/paid work.
      };
      // Closing the tab disconnects progress, not the paid turn: its result remains in history.
      void summarizeVideoUrl(url, async (preamble, message, signal) => {
        const { reply } = await runScopedAssistantTurn({
          remembered: null, remember: () => {}, oneShot: true, toolNames: [],
          preamble, message, signal, timeoutMs: 240_000,
        });
        return reply;
      }, { onStage: stage => send({ stage }) })
        .then(result => send({ result }))
        .catch(error => send({ error: error instanceof Error ? error.message : "Video summary failed" }))
        .finally(() => { if (connected) { connected = false; controller.close(); } });
    },
    cancel() { connected = false; },
  });
  return new Response(stream, { headers: {
    "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no", "X-Content-Type-Options": "nosniff",
  } });
});
