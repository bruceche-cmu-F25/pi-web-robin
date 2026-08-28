import { NextResponse } from "next/server";
import {
  startTechEventScan,
  techEventScanRunning,
} from "@/extension/robin/tech-event-scan";
import {
  hasPassed,
  isScanDue,
  localDate,
  readTechEventScanState,
  readTechEvents,
  sortTechEvents,
  writeTechEvents,
} from "@/extension/robin/store";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

function guard(req: Request, requireJson: boolean): NextResponse | null {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (requireJson && !hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  return null;
}

function fail(error: unknown, status = 400): NextResponse {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

/**
 * The upcoming list, plus the two things the page needs to explain it: when it
 * was last scanned, and whether a scan is going right now.
 *
 * This is also what makes "once a week" happen. There is no cron and no
 * daemon behind this feature — the read checks whether the week is up and
 * starts a scan if it is, then answers immediately with what is already
 * stored. So the page is never blocked on the network, and the freshness
 * guarantee is the honest one: what you see was scanned within a week of the
 * last time anyone looked.
 *
 * Events that have already happened are dropped on read rather than only at
 * scan time. Otherwise a list scanned on Monday would still be offering you
 * Tuesday's meetup on Friday.
 */
export async function GET(req: Request) {
  const blocked = guard(req, false);
  if (blocked) return blocked;
  try {
    const scan = readTechEventScanState();
    const now = Date.now();
    if (isScanDue(scan, now)) startTechEventScan();

    const stored = readTechEvents();
    const live = stored.filter((event) => !hasPassed(event, now));
    // Only rewrite when something actually expired: a GET that writes on every
    // poll would rewrite this file every few seconds for no reason.
    if (live.length !== stored.length) writeTechEvents(live);

    return NextResponse.json({
      events: sortTechEvents(live),
      scan,
      scanning: techEventScanRunning(),
      today: localDate(),
    });
  } catch (error) {
    return fail(error, 500);
  }
}

/**
 * Save an event, or hide it.
 *
 * The only two fields the browser may write. Everything else on an event is a
 * fact the host published and the scanner refreshes, so letting the page edit
 * one would mean the next scan silently reverted it.
 */
export async function PATCH(req: Request) {
  const blocked = guard(req, true);
  if (blocked) return blocked;
  try {
    const body = await req.json() as { id?: unknown; saved?: unknown; hidden?: unknown };
    if (typeof body.id !== "string" || !body.id) return fail(new Error("id is required"));
    if (body.saved !== undefined && typeof body.saved !== "boolean") {
      return fail(new Error("saved must be true or false"));
    }
    if (body.hidden !== undefined && typeof body.hidden !== "boolean") {
      return fail(new Error("hidden must be true or false"));
    }

    const events = readTechEvents();
    const index = events.findIndex((event) => event.id === body.id);
    if (index < 0) return fail(new Error(`No event with id "${body.id}"`), 404);

    const { saved, hidden, ...rest } = events[index]!;
    const next = typeof body.saved === "boolean" ? body.saved : saved;
    const nextHidden = typeof body.hidden === "boolean" ? body.hidden : hidden;
    events[index] = {
      ...rest,
      ...(next ? { saved: true } : {}),
      ...(nextHidden ? { hidden: true } : {}),
    };
    writeTechEvents(events);
    return NextResponse.json({ event: events[index] });
  } catch (error) {
    return fail(error, 500);
  }
}
