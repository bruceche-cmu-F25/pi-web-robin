import { NextResponse } from "next/server";
import {
  startTechEventScan,
  techEventScanRunning,
} from "@/extension/robin/tech-event-scan";
import { DEFAULT_SOURCES } from "@/extension/robin/tech-event-sources";
import { readTechEventScanState } from "@/extension/robin/store";
import { isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

/** What the last scan did, and which feeds it reads. */
export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  return NextResponse.json({
    scan: readTechEventScanState(),
    scanning: techEventScanRunning(),
    sources: DEFAULT_SOURCES.map(({ id, label, kind }) => ({ id, label, kind })),
  });
}

/**
 * Scan now, without waiting for the week to be up.
 *
 * Returns immediately rather than awaiting the run. A scan is a few seconds on
 * a good day and a stack of timeouts on a bad one, and the page polls the
 * list anyway — so there is nothing to gain by holding the request open for
 * the worst case.
 */
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  const started = startTechEventScan();
  return NextResponse.json({
    started,
    ...(started ? {} : { reason: "already-running" }),
    scan: readTechEventScanState(),
  });
}
