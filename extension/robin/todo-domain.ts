/** Todo behavior shared by the HTTP and Pi tool adapters. */
import { dueBucket, localDate, normalizeDue, type DueBucket } from "./dates.ts";
import { EVENT_COLOR_KEYS, type EventColorKey } from "./eventColors.ts";
import { normalizeUrl } from "./links.ts";
import { newId, readJsonArray, writeJsonArray } from "./paths.ts";
import { todoUrl } from "./todo-links.ts";

const TODOS_FILE = "todos.json";
const COMPLETED_TODO_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

export interface Todo {
  id: string;
  title: string;
  done: boolean;
  /** Local calendar date, YYYY-MM-DD. Never a timestamp. */
  due?: string;
  /** User-selected title hue keyed to the calendar palette. */
  color?: EventColorKey;
  /** Where the task actually lives, normalized for use as an href. */
  url?: string;
  /** UTC instant, ISO 8601. */
  createdAt: string;
  /** UTC instant, ISO 8601. */
  completedAt?: string;
}

export interface TodoRef {
  id?: string;
  title?: string;
}

export interface TodoPatch {
  done?: boolean;
  title?: string;
  due?: string;
  color?: string;
  /** An empty string removes the link. */
  url?: string;
}

export interface ListTodosOptions {
  includeDone?: boolean;
}

export type TodoResult<T> = T | { error: string };

function pruneCompletedTodos(todos: Todo[], now = Date.now()): Todo[] {
  const cutoff = now - COMPLETED_TODO_RETENTION_MS;
  return todos.filter((todo) => {
    if (!todo.done) return true;
    const completed = Date.parse(todo.completedAt ?? todo.createdAt);
    return !Number.isFinite(completed) || completed > cutoff;
  });
}

function readTodos(): Todo[] {
  const todos = readJsonArray<Todo>(TODOS_FILE);
  const retained = pruneCompletedTodos(todos);
  if (retained.length !== todos.length) writeJsonArray(TODOS_FILE, retained);
  return retained;
}

function writeTodos(todos: Todo[]): void {
  writeJsonArray(TODOS_FILE, todos);
}

function findTodo(todos: Todo[], ref: TodoRef): TodoResult<Todo> {
  if (ref.id) {
    const byId = todos.find((todo) => todo.id === ref.id);
    return byId ?? { error: `No todo with id "${ref.id}".` };
  }
  if (!ref.title) return { error: "Provide either id or title." };

  const needle = ref.title.toLowerCase();
  const matches = todos.filter((todo) => todo.title.toLowerCase().includes(needle));
  if (matches.length === 0) return { error: `No todo matching "${ref.title}".` };
  if (matches.length > 1) {
    const candidates = matches.map((todo) => `${todo.id}: ${todo.title}`).join("; ");
    return { error: `"${ref.title}" matches ${matches.length} todos — pass an id. Candidates: ${candidates}` };
  }
  return matches[0] as Todo;
}

function foundTodo(ref: TodoRef): TodoResult<{ todo: Todo; todos: Todo[] }> {
  const todos = readTodos();
  const todo = findTodo(todos, ref);
  return "error" in todo ? todo : { todo, todos };
}

/** Read the Todo collection through the domain interface. */
export function listTodos(options: ListTodosOptions = {}): { todos: Todo[]; today: string } {
  const todos = readTodos();
  return {
    todos: options.includeDone ? todos : todos.filter((todo) => !todo.done),
    today: localDate(),
  };
}

const DUE_LABEL: Record<DueBucket, (due: string) => string> = {
  overdue: (due) => ` (overdue, was due ${due})`,
  today: () => " (due today)",
  tomorrow: () => " (due tomorrow)",
  upcoming: (due) => ` (due ${due})`,
  none: () => "",
};

/** English tool-facing representation of one Todo. */
export function formatTodo(todo: Todo, today: string = localDate()): string {
  const box = todo.done ? "[x]" : "[ ]";
  const bucket = todo.done ? "none" : dueBucket(todo.due, today);
  const url = todoUrl(todo);
  const link = url ? ` -> ${url}${todo.url ? "" : " (auto)"}` : "";
  return `${box} ${todo.id}  ${todo.title}${DUE_LABEL[bucket](todo.due ?? "")}${link}`;
}

function normalizeTodoColor(value: string): EventColorKey {
  const color = value.trim().toLowerCase();
  if (!(EVENT_COLOR_KEYS as readonly string[]).includes(color)) {
    throw new Error(`Unknown todo colour: ${value}`);
  }
  return color as EventColorKey;
}

export function addTodo(input: { title: string; due?: string; url?: string }): { todo: Todo; open: number } {
  const title = input.title.trim();
  if (!title) throw new Error("title is required");
  const due = input.due?.trim() ? normalizeDue(input.due) : undefined;
  const url = input.url?.trim() ? normalizeUrl(input.url) : undefined;
  const todos = readTodos();
  const todo: Todo = {
    id: newId(),
    title,
    done: false,
    ...(due ? { due } : {}),
    ...(url ? { url } : {}),
    createdAt: new Date().toISOString(),
  };
  todos.push(todo);
  writeTodos(todos);
  return { todo, open: todos.filter((entry) => !entry.done).length };
}

export function updateTodo(ref: TodoRef, patch: TodoPatch): TodoResult<Todo> {
  const found = foundTodo(ref);
  if ("error" in found) return found;
  const { todo, todos } = found;

  if (patch.done !== undefined && patch.done !== todo.done) {
    todo.done = patch.done;
    if (patch.done) todo.completedAt = new Date().toISOString();
    else delete todo.completedAt;
  }
  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (!title) throw new Error("title cannot be empty");
    todo.title = title;
  }
  if (patch.due !== undefined) {
    if (patch.due.trim()) todo.due = normalizeDue(patch.due);
    else delete todo.due;
  }
  if (patch.url !== undefined) {
    if (patch.url.trim()) todo.url = normalizeUrl(patch.url);
    else delete todo.url;
  }
  if (patch.color !== undefined) {
    if (patch.color.trim()) todo.color = normalizeTodoColor(patch.color);
    else delete todo.color;
  }

  writeTodos(todos);
  return todo;
}

export function deleteTodo(ref: TodoRef): TodoResult<Todo> {
  const found = foundTodo(ref);
  if ("error" in found) return found;
  writeTodos(found.todos.filter((todo) => todo.id !== found.todo.id));
  return found.todo;
}

export function completeTodo(ref: TodoRef): TodoResult<{ todo: Todo; alreadyDone: boolean; open: number }> {
  const found = foundTodo(ref);
  if ("error" in found) return found;
  const alreadyDone = found.todo.done;
  if (!alreadyDone) {
    found.todo.done = true;
    found.todo.completedAt = new Date().toISOString();
    writeTodos(found.todos);
  }
  return {
    todo: found.todo,
    alreadyDone,
    open: found.todos.filter((todo) => !todo.done).length,
  };
}
