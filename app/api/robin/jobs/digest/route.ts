import { NextResponse } from "next/server";
import { buildJobDigest, claimJobs } from "@/extension/robin/job-domain";
import { apiRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";

/**
 * Build the next push, or claim one that landed.
 *
 * Two request shapes exist so a delivery can be claimed only once it arrived:
 *
 *   { preview: true }        → read the next batch, write nothing
 *   { claim: [id, …] }       → stamp exactly those jobs as delivered
 *   { }                      → read and stamp in one step
 *
 * The bridge uses the first two. A send that fails then costs nothing: the
 * batch was never claimed, so the next slot offers the same jobs again rather
 * than silently skipping ten of them. Everything else — which jobs qualify,
 * dropping dead postings, assembling the text — is the domain's.
 */
export const POST = apiRoute(async (req) => {
  const body = await req.json().catch(() => ({})) as {
    limit?: unknown;
    locale?: unknown;
    preview?: unknown;
    claim?: unknown;
  };

  if (Array.isArray(body.claim)) {
    const claimed = body.claim.filter((id): id is string => typeof id === "string");
    return NextResponse.json({ claimed: claimJobs(claimed) });
  }

  return NextResponse.json(await buildJobDigest({
    ...(Number.isInteger(body.limit) ? { limit: body.limit as number } : {}),
    ...(body.locale === "zh" ? { locale: "zh" as const } : {}),
    ...(body.preview === true ? { preview: true } : {}),
  }));
}, { errorStatus: 500 });
