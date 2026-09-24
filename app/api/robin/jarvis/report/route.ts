import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-route";
import { readJarvisView } from "@/lib/jarvis-discovery";
import { renderJarvisReport } from "@/lib/jarvis-report";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = apiRoute((request) => {
  const inline = new URL(request.url).searchParams.get("inline") === "1";
  return new NextResponse(renderJarvisReport(readJarvisView()), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="jarvis-outreach-${new Date().toISOString().slice(0, 10)}.html"`,
      "Cache-Control": "no-store",
    },
  });
});
