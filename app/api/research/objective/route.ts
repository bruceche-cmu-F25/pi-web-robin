import { NextResponse } from "next/server";
import { readJsonObject, writeJsonObject } from "@/extension/robin/paths";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

const FILE = "research-objective.json";
const MAX_OBJECTIVE_LENGTH = 10_000;

type StoredObjective = {
  objective: string;
  updatedAt: string;
};

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

export async function GET(req: Request) {
  const blocked = guard(req, false);
  if (blocked) return blocked;

  try {
    const stored = readJsonObject<StoredObjective>(FILE);
    if (stored && typeof stored.objective !== "string") {
      throw new Error("Stored research objective is invalid");
    }
    return NextResponse.json({ objective: stored?.objective ?? "", updatedAt: stored?.updatedAt ?? null });
  } catch (error) {
    return fail(error, 500);
  }
}

export async function PUT(req: Request) {
  const blocked = guard(req, true);
  if (blocked) return blocked;

  try {
    const body = await req.json() as { objective?: unknown };
    if (typeof body.objective !== "string") return fail(new Error("objective must be a string"));
    if (body.objective.length > MAX_OBJECTIVE_LENGTH) {
      return fail(new Error(`objective must be at most ${MAX_OBJECTIVE_LENGTH} characters`), 413);
    }

    const stored: StoredObjective = {
      objective: body.objective,
      updatedAt: new Date().toISOString(),
    };
    writeJsonObject(FILE, stored);
    return NextResponse.json(stored);
  } catch (error) {
    return fail(error);
  }
}
