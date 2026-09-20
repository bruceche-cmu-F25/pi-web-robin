import { NextResponse } from "next/server";
import { jobProfileEditor, saveJobProfile } from "@/extension/robin/job-profile";
import { apiRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";

/** The saved profile plus the catalogues the editor renders itself from. */
export const GET = apiRoute(async () => NextResponse.json(jobProfileEditor()));

/** Replace the profile wholesale; the domain validates and clamps every field. */
export const PUT = apiRoute(async (req) => {
  const body = await req.json() as Record<string, unknown>;
  return NextResponse.json({ profile: saveJobProfile(body) });
});
