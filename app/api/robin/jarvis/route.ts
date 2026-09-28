import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-route";
import { claimJarvisSend, finishJarvisSend, queueJarvisLeads, setJarvisDaily, setJarvisOutbox, setJarvisTemplate, unqueueJarvisLeads, updateJarvisLead } from "@/extension/robin/jarvis-domain";
import { canSendGmail } from "@/extension/robin/google-calendar";
import { sendJarvisEmail } from "@/extension/robin/jarvis-mail";
import type { CoreJarvisSegment } from "@/extension/robin/jarvis-shape";
import { readJarvisView, startJarvisDiscovery, stopJarvisDiscovery } from "@/lib/jarvis-discovery";
import { startJarvisOutbox, syncJarvisReplies } from "@/lib/jarvis-outbox";
import { startJarvisDaily } from "@/lib/jarvis-daily";
import { writeJarvisDayReport } from "@/lib/jarvis-report";
import { startJarvisRescore, stopJarvisRescore } from "@/lib/jarvis-rescore";

// instrumentation starts the outbox at boot; this covers a server that loaded
// before the outbox existed. Both are idempotent.
startJarvisOutbox();
startJarvisDaily();

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = apiRoute(() => NextResponse.json(readJarvisView()));
export const POST = apiRoute(async (request) => {
  const body = await request.json();
  if (body?.action === "send") {
    if (body.confirmed !== true || typeof body.id !== "string" || !Number.isSafeInteger(body.revision) || body.revision < 0) throw new Error("Confirm the current recipient and full draft before sending");
    if (!canSendGmail()) throw new Error("Reconnect Google with Gmail send permission first");
    const attempt = claimJarvisSend(body.id, body.revision);
    try {
      const sent = await sendJarvisEmail(attempt.email, attempt.subject, attempt.body);
      finishJarvisSend(body.id, attempt.attemptId, sent.id, sent.threadId);
      return NextResponse.json({ messageId: sent.id });
    } catch (error) {
      finishJarvisSend(body.id, attempt.attemptId);
      return NextResponse.json({ error: `Delivery unconfirmed: ${error instanceof Error ? error.message : String(error)}. Check Gmail Sent before taking any further action; this contact cannot be sent again automatically.` }, { status: 502 });
    }
  }
  if (body?.action === "export-file") return NextResponse.json(writeJarvisDayReport(readJarvisView()));
  if (body?.action === "queue") return NextResponse.json(queueJarvisLeads(body.items));
  if (body?.action === "unqueue") return NextResponse.json({ removed: unqueueJarvisLeads(body.ids) });
  if (body?.action === "daily") return NextResponse.json({ daily: setJarvisDaily({ enabled: body.enabled, count: body.count, hour: body.hour }) });
  if (body?.action === "outbox") return NextResponse.json({ outbox: setJarvisOutbox({ enabled: body.enabled, dailyLimit: body.dailyLimit, startAt: body.startAt }) });
  if (body?.action === "sync") {
    await syncJarvisReplies();
    return NextResponse.json(readJarvisView());
  }
  if (body?.action === "rescore") return NextResponse.json({ rescore: startJarvisRescore() }, { status: 202 });
  if (body?.action === "stop-rescore") {
    stopJarvisRescore();
    return NextResponse.json(readJarvisView());
  }
  if (body?.action === "stop") {
    stopJarvisDiscovery();
    return NextResponse.json(readJarvisView());
  }
  if (body?.action === "template") {
    return NextResponse.json(setJarvisTemplate({ subject: body.subject, body: body.body }, body.dryRun === true));
  }
  if (body?.action !== "discover") throw new Error("Unknown action");
  return NextResponse.json({ run: startJarvisDiscovery(body.target, body.focus as CoreJarvisSegment | undefined, body.wide === true) }, { status: 202 });
});
export const PATCH = apiRoute(async (request) => {
  const body = await request.json();
  if (typeof body?.id !== "string" || body.id.length > 100) throw new Error("Contact id is required");
  return NextResponse.json({ lead: updateJarvisLead(body.id, body.patch) });
});
