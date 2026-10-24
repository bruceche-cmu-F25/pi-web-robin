import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-route";
import { weeklyImage } from "@/extension/robin/ai-weekly-media-domain";
import { calendarDay } from "@/extension/robin/ai-weekly";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = apiRoute(async (request) => {
  const params = new URL(request.url).searchParams;
  const week = params.get("week"), day = params.get("day");
  if (!calendarDay(week) || !calendarDay(day)) return NextResponse.json({ error: "Invalid reading day" }, { status: 400 });
  const image = await weeklyImage(week, day);
  if (!image) return new NextResponse(null, { status: 404, headers: { "Cache-Control": "private, max-age=300" } });
  return new NextResponse(new Uint8Array(image.body), { headers: {
    "Content-Type": image.contentType,
    "Cache-Control": "private, max-age=86400",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Referrer-Policy": "no-referrer",
  } });
});
