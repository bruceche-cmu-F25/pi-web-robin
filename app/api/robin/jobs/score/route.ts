import { NextResponse } from "next/server";
import { scoringStatus } from "@/extension/robin/job-domain";
import { startJobScoring } from "@/lib/job-scoring-runner";
import { apiRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async () => NextResponse.json(scoringStatus()));
export const POST = apiRoute(async () => NextResponse.json(startJobScoring()));
