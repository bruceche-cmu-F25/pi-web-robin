"use client";

import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { writeUrlState } from "@/lib/url-state";
import { addDays } from "@/extension/robin/dates";
import { TodoDetailsDialog } from "./TodoDetailsDialog";
import { useI18n } from "@/hooks/useI18n";
import { useIsSplitLayout } from "@/hooks/useIsMobile";
import { deadlineBucket, dueBucket, formatLocalDateRange, isInstantOnLocalDate, type DeadlineBucket } from "@/extension/robin/dates";
import { EVENT_COLOR_KEYS } from "@/extension/robin/eventColors";
import type { EditableTodo, Todo } from "@/extension/robin/todo-domain";
import { inferTodoUrl, todoUrl } from "@/extension/robin/todo-links";
import { requestRefresh } from "./refreshBus";
import { TodoTitle } from "./TodoTitle";
import { TodoDragHandle } from "./TodoDragHandle";
import { ReadableText } from "./ReadableText";
import { usePopoverDismiss } from "./usePopoverDismiss";
import { mutateResponse, ResourceActivity, usePolledResource } from "./usePolledResource";
import styles from "./TodoPanel.module.css";

interface TodosResponse {
  todos: EditableTodo[];
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

function todoDateLabel(
  todo: Todo,
  today: string,
  locale: string,
  t: (key: string, params?: Record<string, string>) => string,
): string {
  if (!todo.startDate) return todo.due ? dueLabel(todo.due, today, t) : "";
  return formatLocalDateRange(todo.startDate, todo.due ?? todo.startDate, locale, today);
}

const BUCKET_COLOR: Partial<Record<DeadlineBucket, string>> = {
  overdue: "var(--danger)",
  today: "var(--accent-amber)",
};

export function TodoPanel({ embedded = false }: { embedded?: boolean }) {
  const { t, locale } = useI18n();
  const { data, error, loading, refresh, updateData } = usePolledResource<TodosResponse>("/api/robin/todos");
  const search = useSearchParams();
  const filter = search.get("tasks") === "done" ? "done" : search.get("tasks") === "near" ? "near" : "all";
  const selectedId = search.get("todo");
  const showDetails = (todo: Todo) => writeUrlState({ todo: todo.id });
  const [actionError, setActionError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const active = useContext(ResourceActivity);
  const titleInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [due, setDue] = useState("");
  const [url, setUrl] = useState("");
  const [working, setWorking] = useState(false);
  const addingRef = useRef(false);
  const writes = useRef(new Map<string, Promise<void>>());

  useEffect(() => {
    if (!active || search.get("add") !== "todo") return;
    setAdding(true);
    if (adding) {
      titleInput.current?.focus({ preventScroll: true });
      titleInput.current?.scrollIntoView({ block: "center", behavior: "instant" });
    }
  }, [search, active, adding]);
  const today = data?.today ?? "";
  const todos = useMemo(() => data?.todos ?? [], [data]);
  const open = useMemo(() => todos.filter((todo) => !todo.done), [todos]);
  const doneToday = useMemo(
    () => todos.filter((todo) => todo.done && (filter === "done" || isInstantOnLocalDate(todo.completedAt, today))),
    [todos, today, filter],
  );

  const sections = useMemo(
    () =>
      SECTIONS.map((section) => ({
        ...section,
        items: open
          .filter((todo) => filter !== "done" && (filter !== "near" || (todo.due && today && todo.due <= addDays(today, 7))) && deadlineBucket(todo.due, today) === section.bucket)
          .sort((a, b) => (a.due ?? "").localeCompare(b.due ?? "")),
      })).filter((section) => section.items.length > 0),
    [open, today, filter],
  );

  async function run(action: () => Promise<void>) {
    try {
      setActionError(null);
      await action();
      await refresh();
      requestRefresh();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  // Keep confirmed writes even when the follow-up GET fails. Serialize each
  // record's writes too: a slow color receipt must not undo a later completion.
  function writeTodo(method: "POST" | "PATCH" | "DELETE", body: Record<string, unknown>): Promise<void> {
    const id = typeof body.id === "string" ? body.id : ""; // Creation is already single-flight.
    const write = async () => {
      const response = await mutateResponse("/api/robin/todos", method, body);
      if (method === "DELETE") {
        updateData((current) => current && { ...current, todos: current.todos.filter((todo) => todo.id !== id) });
        return;
      }
      const { todo: saved, today } = await response.json() as { todo: EditableTodo; today: string };
      updateData((current) => {
        const todos = current?.todos ?? [];
        return { ...current, today, todos: todos.some((todo) => todo.id === saved.id)
          ? todos.map((todo) => todo.id === saved.id ? saved : todo)
          : [...todos, saved] };
      });
    };
    const previous = writes.current.get(id);
    const pending = previous ? previous.catch(() => {}).then(write) : write();
    writes.current.set(id, pending);
    const release = () => { if (writes.current.get(id) === pending) writes.current.delete(id); };
    void pending.then(release, release);
    return pending;
  }

  const addTodo = (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || addingRef.current) return;
    addingRef.current = true;
    setWorking(true);
    void run(async () => {
      await writeTodo("POST", {
        title,
        ...(startDate ? { startDate } : {}),
        ...(due ? { due } : {}),
        ...(url.trim() ? { url } : {}),
      });
      setTitle("");
      setStartDate("");
      setDue("");
      setUrl("");
      setAdding(false);
      if (search.get("add") === "todo") writeUrlState({ add: null }, "replace");
    }).finally(() => {
      addingRef.current = false;
      setWorking(false);
    });
  };

  return (
    <section
      id="dashboard-todos"
      tabIndex={-1}
      className={`${styles.panel} flex scroll-mt-24 flex-col gap-3${embedded ? "" : " pi-card p-4"}`}
    >
      <header className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h2 className="pi-section-title">{t("robin.todos.title")}</h2>
          <span className="text-xs" style={{ color: "var(--text-dim)" }}>
            {loading ? t("robin.common.loading") : t("robin.todos.open", { count: String(open.length) })}
          </span>
        </div>
        <button
          type="button"
          onClick={() => { setAdding((value) => !value); if (adding && search.get("add") === "todo") writeUrlState({ add: null }, "replace"); }}
          aria-expanded={adding}
          aria-controls="robin-todo-form"
          className="robin-panel-add ui-action pi-chrome-label pi-bracket text-xs"
        >
          {adding ? t("robin.common.cancel") : t("robin.common.add")}
        </button>
      </header>

      <nav className={`${styles.filters} flex flex-wrap gap-2`} aria-label={t("robin.todos.title")}>
        {(["near", "all", "done"] as const).map((value) => <button key={value} type="button" className="ui-action ui-action--outline px-3 min-h-11" data-state={filter === value ? "accent" : undefined} aria-pressed={filter === value} onClick={() => writeUrlState({ tasks: value })}>{t(`daily.filter.${value}`)}</button>)}
      </nav>
      {selectedId && <TodoDetailsDialog key={selectedId} todo={todos.find((todo) => todo.id === selectedId)} loading={loading} error={error}
        onClose={() => writeUrlState({ todo: null }, "replace")} onRetry={() => void refresh()}
        onSaved={(saved) => updateData((current) => current && { ...current, todos: current.todos.map((todo) => todo.id === saved.id ? saved : todo) })} />}
      {adding && (
        <form id="robin-todo-form" onSubmit={addTodo} className={`${styles.addForm} flex flex-wrap items-end gap-2`}>
          <label className="flex min-w-52 flex-1 flex-col gap-1">
            <span className="pi-eyebrow">{t("robin.todos.task")}</span>
            <input
              ref={titleInput}
              enterKeyHint="done"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t("robin.todos.taskPlaceholder")}
              required
              autoFocus
              className="rounded px-2 py-1 text-sm outline-none"
              style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }}
            />
          </label>
          <details className={styles.optionalFields} open={embedded || undefined}>
            <summary className="ui-action">{t("daily.taskOptions")}</summary>
            <div className={styles.optionalFieldInputs}>
          <label className="flex flex-col gap-1">
            <span className="pi-eyebrow">{t("robin.todos.startDate")}</span>
            <input
              type="date"
              value={startDate}
              max={due || undefined}
              onChange={(event) => setStartDate(event.target.value)}
              className="rounded px-2 py-1 text-sm outline-none"
              style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text-muted)" }}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="pi-eyebrow">{t("robin.todos.dueDate")}</span>
            <input
              type="date"
              value={due}
              min={startDate || undefined}
              required={Boolean(startDate)}
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
            </div>
          </details>
          <button
            type="submit"
            disabled={working || !title.trim()}
            className="ui-action ui-action--outline pi-bracket px-3 py-1 disabled:opacity-40"
            data-state="accent"
          >
            {t(working ? "robin.common.saving" : "robin.common.save")}
          </button>
        </form>
      )}

      {(error || actionError) && (
        <p role="alert" className="text-xs" style={{ color: "var(--accent)" }}>{actionError ?? error}</p>
      )}

      {!loading && !error && (filter === "done" ? !doneToday.length : !sections.length) && (
        <p className="py-2 text-sm" style={{ color: "var(--text-dim)" }}>
          {t("daily.noTasks")}
        </p>
      )}

      {sections.map((section) => (
        <details
          key={section.bucket}
          open
          className={`${styles.taskGroup} border-t`}
          style={{ borderColor: "var(--border)" }}
        >
          <summary className="ui-action min-h-[28px] cursor-pointer py-1 text-xs marker:text-[8px] [@media(pointer:coarse)]:min-h-[44px] [@media(pointer:coarse)]:py-3" style={{ color: BUCKET_COLOR[section.bucket] ?? "var(--text-dim)" }}>
            <h3 className="pi-eyebrow inline">{t(section.key)} · {section.items.length}</h3>
          </summary>
          <div className="flex flex-col gap-1 pb-2">
            {section.items.map((todo) => (
              <TodoRow
                key={todo.id}
                todo={todo}
                today={today}
                locale={locale}
                onDetails={() => showDetails(todo)}
                onToggle={() => run(() => writeTodo("PATCH", { id: todo.id, done: !todo.done }))}
                onColor={(color) => void run(() => writeTodo("PATCH", { id: todo.id, color }))}
                onLink={(next) => void run(() => writeTodo("PATCH", { id: todo.id, url: next }))}
                onDelete={() => void run(() => writeTodo("DELETE", { id: todo.id }))}
                t={t}
              />
            ))}
          </div>
        </details>
      ))}

      {filter !== "near" && doneToday.length > 0 && (
        <details open={filter === "done" || undefined} className={`robin-completed-todos ${styles.taskGroup} border-t`} style={{ borderColor: "var(--border)" }}>
          <summary className="ui-action min-h-[28px] cursor-pointer py-1 text-xs marker:text-[8px] [@media(pointer:coarse)]:min-h-[44px] [@media(pointer:coarse)]:py-3" style={{ color: "var(--text-dim)" }}>
            <h3 className="pi-eyebrow inline">
              {t("robin.todos.completed", { count: String(doneToday.length) })}
            </h3>
          </summary>
          <div className="flex flex-col gap-1 pb-2">
            {doneToday.map((todo) => (
              <TodoRow
                key={todo.id}
                todo={todo}
                today={today}
                locale={locale}
                onDetails={() => showDetails(todo)}
                onToggle={() => run(() => writeTodo("PATCH", { id: todo.id, done: false }))}
                onColor={(color) => void run(() => writeTodo("PATCH", { id: todo.id, color }))}
                onLink={(next) => void run(() => writeTodo("PATCH", { id: todo.id, url: next }))}
                onDelete={() => void run(() => writeTodo("DELETE", { id: todo.id }))}
                t={t}
              />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function TodoRow({
  todo,
  today,
  locale,
  onToggle,
  onColor,
  onLink,
  onDelete,
  onDetails,
  t,
}: {
  todo: Todo;
  today: string;
  locale: string;
  onToggle: () => Promise<void>;
  onColor: (color: string) => void;
  onLink: (url: string) => void;
  onDelete: () => void;
  onDetails: () => void;
  t: (key: string, params?: Record<string, string>) => string;
}) {
  const overdue = !todo.done && dueBucket(todo.due, today) === "overdue";
  const titleStyle = {
    color: todo.done ? "var(--text-dim)" : "var(--text)",
    fontWeight: todo.done ? 400 : 600,
    textDecoration: todo.done ? "line-through" : todoUrl(todo) ? "underline dotted" : "none",
    textUnderlineOffset: 2,
  };
  const [toggling, setToggling] = useState(false);
  const togglingRef = useRef(false);
  // Keep the server's check mark until confirmed. Only this row gets pending
  // feedback; the ref also blocks repeat activation before React commits.
  async function toggle() {
    if (togglingRef.current) return;
    togglingRef.current = true;
    setToggling(true);
    try {
      await onToggle();
    } finally {
      togglingRef.current = false;
      setToggling(false);
    }
  }
  const mobile = !useIsSplitLayout();
  const actionsMenu = usePopoverDismiss();
  const colorPicker = usePopoverDismiss();
  const actions = (
    <>
      <button type="button" onClick={onDetails} aria-haspopup="dialog"
        aria-label={t("daily.openTask", { title: todo.title })}
        className="ui-action flex h-[44px] w-[44px] desktop:h-[28px] desktop:w-[28px] shrink-0 items-center justify-center" style={{ color: "var(--text-muted)" }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <rect x="4" y="5" width="16" height="16" rx="1" /><path d="M8 2v6m8-6v6M4 11h16m-10 4h4" />
        </svg>
      </button>
      <LinkEditor todo={todo} onLink={onLink} t={t} />
      <details ref={colorPicker} className="relative shrink-0">
        <summary
          aria-label={t("robin.todos.chooseColor", { title: todo.title })}
          title={t("robin.todos.chooseColor", { title: todo.title })}
          className="ui-action flex h-[44px] w-[44px] cursor-pointer list-none items-center justify-center desktop:h-[28px] desktop:w-[28px]"
          style={{ color: todo.color ? `var(--todo-${todo.color})` : "var(--text-muted)" }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3a9 9 0 1 0 0 18h1.5a1.5 1.5 0 0 0 0-3H12a2 2 0 0 1 0-4h5a4 4 0 0 0 4-4c0-3.87-4.03-7-9-7Z" />
            <circle cx="7.5" cy="10.5" r=".8" fill="currentColor" stroke="none" />
            <circle cx="10" cy="7" r=".8" fill="currentColor" stroke="none" />
            <circle cx="14.5" cy="7.5" r=".8" fill="currentColor" stroke="none" />
          </svg>
        </summary>
        <div
          className="absolute right-0 top-full grid w-max grid-cols-4 gap-1 p-1.5 desktop:flex"
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
            className="ui-action flex h-[44px] w-[44px] items-center justify-center desktop:h-[28px] desktop:w-[28px]"
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
              className="ui-action h-[44px] w-[44px] desktop:h-[28px] desktop:w-[28px]"
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
        onClick={() => {
          if (window.confirm(t("robin.common.deleteConfirm", { title: todo.title }))) onDelete();
        }}
        aria-label={t("robin.todos.delete", { title: todo.title })}
        className="ui-action h-[44px] w-[44px] shrink-0 text-xs desktop:h-[28px] desktop:w-[28px]"
        style={{ color: "var(--text-muted)" }}
      >
        ✕
      </button>
    </>
  );

  return (
    <div
      data-todo-id={todo.id}
      data-overdue={overdue || undefined}
      className={`${styles.row} group/todo grid grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-x-2 rounded px-2 py-1 desktop:flex desktop:gap-2`}
      style={mobile ? { backgroundColor: "var(--todo-row-fill, var(--bg-panel))", borderLeftColor: !overdue && !todo.done && todo.color ? `var(--todo-${todo.color})` : "var(--todo-row-edge, var(--border))" } : overdue
        ? { background: "var(--danger-soft)", borderLeft: "2px solid var(--danger)" }
        : { background: "var(--bg-subtle)", borderLeft: `2px solid ${!todo.done && todo.color ? `var(--todo-${todo.color})` : "transparent"}` }}
    >
      <label className={`${mobile ? styles.check : ""} col-start-1 row-start-1 self-start desktop:self-center flex h-[44px] w-[44px] shrink-0 cursor-pointer items-center justify-center desktop:h-auto desktop:w-auto`}>
        <input
          type="checkbox"
          checked={todo.done}
          disabled={toggling}
          aria-busy={toggling}
          onChange={() => void toggle()}
          aria-label={todo.done
            ? t("robin.todos.reopen", { title: todo.title })
            : t("robin.todos.complete", { title: todo.title })}
          className="cursor-pointer"
        />
        {mobile && <span aria-hidden="true">{toggling ? "…" : todo.done ? "✓" : ""}</span>}
      </label>
      <div className="col-start-2 min-w-0 self-center desktop:flex desktop:flex-1 desktop:items-center desktop:gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1">
        {!mobile && <TodoDragHandle todo={todo} />}
        <ReadableText className="min-w-0 flex-1">
          <div className={`${styles.title} text-sm`}>
            <span aria-hidden="true" className={styles.preview} style={titleStyle}>{todo.title}</span>
            <div className={styles.reveal}>
              <div className={styles.content}>
                {mobile ? <button type="button" className={`ui-action ${styles.openTask}`} style={{ color: titleStyle.color }} aria-label={t("daily.openTask", { title: todo.title })} onClick={onDetails}>
                  <span className={styles.taskName} style={{ textDecoration: todo.done ? "line-through" : undefined }}>{todo.title}</span>
                  {(todo.startDate || todo.due) && !todo.done && <span className={styles.taskDate}>{toggling ? t("robin.common.saving") : todoDateLabel(todo, today, locale, t)}</span>}
                </button> : <TodoTitle todo={todo} t={t}
                  className="block min-w-0 whitespace-normal [overflow-wrap:anywhere]"
                  style={titleStyle} />}
              </div>
            </div>
          </div>
        </ReadableText>
        </div>
        <span role="status" className={toggling && !mobile ? "shrink-0 text-xs text-[var(--text-muted)]" : "sr-only"}>
          {toggling ? t("robin.common.saving") : ""}
        </span>
        {!mobile && (todo.startDate || todo.due) && !todo.done && (
          <span className="block min-w-0 text-xs desktop:shrink-0" style={{ color: overdue ? "var(--danger)" : "var(--text-muted)" }}>
            {todoDateLabel(todo, today, locale, t)}
          </span>
        )}
      </div>
      {mobile ? (
        <details ref={actionsMenu} className="robin-todo-actions relative col-start-3 row-start-1 self-start">
          <summary
            className="ui-action flex h-[44px] w-[44px] cursor-pointer list-none items-center justify-center"
            aria-label={t("robin.todos.actions", { title: todo.title })}
          >
            <span aria-hidden="true">···</span>
          </summary>
          <div
            className="absolute right-0 top-full flex gap-2 border p-2"
            style={{ zIndex: "var(--z-popover)", background: "var(--bg-panel)", borderColor: "var(--border-strong)", boxShadow: "var(--popover-shadow)" }}
          >
            {actions}
          </div>
        </details>
      ) : (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
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
      className="robin-todo-link-editor relative shrink-0"
      onToggle={(event) => {
        if (event.currentTarget.open) setValue(todo.url ?? "");
      }}
    >
      <summary
        aria-label={t("robin.todos.editLink", { title: todo.title })}
        title={t("robin.todos.editLink", { title: todo.title })}
        className="ui-action flex h-[44px] w-[44px] cursor-pointer list-none items-center justify-center desktop:h-[28px] desktop:w-[28px]"
        style={{ color: todo.url ? "var(--accent)" : "var(--text-muted)" }}
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
        <button type="submit" className="ui-action pi-bracket min-h-[44px] shrink-0 px-2 py-1 text-xs desktop:min-h-0">
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
            className="ui-action min-h-[44px] min-w-[44px] shrink-0 px-2 py-1 text-xs desktop:min-h-0 desktop:min-w-0"
            style={{ color: "var(--text-dim)" }}
          >
            ×
          </button>
        )}
      </form>
    </details>
  );
}
