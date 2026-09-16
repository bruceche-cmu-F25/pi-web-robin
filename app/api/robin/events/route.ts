import { NextResponse } from "next/server";
import { addDays } from "@/extension/robin/dates";
import type { DashboardEvent } from "@/extension/robin/events";
import { fetchEventsWithWarnings, isConnected } from "@/extension/robin/google-calendar";
import { localDate, readEvents } from "@/extension/robin/store";
import { createCalendarEvent, deleteCalendarEvent, type CalendarEventInput } from "@/extension/robin/calendar-domain";
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
 * Local events, plus read-only ones from a connected Google calendar.
 *
 * `today` comes from the server, matching the local dates the agent wrote.
 * A Google failure degrades to local-only rather than failing the request: the
 * dashboard staying up with the user's own events beats an error page.
 */
export async function GET(req: Request) {
  const blocked = guard(req, false);
  if (blocked) return blocked;
  try {
    const today = localDate();
    const events: DashboardEvent[] = readEvents();

    if (!isConnected()) {
      return NextResponse.json({ events, today, google: { connected: false } });
    }

    try {
      // Wide enough to cover the month grid on either side of today.
      const pulled = await fetchEventsWithWarnings(addDays(today, -45), addDays(today, 75));
      return NextResponse.json({
        events: [...events, ...pulled.events],
        today,
        google: {
          connected: true,
          ...(pulled.warnings.length > 0 ? { error: pulled.warnings.join("; ") } : {}),
        },
      });
    } catch (googleError) {
      return NextResponse.json({
        events,
        today,
        google: {
          connected: true,
          error: googleError instanceof Error ? googleError.message : String(googleError),
        },
      });
    }
  } catch (error) {
    return fail(error, 500);
  }
}

export async function POST(req: Request) {
  const blocked = guard(req, true);
  if (blocked) return blocked;
  try {
    const body = await req.json() as CalendarEventInput;
    const event = createCalendarEvent(body);
    return NextResponse.json({ event, today: localDate() });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(req: Request) {
  const blocked = guard(req, true);
  if (blocked) return blocked;
  try {
    const body = await req.json() as { id?: unknown };
    if (typeof body.id !== "string") return fail(new Error("id is required"));

    if (!deleteCalendarEvent(body.id)) {
      return NextResponse.json({ error: `No event with id "${body.id}"` }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return fail(error);
  }
}
