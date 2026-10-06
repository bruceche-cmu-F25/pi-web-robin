import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-route";
import { claimJarvisSend, finishJarvisSend, planOutreachChannel, prepareJarvisOutreachBatch, queueJarvisLeads, revertOutreachChange, unqueueJarvisLeads, updateJarvisSocialOutreach, updateLinkedInConnection, updateOutreachReviewQueue } from "@/extension/robin/jarvis-domain";
import { coldReachSenderEmail, sendJarvisEmail } from "@/extension/robin/jarvis-mail";
import { acquireJarvisDeliveryLease } from "@/lib/jarvis-delivery-lease";
import { readJarvisView } from "@/lib/jarvis-discovery";
import { syncJarvisReplies } from "@/lib/jarvis-outbox";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const POST = apiRoute(async (request) => {
  const body = await request.json();
  if (body?.action === "send") {
    if (body.confirmed !== true || typeof body.id !== "string" || !Number.isSafeInteger(body.revision) || body.revision < 0) throw new Error("Confirm the current recipient and full draft before sending");
    const deliveryLease = acquireJarvisDeliveryLease("manual");
    if (!deliveryLease) return NextResponse.json({ error: "Another email delivery is already in progress. Try again after it settles.", reason: "delivery-busy" }, { status: 409 });
    try {
      const senderEmail = coldReachSenderEmail();
      const attempt = claimJarvisSend(body.id, body.revision, senderEmail);
      try {
        const sent = await sendJarvisEmail(attempt.email, attempt.subject, attempt.body, undefined, senderEmail, deliveryLease.signal);
        finishJarvisSend(body.id, attempt.attemptId, sent.id, sent.threadId);
        return NextResponse.json({ messageId: sent.id });
      } catch (error) {
        finishJarvisSend(body.id, attempt.attemptId);
        return NextResponse.json({ error: `Delivery unconfirmed: ${error instanceof Error ? error.message : String(error)}. Check Gmail Sent before taking any further action; this contact cannot be sent again automatically.` }, { status: 502 });
      }
    } finally {
      deliveryLease.release();
    }
  }
  if (body?.action === "plan-channel") { planOutreachChannel(body); return NextResponse.json({ saved: true }); }
  if (body?.action === "review-queue") return NextResponse.json(updateOutreachReviewQueue(body));
  if (body?.action === "approve-for-send") return NextResponse.json(prepareJarvisOutreachBatch(body, false));
  if (body?.action === "prepare-batch") return NextResponse.json(prepareJarvisOutreachBatch(body));
  if (body?.action === "queue") return NextResponse.json(queueJarvisLeads(body.items));
  if (body?.action === "revert-outreach-change") return NextResponse.json({ lead: revertOutreachChange(body) });
  if (body?.action === "linkedin-connection") return NextResponse.json({ lead: updateLinkedInConnection(body.id, body) });
  if (body?.action === "social") return NextResponse.json({ lead: updateJarvisSocialOutreach(body.id, body) });
  if (body?.action === "unqueue") return NextResponse.json({ removed: unqueueJarvisLeads(body.ids) });
  if (body?.action === "sync") {
    await syncJarvisReplies();
    return NextResponse.json(readJarvisView());
  }
  throw new Error("Unknown outreach action");
});
