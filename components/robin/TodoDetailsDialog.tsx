"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { EditableTodo } from "@/extension/robin/todo-domain";
import { todoUrl } from "@/extension/robin/todo-links";
import { mutateResponse } from "./usePolledResource";
import { requestRefresh } from "./refreshBus";
import styles from "./CalendarPanel.module.css";

/** One original record, reached from search, daily summary or the task list. */
export function TodoDetailsDialog({ todo, loading, error, onSaved, onClose, onRetry }: {
  todo: EditableTodo | undefined; loading: boolean; error: string | null;
  onSaved: (todo: EditableTodo) => void; onClose: () => void; onRetry: () => void;
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    element?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    return () => { element?.close(); if (trigger?.isConnected) trigger.focus({ preventScroll: true }); };
  }, []);
  // The editor owns cancellation while saving/dirty, including native Escape.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  return <dialog ref={dialog} className={`calendar-event-dialog ${styles.editor}`} aria-label={t("daily.taskDetails")}
    onCancel={(e) => { e.preventDefault(); closeRef.current(); }}>
    {todo ? <TaskForm key={todo.id} initial={todo} onSaved={onSaved} onClose={onClose} closeRef={closeRef} /> : <>
      <header className={styles.editorHeader}><h2 className="pi-section-title">{t("daily.taskDetails")}</h2><button className={styles.iconButton} onClick={onClose} aria-label={t("daily.close")}>×</button></header>
      <div className={styles.editorForm}><p role={error ? "alert" : "status"}>{loading ? t("daily.recordLoading") : error || t("daily.recordMissing")}</p>
        {error && <button className="ui-action" onClick={onRetry}>{t("daily.retry")}</button>}</div>
    </>}
  </dialog>;
}

function TaskForm({ initial, onSaved, onClose, closeRef }: {
  initial: EditableTodo; onSaved: (todo: EditableTodo) => void; onClose: () => void; closeRef: React.RefObject<() => void>;
}) {
  const { t } = useI18n();
  const [saved, setSaved] = useState(initial);
  const [title, setTitle] = useState(initial.title);
  const [due, setDue] = useState(initial.due ?? "");
  const [startDate, setStartDate] = useState(initial.startDate ?? "");
  const [url, setUrl] = useState(initial.url ?? "");
  const [done, setDone] = useState(initial.done);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState(false);
  const lock = useRef(false);
  const dirty = title !== saved.title || due !== (saved.due ?? "") || startDate !== (saved.startDate ?? "") || url !== (saved.url ?? "") || done !== saved.done;
  const close = () => { if (!lock.current && (!dirty || window.confirm(t("robin.calendar.discardDraft")))) onClose(); };
  useEffect(() => { closeRef.current = close; });
  const destination = todoUrl(saved);
  const adopt = (todo: EditableTodo) => {
    setSaved(todo); setTitle(todo.title); setDue(todo.due ?? ""); setStartDate(todo.startDate ?? ""); setUrl(todo.url ?? ""); setDone(todo.done);
    onSaved(todo);
  };
  const reload = async () => {
    if (lock.current || (dirty && !window.confirm(t("robin.kanban.reloadEdits")))) return;
    lock.current = true; setBusy(true); setReceipt(false);
    try {
      const response = await fetch("/api/robin/todos");
      if (!response.ok) throw new Error(`Request failed (${response.status})`);
      const body = await response.json() as { todos: EditableTodo[] };
      const current = body.todos.find((todo) => todo.id === saved.id);
      if (!current) throw new Error(t("daily.recordMissing"));
      adopt(current); setError("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { lock.current = false; setBusy(false); }
  };
  return <>
    <header className={styles.editorHeader}><h2 className="pi-section-title">{t("daily.taskDetails")}</h2><button className={styles.iconButton} onClick={close} disabled={busy} aria-label={t("daily.close")}>×</button></header>
    <form className={styles.editorForm} onSubmit={(e) => {
      e.preventDefault(); if (lock.current || !title.trim()) return;
      lock.current = true; setBusy(true); setError(""); setReceipt(false);
      void (async () => {
        try {
          if (!saved.revision) throw new Error(t("robin.calendar.reloadTodo"));
          const response = await mutateResponse("/api/robin/todos", "PATCH", { id: saved.id, revision: saved.revision, title, due, startDate, url, done });
          const { todo } = await response.json() as { todo: EditableTodo };
          adopt(todo); setReceipt(true); requestRefresh();
        } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
        finally { lock.current = false; setBusy(false); }
      })();
    }}>
      <fieldset disabled={busy}>
        <label>{t("robin.todos.task")}<input required value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <div className={styles.editorDates}>
          <label>{t("robin.todos.startDate")}<input type="date" value={startDate} max={due || undefined} onChange={(e) => setStartDate(e.target.value)} /></label>
          <label>{t("robin.todos.dueDate")}<input type="date" required={!!startDate} min={startDate || undefined} value={due} onChange={(e) => setDue(e.target.value)} /></label>
        </div>
        <p className={styles.note}>{t("robin.calendar.todoDeadlineHint")}</p>
        <label>{t("robin.todos.link")}<input inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} /></label>
        <label className={styles.allDay}><input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} /> {t("daily.done")}</label>
        {destination && <a className="ui-action min-h-11 inline-flex items-center underline" href={destination} target="_blank" rel="noopener noreferrer">{t("daily.openDestination")} ↗</a>}
        {error && <div role="alert" className={styles.feedback}><p>{error}</p><button type="button" className="ui-action min-h-11" onClick={() => void reload()}>{t("daily.reload")}</button></div>}
        {receipt && !dirty && <p role="status">{t("daily.savedHint")}</p>}
        <div className={styles.editorActions}><button type="button" className={styles.control} onClick={close}>{t("daily.close")}</button><button className={styles.create} type="submit" disabled={!dirty || !title.trim()}>{t(busy ? "robin.common.saving" : "robin.common.save")}</button></div>
      </fieldset>
    </form>
  </>;
}
