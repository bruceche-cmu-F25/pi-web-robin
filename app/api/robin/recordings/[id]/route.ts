import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { apiError, apiRoute } from "@/lib/api-route";
import { parseJsonWithinLimit } from "@/lib/bounded-form-data";
import { readRecording, recordingAudio, transcribeRecording, editRecording, deleteRecording, RecordingError } from "@/extension/robin/recordings-domain";

type Context = { params: Promise<{ id: string }> };
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Local CPU inference can take much longer than a cloud request (30-minute child limit).
export const maxDuration = 1860;
function failure(error: unknown) { return apiError(error, error instanceof RecordingError ? error.status : 400); }

export const GET = apiRoute<Context>(async (req, ctx) => {
  try {
    const { id } = await ctx.params;
    if (!new URL(req.url).searchParams.has("audio")) return NextResponse.json({ recording: readRecording(id) }, { headers: { "Cache-Control": "no-store" } });
    const audio = recordingAudio(id);
    const headers: Record<string, string> = {
      "Content-Type": audio.type, "Accept-Ranges": "bytes", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    };
    const range = req.headers.get("range");
    let start = 0, end = audio.size - 1;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (match && (match[1] || match[2])) {
        start = match[1] ? Number(match[1]) : Math.max(0, audio.size - Number(match[2]));
        end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
      } else start = -1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= audio.size) {
        return new NextResponse(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${audio.size}` } });
      }
      headers["Content-Range"] = `bytes ${start}-${end}/${audio.size}`;
    }
    headers["Content-Length"] = String(end - start + 1);
    const stream = Readable.toWeb(createReadStream(audio.path, { start, end })) as ReadableStream<Uint8Array>;
    return new NextResponse(stream, { status: range ? 206 : 200, headers });
  } catch (error) { return failure(error); }
});

export const POST = apiRoute<Context>(async (_req, ctx) => {
  try { return NextResponse.json({ recording: await transcribeRecording((await ctx.params).id) }); }
  catch (error) { return failure(error); }
});
export const PATCH = apiRoute<Context>(async (req, ctx) => {
  try {
    const body = await parseJsonWithinLimit<Record<string, unknown>>(req, 8 * 1024 * 1024);
    if (!body || Array.isArray(body)) return apiError(new Error("Invalid recording edit"));
    return NextResponse.json({ recording: editRecording((await ctx.params).id, body) });
  } catch (error) { return failure(error); }
});
export const DELETE = apiRoute<Context>(async (req, ctx) => {
  try {
    const body = await parseJsonWithinLimit<{ revision?: unknown }>(req, 1024);
    deleteRecording((await ctx.params).id, body?.revision);
    return NextResponse.json({ ok: true });
  } catch (error) { return failure(error); }
});
