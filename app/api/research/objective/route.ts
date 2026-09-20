import { NextResponse } from "next/server";
import { readJsonObject, writeJsonObject } from "@/extension/robin/paths";
import { apiError, apiRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";

const FILE = "research-objective.json";
const MAX_OBJECTIVE_LENGTH = 10_000;
const MAX_NOTE_LENGTH = 100_000;

type StoredObjective = {
  objective: string;
  note?: string;
  updatedAt: string;
};

export const GET = apiRoute(async () => {
  const stored = readJsonObject<StoredObjective>(FILE);
  if (stored && (typeof stored.objective !== "string" || (stored.note !== undefined && typeof stored.note !== "string"))) {
    throw new Error("Stored research notes are invalid");
  }
  return NextResponse.json({ objective: stored?.objective ?? "", note: stored?.note ?? "", updatedAt: stored?.updatedAt ?? null });
});

export const PUT = apiRoute(async (req) => {
  const body = await req.json() as { objective?: unknown; note?: unknown };
  if (typeof body.objective !== "string") return apiError(new Error("objective must be a string"));
  if (body.objective.length > MAX_OBJECTIVE_LENGTH) {
    return apiError(new Error(`objective must be at most ${MAX_OBJECTIVE_LENGTH} characters`), 413);
  }
  if (body.note !== undefined && typeof body.note !== "string") return apiError(new Error("note must be a string"));
  if (typeof body.note === "string" && body.note.length > MAX_NOTE_LENGTH) {
    return apiError(new Error(`note must be at most ${MAX_NOTE_LENGTH} characters`), 413);
  }

  const previous = readJsonObject<StoredObjective>(FILE);
  const stored: StoredObjective = {
    objective: body.objective,
    note: typeof body.note === "string" ? body.note : previous?.note ?? "",
    updatedAt: new Date().toISOString(),
  };
  writeJsonObject(FILE, stored);
  return NextResponse.json(stored);
});
