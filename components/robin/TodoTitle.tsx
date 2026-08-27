"use client";

import type { CSSProperties } from "react";
import type { Todo } from "@/extension/robin/store";
import { todoUrl } from "@/extension/robin/todo-links";

/**
 * A todo's title, rendered as a link when the todo has one — set on it, or
 * inferred from the title by ./todo-links.
 *
 * Every surface that lists todos renders titles through here, so clicking a
 * todo always takes you to where the task actually lives. Completion belongs to
 * the checkbox alone — that is why nothing in here toggles `done`.
 */
export function TodoTitle({
  todo,
  className,
  style,
  t,
}: {
  todo: Todo;
  className?: string;
  style?: CSSProperties;
  t: (key: string, params?: Record<string, string>) => string;
}) {
  const url = todoUrl(todo);
  if (!url) {
    return <span className={className} style={style}>{todo.title}</span>;
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={t("robin.todos.openLink", { title: todo.title })}
      // Calendar cells put clickable chrome behind the todo row; the click that
      // opens the link must not also select the day underneath it.
      onClick={(event) => event.stopPropagation()}
      className={className}
      style={{
        ...style,
        textDecoration: todo.done ? "line-through" : "underline dotted",
        textUnderlineOffset: 2,
      }}
    >
      {todo.title}
    </a>
  );
}
