"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { Todo } from "@/extension/robin/todo-domain";
import styles from "./CalendarPanel.module.css";

export function TodoDeadlineEditor({ todo, error, onSave, onClose }: {
  todo: Todo; error: string | null;
  onSave: (dates: { due: string; startDate: string }) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const heading = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [due, setDue] = useState(todo.due ?? "");
  const [startDate, setStartDate] = useState(todo.startDate ?? "");
  useEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal(); input.current?.focus({ preventScroll: true });
    return () => { element?.close(); if (trigger?.isConnected) trigger.focus({ preventScroll: true }); };
  }, []);
  const close = () => {
    if (submitting.current) return;
    if ((due !== (todo.due ?? "") || startDate !== (todo.startDate ?? "")) && !window.confirm(t("robin.calendar.discardDraft"))) return;
    onClose();
  };
  return <dialog ref={dialog} className={styles.editor} aria-labelledby={heading}
    onCancel={(event) => { event.preventDefault(); close(); }}
    onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
    <header className={styles.editorHeader}>
      <h2 id={heading} className="pi-eyebrow">{t("robin.calendar.editTodoDeadline")}</h2>
      <button type="button" className={styles.iconButton} aria-label={t("i18n.close")} disabled={busy} onClick={close}>×</button>
    </header>
    <form className={styles.editorForm} aria-busy={busy} onSubmit={(event) => {
      event.preventDefault();
      if (submitting.current) return;
      submitting.current = true; setBusy(true);
      void onSave({ due, startDate }).then((saved) => { if (saved) onClose(); })
        .finally(() => { submitting.current = false; setBusy(false); });
    }}>
      <p className="min-w-0 [overflow-wrap:anywhere]">{todo.title}</p>
      <fieldset disabled={busy}>
        <div className={styles.editorDates}>
          <label>{t("robin.todos.startDate")}<input type="date" value={startDate} max={due || undefined} onChange={(event) => setStartDate(event.target.value)} /></label>
          <label>{t("robin.todos.dueDate")}<input ref={input} type="date" required={Boolean(startDate)} min={startDate || undefined} value={due} onChange={(event) => setDue(event.target.value)} /></label>
        </div>
        <p className={styles.note}>{t("robin.calendar.todoDeadlineHint")}</p>
        {error && <p role="alert" className={styles.feedback}>{error}</p>}
        <div className={styles.editorActions}>
          <button type="button" className={styles.control} onClick={close}>{t("robin.common.cancel")}</button>
          <button type="submit" className={styles.create}>{t(busy ? "robin.calendar.saving" : "robin.common.save")}</button>
        </div>
      </fieldset>
    </form>
  </dialog>;
}
