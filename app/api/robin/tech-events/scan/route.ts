import { NextResponse } from "next/server";
import { startTechEventScan } from "@/extension/robin/tech-event-scan";
import { techEventScanStatus } from "@/extension/robin/tech-event-domain";
import { DEFAULT_SOURCES } from "@/extension/robin/tech-event-sources";
import { apiRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";

/** What the last scan did, and which feeds it reads. */
export const GET = apiRoute(async () => {
  return NextResponse.json({
    ...techEventScanStatus(),
    sources: DEFAULT_SOURCES.map(({ id, label, kind }) => ({ id, label, kind })),
  });
});

/**
 * Scan now, without waiting for the week to be up.
 *
 * Returns immediately rather than awaiting the run. A scan is a few seconds on
 * a good day and a stack of timeouts on a bad one, and the page polls the
 * list anyway — so there is nothing to gain by holding the request open for
 * the worst case.
 */
export const POST = apiRoute(async () => {
  const started = startTechEventScan();
  return NextResponse.json({
    started,
    ...(started ? {} : { reason: "already-running" }),
    scan: techEventScanStatus().scan,
  });
});
