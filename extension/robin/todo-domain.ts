/** Todo behavior shared by the HTTP and Pi tool adapters. */
import {
  findTodo,
  newId,
  normalizeDue,
  normalizeTodoColor,
  normalizeUrl,
  readTodos,
  writeTodos,
  type Todo,
} from "./store.ts";

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

export type TodoResult<T> = T | { error: string };

function foundTodo(ref: TodoRef): TodoResult<{ todo: Todo; todos: Todo[] }> {
  const todos = readTodos();
  const found = findTodo(todos, ref);
  return "error" in found ? found : { todo: found.todo, todos };
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
