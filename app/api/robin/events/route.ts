import { NextResponse } from "next/server";
import { localDate } from "@/extension/robin/dates";
import {
  calendarBoard,
  createCalendarEvent,
  deleteCalendarEvent,
  updateCalendarEvent,
  type CalendarEventInput,
} from "@/extension/robin/calendar-domain";
import { apiError, apiRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";

/** Local events merged with a connected Google calendar; the merge is the domain's. */
export const GET = apiRoute(async (req) => {
  const query = new URL(req.url).searchParams;
  return NextResponse.json(await calendarBoard({
    from: query.get("from") ?? undefined,
    to: query.get("to") ?? undefined,
  }));
}, { errorStatus: 400 });

export const POST = apiRoute(async (req) => {
  const body = await req.json() as CalendarEventInput & { requestId?: unknown };
  const event = createCalendarEvent(body, body?.requestId);
  return NextResponse.json({ event, today: localDate() });
});

export const PATCH = apiRoute(async (req) => {
  const body = await req.json() as { id?: unknown; changes: CalendarEventInput; expected: CalendarEventInput };
  if (typeof body?.id !== "string" || !body.id) return apiError(new Error("id is required"));
  const result = updateCalendarEvent(body.id, body.changes, body.expected);
  if (result.status === "missing") return apiError(new Error("Event no longer exists or is read-only"), 404);
  if (result.status === "conflict") return apiError(new Error("Event changed elsewhere. Close and reopen the event before retrying."), 409);
  return NextResponse.json(result);
});

export const DELETE = apiRoute(async (req) => {
  const body = await req.json() as { id?: unknown };
  if (typeof body.id !== "string") return apiError(new Error("id is required"));

  if (!deleteCalendarEvent(body.id)) {
    return NextResponse.json({ error: `No event with id "${body.id}"` }, { status: 404 });
  }
  return NextResponse.json({ success: true });
});
