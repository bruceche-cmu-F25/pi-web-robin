import { NextResponse } from "next/server";
import {
  deleteRound,
  listRounds,
  readRoundScanState,
  recordRound,
  updateRound,
} from "@/extension/robin/round-domain";
import { isRoundStatus } from "@/extension/robin/rounds";
import { apiError, apiRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";

const text = (value: unknown) => (typeof value === "string" ? value : undefined);

/**
 * Reading folds in the todo side (a ticked todo closes its round), so this GET
 * can write rounds.json — never todos.json.
 */
export const GET = apiRoute(async () => {
  return NextResponse.json({ rounds: listRounds(), scan: readRoundScanState() });
});

export const POST = apiRoute(async (req) => {
  const body = await req.json() as Record<string, unknown>;
  const { round } = recordRound({
    kind: text(body.kind) ?? "",
    company: text(body.company) ?? "",
    role: text(body.role),
    due: text(body.due),
    detail: text(body.detail),
  });
  return NextResponse.json({ round });
});

export const PATCH = apiRoute(async (req) => {
  const body = await req.json() as Record<string, unknown>;
  if (typeof body.id !== "string") return apiError(new Error("id is required"));
  if (body.status !== undefined && !isRoundStatus(body.status)) return apiError(new Error("unknown status"));
  const result = updateRound(body.id, {
    ...(isRoundStatus(body.status) ? { status: body.status } : {}),
    ...(text(body.company) !== undefined ? { company: text(body.company) } : {}),
    ...(text(body.role) !== undefined ? { role: text(body.role) } : {}),
    ...(text(body.due) !== undefined ? { due: text(body.due) } : {}),
    ...(text(body.detail) !== undefined ? { detail: text(body.detail) } : {}),
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 404 });
  return NextResponse.json({ round: result });
});

export const DELETE = apiRoute(async (req) => {
  const body = await req.json() as { id?: unknown };
  if (typeof body.id !== "string") return apiError(new Error("id is required"));
  const result = deleteRound(body.id);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 404 });
  return NextResponse.json({ round: result });
});
