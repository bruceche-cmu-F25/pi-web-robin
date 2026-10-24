import { NextResponse } from "next/server";
import { apiError, apiRoute } from "@/lib/api-route";
import { parseFormDataWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { createRecording, listRecordings, recordingConfig, RecordingError } from "@/extension/robin/recordings-domain";
import { MAX_RECORDING_BYTES } from "@/extension/robin/recordings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 240;

export const GET = apiRoute(() => NextResponse.json({ recordings: listRecordings(), config: recordingConfig() }, { headers: { "Cache-Control": "no-store" } }));
export const POST = apiRoute(async (req) => {
  if (!req.headers.get("content-type")?.startsWith("multipart/form-data;")) return apiError(new Error("Multipart audio required"), 415);
  try {
    const form = await parseFormDataWithinLimit(req, MAX_RECORDING_BYTES + 64 * 1024);
    const file = form.get("file");
    if (!(file instanceof File)) return apiError(new Error("Audio file required"));
    return NextResponse.json({ recording: await createRecording(file, form.get("title"), req.signal) });
  } catch (error) {
    return apiError(error, error instanceof RequestBodyTooLargeError ? 413 : error instanceof RecordingError ? error.status : 400);
  }
}, { json: false });
