"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { deadlineBucket, dueBucket, isInstantOnLocalDate, type DeadlineBucket } from "@/extension/robin/dates";
import { EVENT_COLOR_KEYS } from "@/extension/robin/eventColors";
import type { Todo } from "@/extension/robin/todo-domain";
import { inferTodoUrl } from "@/extension/robin/todo-links";
import { requestRefresh } from "./refreshBus";
import { TodoTitle } from "./TodoTitle";
import { usePopoverDismiss } from "./usePopoverDismiss";
import { mutate, usePolledResource } from "./usePolledResource";

interface TodosResponse {
  todos: Todo[];
  /** Local calendar date resolved on the server, where `due` was written. */
  today: string;
}

const SECTIONS: { bucket: DeadlineBucket; key: string }[] = [
  { bucket: "overdue", key: "robin.todos.overdue" },
  { bucket: "today", key: "robin.todos.today" },
  { bucket: "tomorrow", key: "robin.todos.tomorrow" },
  { bucket: "thisWeek", key: "robin.todos.thisWeek" },
  { bucket: "later", key: "robin.todos.later" },
  { bucket: "none", key: "robin.todos.someday" },
];

/** Due labels are built here rather than in the shared date module, which the
 *  English-only agent tools also use. */
function dueLabel(due: string, today: string, t: (key: string, params?: Record<string, string>) => string): string {
  const bucket = dueBucket(due, today);
  if (bucket === "today") return t("robin.todos.dueToday");
  if (bucket === "tomorrow") return t("robin.todos.dueTomorrow");
  if (bucket === "overdue") return t("robin.todos.dueOverdue", { date: due });
  return due;
}

const BUCKET_COLOR: Partial<Record<DeadlineBucket, string>> = {
  overdue: "var(--danger)",
  today: "var(--accent-amber)",
};

export function TodoPanel() {
  const { t } = useI18n();
  const { data, error, loading, refresh } = usePolledResource<TodosResponse>("/api/robin/todos");
  const [actionError, setActionError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [url, setUrl] = useState("");
  const [working, setWorking] = useState(false);

  const today = data?.today ?? "";
  const todos = useMemo(() => data?.todos ?? [], [data]);
  const open = useMemo(() => todos.filter((todo) => !todo.done), [todos]);
  const doneToday = useMemo(
    () => todos.filter((todo) => todo.done && isInstantOnLocalDate(todo.completedAt, today)),
    [todos, today],
  );

  const sections = useMemo(
    () =>
      SECTIONS.map((section) => ({
        ...section,
        items: open
          .filter((todo) => deadlineBucket(todo.due, today) === section.bucket)
          .sort((a, b) => (a.due ?? "").localeCompare(b.due ?? "")),
      })).filter((section) => section.items.length > 0),
    [open, today],
  );

  async function run(action: () => Promise<void>) {
    try {
      setWorking(true);
      setActionError(null);
      await action();
      await refresh();
      requestRefresh();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setWorking(false);
    }
  }

  const addTodo = (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    void run(async () => {
      await mutate("/api/robin/todos", "POST", {
        title,
        ...(due ? { due } : {}),
        ...(url.trim() ? { url } : {}),
      });
      setTitle("");
      setDue("");
      setUrl("");
      setAdding(false);
    });
  };

  return (
    <section
      className="pi-card flex flex-col gap-3 p-4"
    >
      <header className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h2 className="pi-label">{t("robin.todos.title")}</h2>
          <span className="text-xs" style={{ color: "var(--text-dim)" }}>
            {loading ? t("robin.common.loading") : t("robin.todos.open", { count: String(open.length) })}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setAdding((value) => !value)}
          aria-expanded={adding}
          aria-controls="robin-todo-form"
          className="ui-action pi-chrome-label pi-bracket text-xs"
        >
          {adding ? t("robin.common.cancel") : t("robin.common.add")}
        </button>
      </header>

      {adding && (
        <form id="robin-todo-form" onSubmit={addTodo} className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-52 flex-1 flex-col gap-1">
            <span className="pi-eyebrow">{t("robin.todos.task")}</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t("robin.todos.taskPlaceholder")}
              required
              autoFocus
              className="rounded px-2 py-1 text-sm outline-none"
              style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="pi-eyebrow">{t("robin.todos.dueDate")}</span>
            <input
              type="date"
              value={due}
              onChange={(event) => setDue(event.target.value)}
              className="rounded px-2 py-1 text-sm outline-none"
              style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text-muted)" }}
            />
          </label>
          <label className="flex min-w-52 flex-1 flex-col gap-1">
            <span className="pi-eyebrow">{t("robin.todos.link")}</span>
            <input
              inputMode="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder={t("robin.todos.linkPlaceholder")}
              className="rounded px-2 py-1 text-sm outline-none"
              style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }}
            />
          </label>
          <button
            type="submit"
            disabled={working || !title.trim()}
            className="ui-action ui-action--outline pi-bracket px-3 py-1 disabled:opacity-40"
            data-state="accent"
          >
            {t("robin.common.save")}
          </button>
        </form>
      )}

      {(error || actionError) && (
        <p role="alert" className="text-xs" style={{ color: "var(--accent)" }}>{actionError ?? error}</p>
      )}

      {!loading && open.length === 0 && (
        <p className="py-2 text-sm" style={{ color: "var(--text-dim)" }}>
          {t("robin.todos.empty")}
        </p>
      )}

      {sections.map((section) => (
        <div key={section.bucket} className="flex flex-col gap-1">
          <h3
            className="pi-eyebrow"
            style={{ color: BUCKET_COLOR[section.bucket] ?? "var(--text-dim)" }}
          >
            {t(section.key)}
          </h3>
          {section.items.map((todo) => (
            <TodoRow
              key={todo.id}
              todo={todo}
              today={today}
              onToggle={() => void run(() => mutate("/api/robin/todos", "PATCH", { id: todo.id, done: !todo.done }))}
              onColor={(color) => void run(() => mutate("/api/robin/todos", "PATCH", { id: todo.id, color }))}
              onLink={(next) => void run(() => mutate("/api/robin/todos", "PATCH", { id: todo.id, url: next }))}
              onDelete={() => void run(() => mutate("/api/robin/todos", "DELETE", { id: todo.id }))}
              t={t}
            />
          ))}
        </div>
      ))}

      {doneToday.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="pi-eyebrow">
            {t("robin.todos.completed", { count: String(doneToday.length) })}
          </h3>
          {doneToday.map((todo) => (
            <TodoRow
              key={todo.id}
              todo={todo}
              today={today}
              onToggle={() => void run(() => mutate("/api/robin/todos", "PATCH", { id: todo.id, done: false }))}
              onColor={(color) => void run(() => mutate("/api/robin/todos", "PATCH", { id: todo.id, color }))}
              onLink={(next) => void run(() => mutate("/api/robin/todos", "PATCH", { id: todo.id, url: next }))}
              onDelete={() => void run(() => mutate("/api/robin/todos", "DELETE", { id: todo.id }))}
              t={t}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function TodoRow({
  todo,
  today,
  onToggle,
  onColor,
  onLink,
  onDelete,
  t,
}: {
  todo: Todo;
  today: string;
  onToggle: () => void;
  onColor: (color: string) => void;
  onLink: (url: string) => void;
  onDelete: () => void;
  t: (key: string, params?: Record<string, string>) => string;
}) {
  const overdue = !todo.done && dueBucket(todo.due, today) === "overdue";
  const colorPicker = usePopoverDismiss();
  return (
    <div
      className="group flex items-center gap-2 rounded px-2 py-1"
      style={overdue
        ? { background: "var(--danger-soft)", borderLeft: "2px solid var(--danger)" }
        : { background: "var(--bg-subtle)", borderLeft: "2px solid transparent" }}
    >
      <input
        type="checkbox"
        checked={todo.done}
        onChange={onToggle}
        aria-label={todo.done
          ? t("robin.todos.reopen", { title: todo.title })
          : t("robin.todos.complete", { title: todo.title })}
        className="shrink-0 cursor-pointer"
      />
      <TodoTitle
        todo={todo}
        t={t}
        className="min-w-0 flex-1 truncate text-sm"
        style={{
          color: todo.done
            ? "var(--text-dim)"
            : todo.color ? `var(--todo-${todo.color})` : "var(--text)",
          textDecoration: todo.done ? "line-through" : "none",
        }}
      />
      {todo.due && !todo.done && (
        <span className="shrink-0 text-xs" style={{ color: overdue ? "var(--danger)" : "var(--text-dim)" }}>
          {dueLabel(todo.due, today, t)}
        </span>
      )}
      <LinkEditor todo={todo} onLink={onLink} t={t} />
      <details ref={colorPicker} className="relative shrink-0">
        <summary
          aria-label={t("robin.todos.chooseColor", { title: todo.title })}
          title={t("robin.todos.chooseColor", { title: todo.title })}
          className="ui-action flex h-7 w-7 cursor-pointer list-none items-center justify-center"
          style={{ color: todo.color ? `var(--todo-${todo.color})` : "var(--text-dim)" }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3a9 9 0 1 0 0 18h1.5a1.5 1.5 0 0 0 0-3H12a2 2 0 0 1 0-4h5a4 4 0 0 0 4-4c0-3.87-4.03-7-9-7Z" />
            <circle cx="7.5" cy="10.5" r=".8" fill="currentColor" stroke="none" />
            <circle cx="10" cy="7" r=".8" fill="currentColor" stroke="none" />
            <circle cx="14.5" cy="7.5" r=".8" fill="currentColor" stroke="none" />
          </svg>
        </summary>
        <div
          className="absolute right-0 top-full flex gap-1 p-1.5"
          style={{
            zIndex: "var(--z-popover)",
            background: "var(--bg-panel)",
            border: "1px solid var(--border-strong)",
            boxShadow: "var(--popover-shadow)",
          }}
          aria-label={t("robin.todos.chooseColor", { title: todo.title })}
        >
          <button
            type="button"
            onClick={(event) => {
              onColor("");
              event.currentTarget.closest("details")?.removeAttribute("open");
            }}
            aria-pressed={!todo.color}
            aria-label={t("robin.todos.resetColor", { title: todo.title })}
            title={t("robin.todos.resetColor", { title: todo.title })}
            className="ui-action flex h-7 w-7 items-center justify-center"
            style={!todo.color ? { outline: "2px solid var(--focus-ring)", outlineOffset: 1 } : undefined}
          >
            ×
          </button>
          {EVENT_COLOR_KEYS.map((color, index) => (
            <button
              key={color}
              type="button"
              onClick={(event) => {
                onColor(color);
                event.currentTarget.closest("details")?.removeAttribute("open");
              }}
              aria-pressed={todo.color === color}
              aria-label={t("robin.todos.colorOption", { title: todo.title, number: String(index + 1) })}
              title={t("robin.todos.colorOption", { title: todo.title, number: String(index + 1) })}
              className="h-7 w-7"
              style={{
                background: `var(--todo-${color})`,
                border: "1px solid var(--border-strong)",
                outline: todo.color === color ? "2px solid var(--focus-ring)" : undefined,
                outlineOffset: 1,
              }}
            />
          ))}
        </div>
      </details>
      <button
        type="button"
        onClick={onDelete}
        aria-label={t("robin.todos.delete", { title: todo.title })}
        className="shrink-0 px-1 text-xs opacity-0 transition-opacity group-hover:opacity-100"
        style={{ color: "var(--text-dim)" }}
      >
        ✕
      </button>
    </div>
  );
}

/**
 * Set or clear where a todo points.
 *
 * The agent fills this in through todo_add/todo_update; this is the same field
 * by hand. A scheme-less host like "github.com/x" is accepted — the server
 * normalizes it — so the input is deliberately not type="url".
 */
function LinkEditor({
  todo,
  onLink,
  t,
}: {
  todo: Todo;
  onLink: (url: string) => void;
  t: (key: string, params?: Record<string, string>) => string;
}) {
  const [value, setValue] = useState(todo.url ?? "");
  const details = usePopoverDismiss();
  const close = (element: HTMLElement) => element.closest("details")?.removeAttribute("open");
  // What the row already opens without a link of its own, shown as the
  // placeholder so it is clear what typing an address would replace.
  const inferred = todo.url ? undefined : inferTodoUrl(todo.title);

  return (
    <details
      ref={details}
      className="relative shrink-0"
      onToggle={(event) => {
        if (event.currentTarget.open) setValue(todo.url ?? "");
      }}
    >
      <summary
        aria-label={t("robin.todos.editLink", { title: todo.title })}
        title={t("robin.todos.editLink", { title: todo.title })}
        className="ui-action flex h-7 w-7 cursor-pointer list-none items-center justify-center"
        style={{ color: todo.url ? "var(--accent)" : inferred ? "var(--text-muted)" : "var(--text-dim)" }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11.5 4.5" />
          <path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07l1.32-1.32" />
        </svg>
      </summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onLink(value.trim());
          close(event.currentTarget);
        }}
        className="absolute right-0 top-full flex items-center gap-1 p-1.5"
        style={{
          zIndex: "var(--z-popover)",
          // Anchored to the row's right edge, so the width has to stay inside
          // the viewport on a phone as well.
          width: "min(22rem, calc(100vw - 6rem))",
          background: "var(--bg-panel)",
          border: "1px solid var(--border-strong)",
          boxShadow: "var(--popover-shadow)",
        }}
      >
        <input
          inputMode="url"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={inferred ?? t("robin.todos.linkPlaceholder")}
          aria-label={t("robin.todos.editLink", { title: todo.title })}
          className="min-w-0 flex-1 rounded px-2 py-1 text-sm outline-none"
          style={{
            background: "var(--bg)",
            border: "1px solid var(--border)",
            color: "var(--text)",
          }}
        />
        <button type="submit" className="ui-action pi-bracket shrink-0 px-2 py-1 text-xs">
          {t("robin.common.save")}
        </button>
        {todo.url && (
          <button
            type="button"
            onClick={(event) => {
              onLink("");
              close(event.currentTarget);
            }}
            aria-label={t("robin.todos.removeLink", { title: todo.title })}
            title={t("robin.todos.removeLink", { title: todo.title })}
            className="ui-action shrink-0 px-2 py-1 text-xs"
            style={{ color: "var(--text-dim)" }}
          >
            ×
          </button>
        )}
      </form>
    </details>
  );
}
