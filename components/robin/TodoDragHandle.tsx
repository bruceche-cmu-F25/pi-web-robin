"use client";

import { useI18n } from "@/hooks/useI18n";
import type { Todo } from "@/extension/robin/todo-domain";
import styles from "./CalendarInteractions.module.css";

/** Only the grip owns dragging; links, checkboxes and phone scrolling stay ordinary. */
export function TodoDragHandle({ todo }: { todo: Todo }) {
  const { t } = useI18n();
  if (todo.done || todo.archivedAt) return null;
  return <button type="button" className={styles.todoGrip} data-calendar-todo={todo.id} draggable={false}
    aria-haspopup="dialog" aria-label={t("robin.calendar.moveTodo", { title: todo.title })}
    title={t("robin.calendar.moveTodo", { title: todo.title })}>
    <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor" aria-hidden="true">
      <path d="M3 2h2v2H3zm4 0h2v2H7zM3 7h2v2H3zm4 0h2v2H7zM3 12h2v2H3zm4 0h2v2H7z" />
    </svg>
  </button>;
}
