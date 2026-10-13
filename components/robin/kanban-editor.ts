import type { EditableTodo, TodoPatch } from "@/extension/robin/todo-domain";
import { isTodoStatus, type TodoStatus } from "@/extension/robin/todo-status";

export type KanbanEditor = { todo?: EditableTodo; status: TodoStatus; plannedOn?: string };
export type TaskFields = { title: string; status: TodoStatus; startDate: string; due: string; plannedOn: string; estimate: string; url: string };
export type TaskDraft = { base: TaskFields; fields: TaskFields; revision?: string };
export const taskDraftKey = (id?: string) => `robin-kanban-draft:${id ?? "new"}`;

export function editorFields(editor: KanbanEditor): TaskFields {
  const todo = editor.todo;
  return { title: todo?.title ?? "", status: editor.status, startDate: todo?.startDate ?? "", due: todo?.due ?? "",
    plannedOn: todo?.plannedOn ?? editor.plannedOn ?? "", estimate: todo?.estimateMinutes?.toString() ?? "", url: todo?.url ?? "" };
}
export function taskValues(fields: TaskFields): TodoPatch & { title: string } {
  return { title: fields.title.trim(), status: fields.status, startDate: fields.startDate, due: fields.due,
    plannedOn: fields.plannedOn, estimateMinutes: fields.estimate ? Number(fields.estimate) : null, url: fields.url.trim() };
}
/** Compare normalized values, so untouched dates/status and Agent estimates never get rewritten. */
export function changedTaskFields(base: TaskFields, fields: TaskFields): TodoPatch {
  const before = taskValues(base);
  return Object.fromEntries(Object.entries(taskValues(fields)).filter(([key, value]) => value !== before[key as keyof typeof before]));
}
export function readTaskDraft(raw: string | null): TaskDraft | null {
  if (!raw) return null;
  try {
    const draft = JSON.parse(raw) as TaskDraft;
    const valid = (fields: TaskFields) => fields && ["title", "startDate", "due", "plannedOn", "estimate", "url"].every((key) => typeof fields[key as keyof TaskFields] === "string") && isTodoStatus(fields.status);
    return valid(draft.base) && valid(draft.fields) && (draft.revision === undefined || typeof draft.revision === "string") ? draft : null;
  } catch { return null; }
}
