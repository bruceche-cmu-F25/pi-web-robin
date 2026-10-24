import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-route";
import { parseJsonWithinLimit, readRequestBodyWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { voiceReadiness, transcribeVoice, synthesizeVoice, VoiceError } from "@/extension/robin/voice-domain";
import { VOICE_MAX_BYTES } from "@/extension/robin/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 70;
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
export const GET = apiRoute(() => NextResponse.json(voiceReadiness(), { headers }));
export const POST = apiRoute(async req => {
  try {
    const op = new URL(req.url).searchParams.get("op");
    const mime = req.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (op === "transcribe") {
      if (mime !== "audio/wav") throw new VoiceError("audio", 415);
      const bytes = await readRequestBodyWithinLimit(req, VOICE_MAX_BYTES);
      return NextResponse.json({ text: await transcribeVoice(bytes, req.signal) }, { headers });
    }
    if (op === "speak") {
      if (mime !== "application/json") throw new VoiceError("text", 415);
      const body = await parseJsonWithinLimit<{ text?: unknown } | null>(req, 8_192);
      const bytes = await synthesizeVoice(body?.text, req.signal);
      return new NextResponse(new Uint8Array(bytes).buffer, { headers: { ...headers, "Content-Type": "audio/wav" } });
    }
    throw new VoiceError("request");
  } catch (error) {
    const code = error instanceof VoiceError ? error.code : error instanceof RequestBodyTooLargeError ? "audio" : "request";
    const status = error instanceof VoiceError ? error.status : error instanceof RequestBodyTooLargeError ? 413 : 400;
    return NextResponse.json({ code, error: code }, { status, headers });
  }
}, { json: false });
