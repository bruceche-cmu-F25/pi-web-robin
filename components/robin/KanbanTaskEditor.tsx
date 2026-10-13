"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { EditableTodo } from "@/extension/robin/todo-domain";
import { TODO_STATUSES, isTodoStatus, todoStatus, type TodoStatus } from "@/extension/robin/todo-status";
import { changedTaskFields, editorFields, readTaskDraft, taskDraftKey, taskValues, type KanbanEditor, type TaskDraft, type TaskFields } from "./kanban-editor";
import styles from "./KanbanBoard.module.css";

const API = "/api/robin/todos";
export function KanbanTaskEditor({ editor, onClose, onSaved }: {
  editor: KanbanEditor;
  onClose: () => void;
  onSaved: (result: "saved" | "deleted", status?: TodoStatus) => void;
}) {
  const { t } = useI18n();
  const key = taskDraftKey(editor.todo?.id);
  const [draft, setDraft] = useState<TaskDraft>(() => {
    try {
      const saved = readTaskDraft(sessionStorage.getItem(key));
      if (saved && (!editor.todo || saved.revision)) return saved;
    } catch { /* Private browsing. */ }
    const fields = editorFields(editor);
    return { base: fields, fields, revision: editor.todo?.revision };
  });
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const busy = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const fields = draft.fields;
  const patch = changedTaskFields(draft.base, fields);
  const dirty = Object.keys(patch).length > 0;

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    if (window.matchMedia("(pointer: fine)").matches) element?.querySelector("textarea")?.focus();
    return () => element?.close();
  }, []);
  useEffect(() => {
    try { if (dirty) sessionStorage.setItem(key, JSON.stringify(draft)); else sessionStorage.removeItem(key); } catch { /* Confirmation still protects closing. */ }
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, draft, key]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  function clearDraft() { try { sessionStorage.removeItem(key); } catch { /* Private browsing. */ } }
  function close() {
    if (busy.current || (dirty && !window.confirm(t("robin.kanban.discardEdits")))) return;
    clearDraft(); onClose();
  }
  function change<K extends keyof TaskFields>(name: K, value: TaskFields[K]) {
    setDraft((current) => ({ ...current, fields: { ...current.fields, [name]: value } }));
  }
  async function write(method: "POST" | "PATCH" | "DELETE") {
    if (busy.current) return;
    if (method === "DELETE" && !window.confirm(t("robin.common.deleteConfirm", { title: fields.title }))) return;
    busy.current = true; setWorking(true); setError(null); setConflict(false);
    try {
      const body = { ...(method === "POST" ? taskValues(fields) : method === "PATCH" ? patch : {}),
        ...(editor.todo ? { id: editor.todo.id, revision: draft.revision } : {}) };
      const response = await fetch(API, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (response.status === 409) { setConflict(true); throw new Error(t("robin.kanban.editConflict")); }
      if (!response.ok) throw new Error(result.error ?? `Request failed (${response.status})`);
      clearDraft();
      onSaved(method === "DELETE" ? "deleted" : "saved", result.todo?.status);
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { busy.current = false; setWorking(false); }
  }
  async function reloadLatest() {
    if (busy.current || (dirty && !window.confirm(t("robin.kanban.reloadEdits")))) return;
    busy.current = true; setWorking(true); setError(null);
    try {
      const response = await fetch(`${API}?includeArchived=true`);
      if (!response.ok) throw new Error(`Request failed (${response.status})`);
      const result = await response.json() as { todos: EditableTodo[] };
      const todo = result.todos.find((item) => item.id === editor.todo?.id);
      if (!todo) throw new Error(t("robin.kanban.taskGone"));
      const fresh = editorFields({ todo, status: todoStatus(todo) });
      setDraft({ base: fresh, fields: fresh, revision: todo.revision });
      clearDraft(); setConflict(false);
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { busy.current = false; setWorking(false); }
  }
  function submit(event: FormEvent) { event.preventDefault(); if (fields.title.trim()) void write(editor.todo ? "PATCH" : "POST"); }

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="kanban-editor-title" onCancel={(event) => { event.preventDefault(); close(); }}>
    <form onSubmit={submit} className={styles.editorForm}>
      <header className={styles.editorHeader}>
        <h2 id="kanban-editor-title">{t(editor.todo ? "robin.kanban.edit" : "robin.kanban.newTask")}</h2>
        <button type="button" className="ui-action pi-bracket" disabled={working} onClick={close}>{t("robin.common.cancel")}</button>
      </header>
      <fieldset disabled={working} className={styles.fields}>
        {dirty && <p className={styles.notice}>{t("robin.kanban.draftNotice")}</p>}
        <div className={styles.titleField}><label htmlFor="kanban-task-title">{t("robin.todos.task")}</label>
          <textarea id="kanban-task-title" name="title" autoComplete="off" required rows={3} value={fields.title} onChange={(event) => change("title", event.target.value)} /></div>
        <label>{t("robin.kanban.status")}<select name="status" value={fields.status} onChange={(event) => { if (isTodoStatus(event.target.value)) change("status", event.target.value); }}>
          {TODO_STATUSES.map((status) => <option key={status} value={status}>{t(`robin.kanban.${status}`)}</option>)}
        </select></label>
        <div className={styles.dates}>
          <label>{t("robin.todos.startDate")}<input name="startDate" type="date" value={fields.startDate} max={fields.due || undefined} onChange={(event) => change("startDate", event.target.value)} /></label>
          <label>{t("robin.todos.dueDate")}<input name="due" type="date" value={fields.due} min={fields.startDate || undefined} required={Boolean(fields.startDate)} onChange={(event) => change("due", event.target.value)} /></label>
        </div>
        <div className={styles.dates}>
          <label>{t("robin.kanban.plannedOn")}<input name="plannedOn" type="date" value={fields.plannedOn} onChange={(event) => change("plannedOn", event.target.value)} /></label>
          <label>{t("robin.kanban.estimate")}<input name="estimate" type="number" min="5" max="720" step="1" value={fields.estimate} onChange={(event) => change("estimate", event.target.value)} /></label>
        </div>
        <p className={styles.notice}>{t("robin.kanban.planDateHint")}</p>
        <label>{t("robin.todos.link")}<input name="url" inputMode="url" autoComplete="off" spellCheck={false} value={fields.url} placeholder={t("robin.todos.linkPlaceholder")} onChange={(event) => change("url", event.target.value)} /></label>
      </fieldset>
      {error && <p ref={errorRef} tabIndex={-1} role="alert" className={styles.error}>{error}</p>}
      {conflict && <button type="button" className="ui-action pi-bracket" disabled={working} onClick={() => void reloadLatest()}>{t("robin.kanban.reloadLatest")}</button>}
      <footer className={styles.editorFooter}>
        {editor.todo && <button type="button" className={`ui-action pi-bracket ${styles.delete}`} disabled={working} onClick={() => void write("DELETE")}>{t("robin.kanban.delete")}</button>}
        <button type="submit" className="ui-action pi-bracket" data-state="accent" disabled={working || !fields.title.trim() || Boolean(editor.todo && !dirty)}>{t(working ? "robin.kanban.saving" : "robin.common.save")}</button>
      </footer>
    </form>
  </dialog>;
}
