import { NextResponse } from "next/server";
import { addTodo, deleteTodo, updateTodo } from "@/extension/robin/todo-domain";
import { localDate, readTodos } from "@/extension/robin/store";
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

/**
 * `today` is resolved on the server because that is where the agent wrote the
 * `due` dates. Letting the browser decide would reintroduce the off-by-one the
 * store's local/UTC split exists to prevent.
 */
export async function GET(req: Request) {
  const blocked = guard(req, false);
  if (blocked) return blocked;
  try {
    return NextResponse.json({ todos: readTodos(), today: localDate() });
  } catch (error) {
    return fail(error, 500);
  }
}

export async function POST(req: Request) {
  const blocked = guard(req, true);
  if (blocked) return blocked;
  try {
    const body = await req.json() as { title?: unknown; due?: unknown };
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return fail(new Error("title is required"));

    const { todo } = addTodo({
      title,
      ...(typeof body.due === "string" ? { due: body.due } : {}),
    });
    return NextResponse.json({ todo, today: localDate() });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(req: Request) {
  const blocked = guard(req, true);
  if (blocked) return blocked;
  try {
    const body = await req.json() as {
      id?: unknown;
      done?: unknown;
      title?: unknown;
      due?: unknown;
      color?: unknown;
    };
    if (typeof body.id !== "string") return fail(new Error("id is required"));

    const result = updateTodo({ id: body.id }, {
      ...(typeof body.done === "boolean" ? { done: body.done } : {}),
      ...(typeof body.title === "string" && body.title.trim() ? { title: body.title } : {}),
      ...(typeof body.due === "string" ? { due: body.due } : {}),
      ...(typeof body.color === "string" ? { color: body.color } : {}),
    });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 404 });
    return NextResponse.json({ todo: result, today: localDate() });
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

    const result = deleteTodo({ id: body.id });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    return fail(error);
  }
}
