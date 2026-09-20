import { NextResponse } from "next/server";
import { localDate } from "@/extension/robin/dates";
import {
  calendarBoard,
  createCalendarEvent,
  deleteCalendarEvent,
  type CalendarEventInput,
} from "@/extension/robin/calendar-domain";
import { apiError, apiRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";

/** Local events merged with a connected Google calendar; the merge is the domain's. */
export const GET = apiRoute(async () => {
  return NextResponse.json(await calendarBoard());
});

export const POST = apiRoute(async (req) => {
  const body = await req.json() as CalendarEventInput;
  const event = createCalendarEvent(body);
  return NextResponse.json({ event, today: localDate() });
});

export const DELETE = apiRoute(async (req) => {
  const body = await req.json() as { id?: unknown };
  if (typeof body.id !== "string") return apiError(new Error("id is required"));

  if (!deleteCalendarEvent(body.id)) {
    return NextResponse.json({ error: `No event with id "${body.id}"` }, { status: 404 });
  }
  return NextResponse.json({ success: true });
});
