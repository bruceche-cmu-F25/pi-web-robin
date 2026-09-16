import { NextResponse } from "next/server";
import {
  deleteRound,
  listRounds,
  readRoundScanState,
  recordRound,
  updateRound,
} from "@/extension/robin/round-domain";
import { isRoundStatus } from "@/extension/robin/rounds";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

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

const text = (value: unknown) => (typeof value === "string" ? value : undefined);

/**
 * Reading folds in the todo side (a ticked todo closes its round), so this GET
 * can write rounds.json — never todos.json.
 */
export async function GET(req: Request) {
  const blocked = guard(req, false);
  if (blocked) return blocked;
  try {
    return NextResponse.json({ rounds: listRounds(), scan: readRoundScanState() });
  } catch (error) {
    return fail(error, 500);
  }
}

export async function POST(req: Request) {
  const blocked = guard(req, true);
  if (blocked) return blocked;
  try {
    const body = await req.json() as Record<string, unknown>;
    const { round } = recordRound({
      kind: text(body.kind) ?? "",
      company: text(body.company) ?? "",
      role: text(body.role),
      due: text(body.due),
      detail: text(body.detail),
    });
    return NextResponse.json({ round });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(req: Request) {
  const blocked = guard(req, true);
  if (blocked) return blocked;
  try {
    const body = await req.json() as Record<string, unknown>;
    if (typeof body.id !== "string") return fail(new Error("id is required"));
    if (body.status !== undefined && !isRoundStatus(body.status)) return fail(new Error("unknown status"));
    const result = updateRound(body.id, {
      ...(isRoundStatus(body.status) ? { status: body.status } : {}),
      ...(text(body.company) !== undefined ? { company: text(body.company) } : {}),
      ...(text(body.role) !== undefined ? { role: text(body.role) } : {}),
      ...(text(body.due) !== undefined ? { due: text(body.due) } : {}),
      ...(text(body.detail) !== undefined ? { detail: text(body.detail) } : {}),
    });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 404 });
    return NextResponse.json({ round: result });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(req: Request) {
  const blocked = guard(req, true);
  if (blocked) return blocked;
  try {
    const body = await req.json() as { id?: unknown };
    if (typeof body.id !== "string") return fail(new Error("id is required"));
    const result = deleteRound(body.id);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 404 });
    return NextResponse.json({ round: result });
  } catch (error) {
    return fail(error);
  }
}
