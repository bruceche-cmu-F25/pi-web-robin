"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useI18n } from "@/hooks/useI18n";
import type { EditableTodo } from "@/extension/robin/todo-domain";
import { KanbanTaskEditor } from "./KanbanTaskEditor";
import type { KanbanEditor as Editor } from "./kanban-editor";
import { compareKanbanTodos, inKanbanView, KANBAN_VIEWS, needsReview, type KanbanView } from "@/extension/robin/kanban";
import { KanbanPlanner } from "./KanbanPlanner";
import { TODO_STATUSES, isTodoStatus, todoStatus, type TodoStatus } from "@/extension/robin/todo-status";
import { formatLocalDateRange } from "@/extension/robin/dates";
import { TodoTitle } from "./TodoTitle";
import { mutate, usePolledResource } from "./usePolledResource";
import { requestRefresh } from "./refreshBus";
import styles from "./KanbanBoard.module.css";

interface TodosResponse { todos: EditableTodo[]; today: string }
const API = "/api/robin/todos";

export function KanbanBoard() {
  const { t, locale } = useI18n();
  const { data, loading, error, refresh } = usePolledResource<TodosResponse>(`${API}?includeArchived=true`);
  const params = useSearchParams();
  const [preferredLayout, setPreferredLayout] = useState<"board" | "list">("board");
  const query = params.get("q") ?? "";
  const view = KANBAN_VIEWS.find((value) => value === params.get("view")) ?? "today";
  const layout = params.get("layout") === "list" ? "list" : params.get("layout") === "board" ? "board" : preferredLayout;
  const mobileColumn = TODO_STATUSES.find((value) => value === params.get("column")) ?? "todo";
  const searchAll = params.get("scope") === "all" && Boolean(query.trim());
  useEffect(() => {
    try { if (localStorage.getItem("robin-kanban-layout") === "list") setPreferredLayout("list"); } catch { /* Private mode. */ }
  }, []);
  function changeLocation(values: Record<string, string>, push = false) {
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries(values)) { if (value) url.searchParams.set(key, value); else url.searchParams.delete(key); }
    window.history[push ? "pushState" : "replaceState"](null, "", url);
  }
  function setView(value: KanbanView) { changeLocation({ view: value, scope: "", column: "todo" }, true); }
  function setQuery(value: string) { changeLocation({ q: value, ...(!value.trim() ? { scope: "" } : {}) }); }
  function setMobileColumn(value: TodoStatus) { changeLocation({ column: value }); }
  function setLayout(value: "board" | "list") {
    setPreferredLayout(value);
    try { localStorage.setItem("robin-kanban-layout", value); } catch { /* Private mode. */ }
    changeLocation({ layout: value });
  }
  const [editor, setEditor] = useState<Editor | null>(null);
  const [working, setWorking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<TodoStatus | null>(null);
  const busyRef = useRef(false);
  const focusAfterMove = useRef<{ id: string; status?: TodoStatus } | null>(null);
  const arrivalRef = useRef<Animation | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const reviewRef = useRef<HTMLElement>(null);
  const todos = data?.todos ?? [];
  const today = data?.today ?? "";
  const needle = query.trim().toLocaleLowerCase();
  const scoped = searchAll ? todos : todos.filter((todo) => inKanbanView(todo, view, today));
  const outsideMatches = todos.filter((todo) => !inKanbanView(todo, view, today) && todo.title.toLocaleLowerCase().includes(needle)).length;
  const visible = scoped.filter((todo) => todo.title.toLocaleLowerCase().includes(needle));
  const inProgress = todos.filter((todo) => !todo.archivedAt && todoStatus(todo) === "doing").length;
  const dueToday = todos.filter((todo) => !todo.done && !todo.archivedAt && todo.due === today && !todo.plannedOn);
  const reviewing = searchAll || view === "review" || view === "archive";

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const reduce = () => { if (preference.matches) arrivalRef.current?.cancel(); };
    preference.addEventListener("change", reduce);
    return () => { preference.removeEventListener("change", reduce); arrivalRef.current?.cancel(); };
  }, []);

  useEffect(() => {
    const target = focusAfterMove.current;
    if (!target || (target.status && !data?.todos.some((todo) => todo.id === target.id && todoStatus(todo) === target.status))) return;
    const select = boardRef.current?.querySelector<HTMLSelectElement>(`[data-todo-id="${CSS.escape(target.id)}"] select`);
    if (target.status && select) {
      select.focus();
      arrivalRef.current?.cancel();
      arrivalRef.current = null;
      const card = select.closest("article");
      if (card && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        const style = getComputedStyle(card);
        // Only a confirmed move gets a single color wash, never polling or a failed write.
        // An implicit final keyframe returns to the current hover/focus surface.
        arrivalRef.current = card.animate([{ offset: 0, backgroundColor: `color-mix(in srgb, ${style.getPropertyValue("--kanban-tone")} 26%, ${style.getPropertyValue("--bg-panel")})` }], { duration: 480, easing: "ease-out" });
      }
    } else if (document.activeElement === document.body) (select ?? reviewRef.current ?? boardRef.current)?.focus();
    focusAfterMove.current = null;
  }, [data]);

  async function run(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setWorking(true);
    setActionError(null);
    setAnnouncement("");
    const focusedTask = document.activeElement?.closest<HTMLElement>("[data-todo-id]")?.dataset.todoId;
    try {
      await action();
      if (focusedTask && !focusAfterMove.current) focusAfterMove.current = { id: focusedTask };
      // Review decisions remove the focused row; keep keyboard users in the list.
      if (reviewing) reviewRef.current?.focus();
      await refresh();
      requestRefresh();
    } catch (caught) {
      focusAfterMove.current = null;
      const message = caught instanceof Error ? caught.message : String(caught);
      setActionError(message.startsWith("Task changed;") ? t("robin.kanban.taskConflict") : message);
      await refresh();
    } finally {
      busyRef.current = false;
      setWorking(false);
    }
  }

  function move(todo: EditableTodo, status: TodoStatus) {
    if (todoStatus(todo) === status) return;
    void run(async () => {
      await mutate(API, "PATCH", { id: todo.id, revision: todo.revision, status });
      setMobileColumn(status);
      focusAfterMove.current = { id: todo.id, status };
      setAnnouncement(t("robin.kanban.moved", { title: todo.title, status: t(`robin.kanban.${status}`) }));
    });
  }

  function openEditor(value: Editor) {
    setActionError(null);
    setEditor({ ...value, plannedOn: value.todo ? value.todo.plannedOn ?? "" : view === "today" ? today : "" });
  }

  return (
    <main className={`robin-page robin-dashboard ${styles.page}`}>
      <div className={styles.content}>
        <header className={styles.header}>
          <div className={styles.heading}>
            <h1>{t("robin.nav.kanban")}</h1>
            {today && <time className={styles.today} dateTime={today}>{formatLocalDateRange(today, today, locale, today)}</time>}
          </div>
          <div className={styles.headerActions}>
            <KanbanPlanner todos={todos} disabled={working} />
            <button type="button" className="ui-action pi-bracket" data-state="accent" disabled={working || !data}
              onClick={() => openEditor({ status: "todo" })}>
              <span aria-hidden="true">+ </span>{t("robin.kanban.newTask")}
            </button>
          </div>
        </header>

        <nav className={styles.views} aria-label={t("robin.kanban.views")}>
          {KANBAN_VIEWS.map((value) => <button key={value} type="button" className="ui-action" data-view={value}
            aria-pressed={view === value} onClick={() => { setView(value); setQuery(""); }}>
            {t(`robin.kanban.view.${value}`)} <span>{todos.filter((todo) => inKanbanView(todo, value, today)).length}</span>
          </button>)}
        </nav>
        <div className={styles.toolbar}>
          <p className={styles.viewHint}>{t(searchAll ? "robin.kanban.searchAllHint" : `robin.kanban.context.${view}`)}</p>
          <label className={styles.search}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="10" cy="10" r="6" /><path d="m15 15 6 6" /></svg>
            <input type="search" aria-label={t("robin.kanban.search")} value={query} onChange={(event) => setQuery(event.target.value)}
              placeholder={t("robin.kanban.searchPlaceholder")} />
          </label>
          {!reviewing && <div className={styles.layoutSwitch} role="group" aria-label={t("robin.kanban.layout")}>
            {(["board", "list"] as const).map((value) => <button type="button" key={value} className="ui-action"
              aria-label={t(`robin.kanban.layout.${value}`)} title={t(`robin.kanban.layout.${value}`)} aria-pressed={layout === value} onClick={() => setLayout(value)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                {value === "board" ? <><rect x="3" y="4" width="7" height="16" /><rect x="14" y="4" width="7" height="11" /></> : <><path d="M8 5h13M8 12h13M8 19h13M3 5h1M3 12h1M3 19h1" /></>}
              </svg>
            </button>)}
          </div>}
        </div>
        {needle && <div className={styles.searchScope}>
          <span>{t(searchAll ? "robin.kanban.searchAllHint" : "robin.kanban.searchViewHint")}</span>
          <button type="button" className="ui-action pi-bracket" onClick={() => changeLocation({ scope: searchAll ? "" : "all" }, true)}>
            {searchAll ? t("robin.kanban.searchCurrent") : t("robin.kanban.searchAll", { count: outsideMatches })}
          </button>
        </div>}
        {dueToday.length > 0 && <button type="button" className={`ui-action ${styles.attention}`} title={dueToday.map((todo) => todo.title).join(" · ")}
          onClick={() => { setView("pool"); setQuery(""); }}>
          {t("robin.kanban.unplannedDue", { count: dueToday.length })}<span aria-hidden="true"> →</span>
        </button>}

        <div role="status" className={styles.feedback} data-visible={Boolean(loading || working || announcement)}>
          {loading ? t("robin.common.loading") : working ? t("robin.kanban.saving") : announcement}
        </div>
        {(error || actionError) && !editor && (
          <div role="alert" className={styles.error}>
            {actionError ?? error}
            {error && <button type="button" className="ui-action pi-bracket" onClick={() => void refresh()}>{t("robin.kanban.retry")}</button>}
          </div>
        )}

        {!reviewing && layout === "board" && <nav className={styles.mobileColumns} aria-label={t("robin.kanban.columns")}>
          {TODO_STATUSES.map((status) => <button type="button" key={status} className="ui-action" aria-pressed={mobileColumn === status}
            onClick={() => setMobileColumn(status)}>{t(`robin.kanban.${status}`)} <span>{visible.filter((todo) => todoStatus(todo) === status).length}</span></button>)}
        </nav>}
        {reviewing ? <section ref={reviewRef} tabIndex={-1} className={styles.reviewList} aria-label={t(searchAll ? "robin.kanban.searchAllHint" : `robin.kanban.view.${view}`)}>
          {!visible.length && !loading && <p className={styles.empty}>{t("robin.kanban.noMatches")}</p>}
          {visible.map((todo) => <article key={todo.id} data-todo-id={todo.id} className={styles.reviewRow}>
            <div><TodoTitle todo={todo} t={t} className={styles.taskTitle} />
              <p className={styles.date}>{todo.due && `${t("robin.kanban.deadline")} ${todo.due}`}{todo.plannedOn && ` · ${t("robin.kanban.plannedOn")} ${todo.plannedOn}`}</p>
            </div>
            <div className={styles.planActions}>
              {searchAll ? <>
                <span className={styles.count}>{t(todo.archivedAt ? "robin.kanban.view.archive" : needsReview(todo, today) ? "robin.kanban.view.review" : `robin.kanban.${todoStatus(todo)}`)}</span>
                <button type="button" className="ui-action pi-bracket" aria-label={t("robin.kanban.editTask", { title: todo.title })} onClick={() => openEditor({ todo, status: todoStatus(todo) })}>{t("robin.kanban.edit")}</button>
              </> : view === "review" ? <>
                <button type="button" className="ui-action pi-bracket" disabled={working} onClick={() => move(todo, "done")}>{t("robin.kanban.done")}</button>
                <button type="button" className="ui-action pi-bracket" disabled={working} onClick={() => void run(() => mutate(API, "PATCH", { id: todo.id, revision: todo.revision, review: "continue" }))}>{t("robin.kanban.keepTask")}</button>
                <button type="button" className="ui-action pi-bracket" disabled={working} onClick={() => void run(() => mutate(API, "PATCH", { id: todo.id, revision: todo.revision, review: "abandon" }))}>{t("robin.kanban.abandon")}</button>
              </> : <button type="button" className="ui-action pi-bracket" disabled={working} onClick={() => void run(() => mutate(API, "PATCH", { id: todo.id, revision: todo.revision, review: "restore" }))}>{t("robin.kanban.restore")}</button>}
            </div>
          </article>)}
        </section> : <div ref={boardRef} tabIndex={-1} role="region" aria-label={t(`robin.kanban.layout.${layout}`)} className={styles.board} data-layout={layout} aria-busy={working || loading}>
          {TODO_STATUSES.map((status) => {
            const items = visible.filter((todo) => todoStatus(todo) === status).sort(compareKanbanTodos);
            const total = scoped.filter((todo) => todoStatus(todo) === status).length;
            return (
              <section key={status} data-column={status} data-mobile-current={mobileColumn === status} aria-labelledby={`kanban-${status}`}
                className={`${styles.column}${over === status ? ` ${styles.dropTarget}` : ""}`}
                onDragOver={(event) => {
                  if (!dragging || working) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setOver(status);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(null);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const todo = todos.find((entry) => entry.id === dragging);
                  setDragging(null);
                  setOver(null);
                  if (todo && !working) move(todo, status);
                }}>
                <header className={styles.columnHeader}>
                  <span className={styles.statusMark} aria-hidden="true" />
                  <h2 id={`kanban-${status}`}>{t(`robin.kanban.${status}`)}</h2>
                  <span className={styles.count}>{needle ? `${items.length} / ${total}` : total}</span>
                  {status === "doing" && inProgress > 3 && <span className={styles.wip} role="status" title={t("robin.kanban.wipWarning", { count: inProgress })}>{t("robin.kanban.wip", { count: inProgress })}</span>}
                  {status !== "done" && <button type="button" className="ui-action" disabled={working || !data}
                    aria-label={t("robin.kanban.addTo", { status: t(`robin.kanban.${status}`) })}
                    onClick={() => openEditor({ status })}>+</button>}
                </header>
                <div className={styles.cards}>
                  {items.map((todo) => {
                    const overdue = !todo.done && Boolean(todo.due && data?.today && todo.due < data.today);
                    return (
                      <article key={todo.id} data-todo-id={todo.id} data-next={Boolean(todo.next)} className={`${styles.card}${dragging === todo.id ? ` ${styles.dragging}` : ""}`}
                        draggable={!working}
                        onDragStart={(event) => {
                          // Inputs and links retain their normal selection/open behavior.
                          if ((event.target as HTMLElement).closest("button, select, a, input")) { event.preventDefault(); return; }
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", todo.id);
                          setDragging(todo.id);
                        }}
                        onDragEnd={() => { setDragging(null); setOver(null); }}>
                        <div className={styles.cardHeading}>
                          <TodoTitle todo={todo} t={t} className={styles.taskTitle}
                            style={todo.color ? { color: `var(--todo-${todo.color})` } : undefined} />
                          <button type="button" className={`ui-action ${styles.edit}`} disabled={working}
                            aria-label={t("robin.kanban.editTask", { title: todo.title })} title={t("robin.kanban.editTask", { title: todo.title })}
                            onClick={() => openEditor({ todo, status: todoStatus(todo) })}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                              <path d="M4 5h16v14H4zM14 5v14" />
                            </svg>
                          </button>
                        </div>
                        <div className={styles.cardMeta}>
                          {todo.next && <span className={styles.nextLabel}>{t("robin.kanban.nextTask")}</span>}
                          {needsReview(todo, today) && <button type="button" className={`ui-action ${styles.overdue}`} onClick={() => changeLocation({ view: "review", q: todo.title, scope: "" }, true)}>{t("robin.kanban.replanNeeded")}</button>}
                          {todo.due && <span className={overdue ? styles.overdue : undefined}>
                            {overdue ? t("robin.kanban.overdue") : t("robin.kanban.dueShort")} · {formatLocalDateRange(todo.startDate ?? todo.due, todo.due, locale, today)}
                          </span>}
                          {todo.plannedOn && view !== "today" && <span>{t("robin.kanban.planShort")} · {formatLocalDateRange(todo.plannedOn, todo.plannedOn, locale, today)}</span>}
                          {todo.estimateMinutes && <span title={t(todo.estimateSource === "agent" ? "robin.kanban.agentEstimate" : "robin.kanban.yourEstimate")}>
                            {todo.estimateSource === "agent" ? "≈ " : ""}{todo.estimateMinutes} {t("robin.kanban.minutes")}{todo.estimateSource === "agent" && <span className={styles.srOnly}> · {t("robin.kanban.agentEstimate")}</span>}
                          </span>}
                        </div>
                        <div className={styles.cardFooter}>
                          <select value={status} disabled={working}
                            aria-label={t("robin.kanban.moveTask", { title: todo.title })}
                            onChange={(event) => { if (isTodoStatus(event.target.value)) move(todo, event.target.value); }}>
                            {TODO_STATUSES.map((value) => <option key={value} value={value}>{t(`robin.kanban.${value}`)}</option>)}
                          </select>
                          {!todo.done && <button type="button" className={`ui-action ${styles.nextAction}`} aria-pressed={Boolean(todo.next)} disabled={working}
                            aria-label={t(todo.next ? "robin.kanban.clearNext" : "robin.kanban.setNext")} title={t(todo.next ? "robin.kanban.clearNext" : "robin.kanban.setNext")}
                            onClick={() => void run(() => mutate(API, "PATCH", { id: todo.id, revision: todo.revision, next: !todo.next }))}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill={todo.next ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z" /></svg>
                          </button>}
                          {!todo.done && (todo.plannedOn === today
                            ? <button type="button" className={`ui-action ${styles.quickAction}`} disabled={working}
                                aria-label={t("robin.kanban.unplan")} title={t("robin.kanban.unplan")}
                                onClick={() => void run(() => mutate(API, "PATCH", { id: todo.id, revision: todo.revision, plannedOn: "" }))}>{t("robin.kanban.unplanShort")}</button>
                            : <button type="button" className={`ui-action ${styles.quickAction}`} disabled={working || needsReview(todo, today)}
                                aria-label={t("robin.kanban.planToday")} title={t("robin.kanban.planToday")}
                                onClick={() => void run(() => mutate(API, "PATCH", { id: todo.id, revision: todo.revision, plannedOn: today }))}>{t("robin.kanban.todayShort")}</button>)}
                        </div>
                      </article>
                    );
                  })}
                  {!loading && data && items.length === 0 && <div className={styles.empty}>
                    <p>{needle ? t("robin.kanban.noMatches") : t(`robin.kanban.${status}Empty`)}</p>
                    {!needle && status === "todo" && view !== "pool" && <button type="button" className="ui-action pi-bracket"
                      onClick={() => { setView("pool"); setQuery(""); }}>{t("robin.kanban.pickFromPool")}</button>}
                  </div>}
                </div>
              </section>
            );
          })}
        </div>}
        <footer className={styles.boardFooter}><span>{t("robin.kanban.visibleCount", { count: visible.length })}</span><span>{t("robin.kanban.hint")}</span></footer>
      </div>
      {editor && <KanbanTaskEditor editor={editor} onClose={() => setEditor(null)} onSaved={(result, status) => {
        setEditor(null);
        if (status) setMobileColumn(status);
        setAnnouncement(t(`robin.kanban.${result}`));
        void refresh(); requestRefresh();
      }} />}
    </main>
  );
}
