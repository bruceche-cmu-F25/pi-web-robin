/** Todo behavior shared by the HTTP and Pi tool adapters. */
import { createHash } from "node:crypto";
import { addDays, dueBucket, localDate, normalizeDue, parseLocalDate, type DueBucket } from "./dates.ts";
import { EVENT_COLOR_KEYS, type EventColorKey } from "./eventColors.ts";
import { normalizeUrl } from "./links.ts";
import { newId, readJsonArray, updateJsonArray } from "./paths.ts";
import { todoUrl } from "./todo-links.ts";
import { isTodoStatus, todoStatus, type TodoStatus } from "./todo-status.ts";

const TODOS_FILE = "todos.json";

export interface Todo {
  id: string;
  title: string;
  done: boolean;
  status?: TodoStatus;
  /** One explicitly chosen next task across the collection; not a work date. */
  next?: boolean;
  /** Legacy multi-day task range. These remain independent of the focus plan. */
  startDate?: string;
  due?: string;
  /** Deliberate work date, never a deadline. */
  plannedOn?: string;
  estimateMinutes?: number;
  /** Absent means user-supplied; Agent estimates remain visibly tentative. */
  estimateSource?: "agent";
  /** Next local date to reconsider an overdue task after explicitly continuing it. */
  reviewAfter?: string;
  /** Abandoned, not completed; reversible and excluded from ordinary todo lists. */
  archivedAt?: string;
  color?: EventColorKey;
  url?: string;
  createdAt: string;
  completedAt?: string;
}

export interface TodoRef { id?: string; title?: string; revision?: string }
/** Transport-only revision; never persisted into the task itself. */
export type EditableTodo = Todo & { revision: string };
export class TodoConflictError extends Error {
  constructor() { super("Task changed; reload the latest version before saving"); }
}
export interface TodoPatch {
  done?: boolean;
  status?: TodoStatus;
  title?: string;
  startDate?: string;
  due?: string;
  /** Empty string clears the plan; it never changes due. */
  plannedOn?: string;
  /** null clears an estimate. */
  estimateMinutes?: number | null;
  color?: string;
  url?: string;
}
export interface ListTodosOptions { includeDone?: boolean; includeArchived?: boolean }
export type TodoResult<T> = T | { error: string };

function findTodo(todos: Todo[], ref: TodoRef): TodoResult<Todo> {
  if (ref.id) return todos.find((todo) => todo.id === ref.id) ?? { error: `No todo with id "${ref.id}".` };
  if (!ref.title) return { error: "Provide either id or title." };
  const matches = todos.filter((todo) => todo.title.toLowerCase().includes(ref.title!.toLowerCase()));
  if (matches.length === 0) return { error: `No todo matching "${ref.title}".` };
  if (matches.length > 1) return { error: `"${ref.title}" matches ${matches.length} todos — pass an id. Candidates: ${matches.map((todo) => `${todo.id}: ${todo.title}`).join("; ")}` };
  return matches[0];
}

/** Reads never delete history. Completed and abandoned tasks remain recoverable. */
export function listTodos(options: ListTodosOptions = {}): { todos: Todo[]; today: string } {
  const todos = readJsonArray<Todo>(TODOS_FILE);
  return {
    todos: todos.filter((todo) => (options.includeDone || !todo.done) && (options.includeArchived || !todo.archivedAt)),
    today: localDate(),
  };
}

const DUE_LABEL: Record<DueBucket, (due: string) => string> = {
  overdue: (due) => ` (overdue, was due ${due})`, today: () => " (due today)", tomorrow: () => " (due tomorrow)",
  upcoming: (due) => ` (due ${due})`, none: () => "",
};

export function formatTodo(todo: Todo, today: string = localDate()): string {
  const box = todo.done ? "[x]" : "[ ]";
  const bucket = todo.done ? "none" : dueBucket(todo.due, today);
  const date = todo.startDate && todo.due && todo.startDate !== todo.due
    ? ` (${todo.startDate} – ${todo.due}${bucket === "overdue" ? ", overdue" : ""})` : DUE_LABEL[bucket](todo.due ?? "");
  const url = todoUrl(todo);
  const link = url ? ` -> ${url}${todo.url ? "" : " (auto)"}` : "";
  const progress = todoStatus(todo) === "doing" ? " (in progress)" : "";
  const plan = todo.plannedOn ? ` (planned ${todo.plannedOn}, not a deadline)` : "";
  const estimate = todo.estimateMinutes ? ` (${todo.estimateMinutes} min${todo.estimateSource === "agent" ? ", agent estimate" : ""})` : "";
  return `${box} ${todo.id}  ${todo.title}${progress}${date}${plan}${estimate}${link}`;
}

function normalizeTodoColor(value: string): EventColorKey {
  const color = value.trim().toLowerCase();
  if (!(EVENT_COLOR_KEYS as readonly string[]).includes(color)) throw new Error(`Unknown todo colour: ${value}`);
  return color as EventColorKey;
}

function applyPatch(todo: Todo, patch: TodoPatch): void {
  if (patch.status !== undefined && !isTodoStatus(patch.status)) throw new Error("Unknown todo status");
  if (patch.status !== undefined && patch.done !== undefined && (patch.status === "done") !== patch.done) throw new Error("status and done conflict");
  if (patch.status !== undefined || patch.done !== undefined) {
    const status = patch.status ?? (patch.done ? "done" : "todo");
    const done = status === "done";
    if (done && !todo.done) todo.completedAt = new Date().toISOString();
    if (!done) delete todo.completedAt;
    todo.done = done;
    if (done) delete todo.next;
    todo.status = status;
    delete todo.archivedAt;
  }
  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (!title) throw new Error("title cannot be empty");
    todo.title = title;
  }
  if (patch.startDate !== undefined || patch.due !== undefined) {
    const startDate = patch.startDate === undefined ? todo.startDate : patch.startDate.trim() ? normalizeDue(patch.startDate) : undefined;
    const due = patch.due === undefined ? todo.due : patch.due.trim() ? normalizeDue(patch.due) : undefined;
    if (startDate && !due) throw new Error("due is required when startDate is set");
    if (startDate && due && startDate > due) throw new Error("startDate cannot be after due");
    // A changed deadline should be reviewed on its own merits, but an editor
    // saving an unchanged deadline must not undo a recent review decision.
    if (due !== todo.due) delete todo.reviewAfter;
    if (startDate) todo.startDate = startDate; else delete todo.startDate;
    if (due) todo.due = due; else delete todo.due;
  }
  if (patch.plannedOn !== undefined) {
    if (typeof patch.plannedOn !== "string") throw new Error("plannedOn must be a local date");
    if (patch.plannedOn) { parseLocalDate(patch.plannedOn); todo.plannedOn = patch.plannedOn; }
    else delete todo.plannedOn;
  }
  if (patch.estimateMinutes !== undefined) {
    if (patch.estimateMinutes === null) delete todo.estimateMinutes;
    else {
      if (!Number.isInteger(patch.estimateMinutes) || patch.estimateMinutes < 5 || patch.estimateMinutes > 720) throw new Error("Estimate must be 5–720 minutes");
      todo.estimateMinutes = patch.estimateMinutes;
    }
    delete todo.estimateSource;
  }
  if (patch.url !== undefined) {
    if (patch.url.trim()) todo.url = normalizeUrl(patch.url); else delete todo.url;
  }
  if (patch.color !== undefined) {
    if (patch.color.trim()) todo.color = normalizeTodoColor(patch.color); else delete todo.color;
  }
}

export function addTodo(input: { title: string; startDate?: string; due?: string; url?: string; status?: TodoStatus; plannedOn?: string; estimateMinutes?: number | null }): { todo: Todo; open: number } {
  if (!input.title.trim()) throw new Error("title is required");
  const todo: Todo = { id: newId(), title: input.title.trim(), done: false, status: "todo", createdAt: new Date().toISOString() };
  applyPatch(todo, input);
  return updateJsonArray<Todo, { todo: Todo; open: number }>(TODOS_FILE, (todos) => {
    todos.push(todo);
    return { value: { todo, open: todos.filter((entry) => !entry.done && !entry.archivedAt).length }, changed: true };
  });
}

function changeTodo<T>(ref: TodoRef, change: (todo: Todo, todos: Todo[]) => T): TodoResult<T> {
  return updateJsonArray<Todo, TodoResult<T>>(TODOS_FILE, (todos) => {
    const todo = findTodo(todos, ref);
    if ("error" in todo) return { value: todo, changed: false };
    if (ref.revision !== undefined && ref.revision !== todoRevision([todo])) throw new TodoConflictError();
    return { value: change(todo, todos), changed: true };
  });
}

export function updateTodo(ref: TodoRef, patch: TodoPatch): TodoResult<Todo> {
  return changeTodo(ref, (todo) => { applyPatch(todo, patch); return todo; });
}
/** Choose just one next task, atomically, without changing dates or workflow. */
export function chooseNextTodo(ref: TodoRef, next: boolean): TodoResult<Todo> {
  if (typeof next !== "boolean") throw new Error("next must be a boolean");
  return changeTodo(ref, (todo, todos) => {
    if (next && (todo.done || todo.archivedAt)) throw new Error("Choose an active task as next");
    if (next) {
      for (const item of todos) delete item.next;
      todo.next = true;
    } else delete todo.next;
    return todo;
  });
}
export function deleteTodo(ref: TodoRef): TodoResult<Todo> {
  return changeTodo(ref, (todo, todos) => { todos.splice(todos.indexOf(todo), 1); return todo; });
}
export function completeTodo(ref: TodoRef): TodoResult<{ todo: Todo; alreadyDone: boolean; open: number }> {
  return changeTodo(ref, (todo, todos) => {
    const alreadyDone = todo.done;
    applyPatch(todo, { done: true });
    return { todo, alreadyDone, open: todos.filter((entry) => !entry.done && !entry.archivedAt).length };
  });
}

export function reviewTodo(ref: TodoRef, decision: unknown): TodoResult<Todo> {
  if (!["continue", "abandon", "restore"].includes(decision as string)) throw new Error("Unknown review decision");
  return changeTodo(ref, (todo) => {
    if (decision === "abandon") {
      if (todo.done) throw new Error("A completed task cannot be abandoned");
      todo.archivedAt = new Date().toISOString();
      delete todo.next;
      todo.status = "todo";
      delete todo.plannedOn;
    } else {
      if (todo.done) throw new Error("Reopen the completed task first");
      delete todo.archivedAt;
      todo.reviewAfter = addDays(localDate(), 7);
      // Reconsider the work, but never silently extend its official deadline.
      if (todo.plannedOn && todo.plannedOn < localDate()) delete todo.plannedOn;
    }
    return todo;
  });
}

export function todoRevision(todos: Todo[]): string {
  return createHash("sha256").update(JSON.stringify(todos)).digest("hex");
}

/** Batch acceptance is all-or-nothing, including the stale snapshot check. */
export function applyTodoPlan(expectedRevision: string, items: { id: string; plannedOn: string; estimateMinutes: number }[]): void {
  updateJsonArray<Todo, void>(TODOS_FILE, (todos) => {
    if (todoRevision(todos) !== expectedRevision) throw new Error("Tasks changed; regenerate the plan before accepting");
    const seen = new Set<string>();
    for (const item of items) {
      const todo = todos.find((entry) => entry.id === item.id);
      if (!todo || todo.done || todo.archivedAt || todo.plannedOn || seen.has(item.id)) throw new Error("Task is no longer available for planning");
      const estimated = !todo.estimateMinutes || todo.estimateSource === "agent";
      applyPatch(todo, { plannedOn: item.plannedOn, estimateMinutes: item.estimateMinutes });
      if (estimated) todo.estimateSource = "agent";
      seen.add(item.id);
    }
    return { value: undefined, changed: items.length > 0 };
  });
}
