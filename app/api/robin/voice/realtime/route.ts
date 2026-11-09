import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-route";
import { parseJsonWithinLimit } from "@/lib/bounded-form-data";
import { createRealtimeCredential, realtimeReadiness, RealtimeError } from "@/extension/robin/realtime-domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
export const GET = apiRoute(() => {
  try { return NextResponse.json(realtimeReadiness(), { headers }); }
  catch { return NextResponse.json({ code: "setup" }, { status: 503, headers }); }
});
export const POST = apiRoute(async req => {
  try {
    const body = await parseJsonWithinLimit(req, 128);
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length) {
      return NextResponse.json({ code: "request" }, { status: 400, headers });
    }
    return NextResponse.json(await createRealtimeCredential(req.signal), { headers });
  } catch (error) {
    return NextResponse.json({ code: error instanceof RealtimeError ? error.code : "request" }, {
      status: error instanceof RealtimeError ? error.status : 400, headers,
    });
  }
});
