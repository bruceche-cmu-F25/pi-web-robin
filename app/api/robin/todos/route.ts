import { NextResponse } from "next/server";
import { localDate } from "@/extension/robin/dates";
import { addTodo, deleteTodo, listTodos, updateTodo } from "@/extension/robin/todo-domain";
import { apiError, apiRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";

/**
 * `today` is resolved on the server because that is where the agent wrote the
 * `due` dates. Letting the browser decide would reintroduce the off-by-one the
 * store's local/UTC split exists to prevent.
 */
export const GET = apiRoute(async () => NextResponse.json(listTodos({ includeDone: true })));

export const POST = apiRoute(async (req) => {
  const body = await req.json() as { title?: unknown; startDate?: unknown; due?: unknown; url?: unknown };
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return apiError(new Error("title is required"));

  const { todo } = addTodo({
    title,
    ...(typeof body.startDate === "string" ? { startDate: body.startDate } : {}),
    ...(typeof body.due === "string" ? { due: body.due } : {}),
    ...(typeof body.url === "string" ? { url: body.url } : {}),
});
return NextResponse.json({ todo, today: localDate() });
});

export const PATCH = apiRoute(async (req) => {
  const body = await req.json() as {
    id?: unknown;
    done?: unknown;
    title?: unknown;
    startDate?: unknown;
    due?: unknown;
    color?: unknown;
    url?: unknown;
  };
  if (typeof body.id !== "string") return apiError(new Error("id is required"));

  const result = updateTodo({ id: body.id }, {
    ...(typeof body.done === "boolean" ? { done: body.done } : {}),
    ...(typeof body.title === "string" && body.title.trim() ? { title: body.title } : {}),
    ...(typeof body.startDate === "string" ? { startDate: body.startDate } : {}),
    ...(typeof body.due === "string" ? { due: body.due } : {}),
    ...(typeof body.color === "string" ? { color: body.color } : {}),
    ...(typeof body.url === "string" ? { url: body.url } : {}),
});
if ("error" in result) return NextResponse.json({ error: result.error }, { status: 404 });
return NextResponse.json({ todo: result, today: localDate() });
});

export const DELETE = apiRoute(async (req) => {
  const body = await req.json() as { id?: unknown };
  if (typeof body.id !== "string") return apiError(new Error("id is required"));

  const result = deleteTodo({ id: body.id });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 404 });
  return NextResponse.json({ success: true });
});
