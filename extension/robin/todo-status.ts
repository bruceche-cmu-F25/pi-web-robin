/** Browser-safe workflow vocabulary; legacy todos only have `done`. */
export const TODO_STATUSES = ["todo", "doing", "done"] as const;
export type TodoStatus = typeof TODO_STATUSES[number];

export function isTodoStatus(value: unknown): value is TodoStatus {
  return TODO_STATUSES.some((status) => status === value);
}

/** `done` stays authoritative for existing calendar, round and tool callers. */
export function todoStatus(todo: { done: boolean; status?: TodoStatus }): TodoStatus {
  return todo.done ? "done" : todo.status === "doing" ? "doing" : "todo";
}
