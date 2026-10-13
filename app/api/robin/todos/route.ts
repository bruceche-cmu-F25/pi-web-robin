import { NextResponse } from "next/server";
import { localDate } from "@/extension/robin/dates";
import { addTodo, chooseNextTodo, deleteTodo, listTodos, reviewTodo, todoRevision, TodoConflictError, updateTodo, type Todo, type TodoPatch, type TodoResult } from "@/extension/robin/todo-domain";
import { isTodoStatus } from "@/extension/robin/todo-status";
import { apiError, apiRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";

/**
 * `today` is resolved on the server because that is where the agent wrote the
 * `due` dates. Letting the browser decide would reintroduce the off-by-one the
 * store's local/UTC split exists to prevent.
 */
const editable = (todo: Todo) => ({ ...todo, revision: todoRevision([todo]) });
export const GET = apiRoute(async (req) => {
  const result = listTodos({ includeDone: true, includeArchived: new URL(req.url).searchParams.get("includeArchived") === "true" });
  return NextResponse.json({ ...result, todos: result.todos.map(editable) });
});

function writeResponse(change: () => TodoResult<Todo>, deleted = false) {
  try {
    const result = change();
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 404 });
    return NextResponse.json(deleted ? { success: true } : { todo: editable(result), today: localDate() });
  } catch (error) {
    if (error instanceof TodoConflictError) return apiError(error, 409);
    throw error;
  }
}

function taskRef(body: { id?: unknown; revision?: unknown }) {
  if (typeof body.id !== "string" || !body.id) throw new Error("id is required");
  if (body.revision !== undefined && (typeof body.revision !== "string" || !body.revision)) throw new Error("revision must be a nonempty string");
  return { id: body.id, ...(typeof body.revision === "string" ? { revision: body.revision } : {}) };
}

function planningFields(body: { plannedOn?: unknown; estimateMinutes?: unknown }): Pick<TodoPatch, "plannedOn" | "estimateMinutes"> {
  if (body.plannedOn !== undefined && typeof body.plannedOn !== "string") throw new Error("plannedOn must be a local date");
  if (body.estimateMinutes !== undefined && body.estimateMinutes !== null && typeof body.estimateMinutes !== "number") throw new Error("estimateMinutes must be a number or null");
  return {
    ...(typeof body.plannedOn === "string" ? { plannedOn: body.plannedOn } : {}),
    ...(body.estimateMinutes !== undefined ? { estimateMinutes: body.estimateMinutes as number | null } : {}),
  };
}

export const POST = apiRoute(async (req) => {
  const body = await req.json() as { title?: unknown; startDate?: unknown; due?: unknown; url?: unknown; status?: unknown; plannedOn?: unknown; estimateMinutes?: unknown };
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return apiError(new Error("title is required"));
  if (body.status !== undefined && !isTodoStatus(body.status)) return apiError(new Error("Unknown todo status"));

  const { todo } = addTodo({
    title,
    ...planningFields(body),
    ...(isTodoStatus(body.status) ? { status: body.status } : {}),
    ...(typeof body.startDate === "string" ? { startDate: body.startDate } : {}),
    ...(typeof body.due === "string" ? { due: body.due } : {}),
    ...(typeof body.url === "string" ? { url: body.url } : {}),
  });
  return NextResponse.json({ todo: editable(todo), today: localDate() });
});

export const PATCH = apiRoute(async (req) => {
  const body = await req.json() as {
    id?: unknown;
    revision?: unknown;
    next?: unknown;
    done?: unknown;
    status?: unknown;
    plannedOn?: unknown;
    estimateMinutes?: unknown;
    review?: unknown;
    title?: unknown;
    startDate?: unknown;
    due?: unknown;
    color?: unknown;
    url?: unknown;
  };
  const ref = taskRef(body);
  if (body.next !== undefined) {
    if (typeof body.next !== "boolean") throw new Error("next must be a boolean");
    if (Object.keys(body).some((key) => !["id", "revision", "next"].includes(key))) throw new Error("Choose next separately from other edits");
    const next = body.next;
    return writeResponse(() => chooseNextTodo(ref, next));
  }

  if (body.status !== undefined && !isTodoStatus(body.status)) return apiError(new Error("Unknown todo status"));

  return writeResponse(() => body.review !== undefined ? reviewTodo(ref, body.review) : updateTodo(ref, {
    ...planningFields(body),
    ...(isTodoStatus(body.status) ? { status: body.status } : {}),
    ...(typeof body.done === "boolean" ? { done: body.done } : {}),
    ...(typeof body.title === "string" && body.title.trim() ? { title: body.title } : {}),
    ...(typeof body.startDate === "string" ? { startDate: body.startDate } : {}),
    ...(typeof body.due === "string" ? { due: body.due } : {}),
    ...(typeof body.color === "string" ? { color: body.color } : {}),
    ...(typeof body.url === "string" ? { url: body.url } : {}),
  }));
});

export const DELETE = apiRoute(async (req) => {
  const ref = taskRef(await req.json());
  return writeResponse(() => deleteTodo(ref), true);
});
