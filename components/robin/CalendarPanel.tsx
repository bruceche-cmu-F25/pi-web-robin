"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { MOBILE_MAX_WIDTH } from "@/lib/panel-layout";
import { parseLocalDate } from "@/extension/robin/dates";
import { eventsInRange, isReadOnlyEvent, type DashboardEvent } from "@/extension/robin/events";
import { orderSeriesColors } from "@/extension/robin/eventColors";
import type { EditableTodo, Todo } from "@/extension/robin/todo-domain";
import { AgendaView, MonthView } from "./CalendarViews";
import { WeekGrid } from "./WeekGrid";
import { GoogleConnect } from "./GoogleConnect";
import { EventDetailsDialog } from "./EventDetailsDialog";
import { CalendarEventEditor } from "./CalendarEventEditor";
import { TodoDeadlineEditor } from "./TodoDeadlineEditor";
import { CalendarSidebar, type CalendarSources } from "./CalendarSidebar";
import { SeriesPaletteContext } from "./eventSurface";
import { requestRefresh } from "./refreshBus";
import { mutate, mutateResponse, usePolledResource } from "./usePolledResource";
import { writeUrlState } from "@/lib/url-state";
import { CalendarInteractions } from "./CalendarInteractions";
import { eventFields, newEventAt, type CalendarSlot, type EventFields } from "./calendar-edit";
import { calendarDays, calendarView, stepCalendar, type CalendarView } from "./calendar-view";
import styles from "./CalendarPanel.module.css";

interface EventsResponse {
  events: DashboardEvent[];
  today: string;
  google?: { connected: boolean; error?: string };
}
const VIEW_STORAGE_KEY = "robin-calendar-view";
const VIEWS: CalendarView[] = ["day", "week", "month", "agenda"];
function viewStorageKey(): string {
  // A desktop Week preference must not become the phone's default.
  return window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`).matches ? `${VIEW_STORAGE_KEY}-mobile` : VIEW_STORAGE_KEY;
}
function readStoredView(): CalendarView {
  const key = viewStorageKey();
  try {
    const stored = calendarView(localStorage.getItem(key));
    if (stored) return stored;
  } catch { /* Storage is optional. */ }
  return key === VIEW_STORAGE_KEY ? "week" : "day";
}
function calendarDate(value: string | null): string | null {
  if (!value) return null;
  try { parseLocalDate(value); return value; } catch { return null; }
}

export function CalendarPanel() {
  const { t, locale } = useI18n();
  const mobile = useIsMobile();
  const searchParams = useSearchParams();
  const [view, setView] = useState<CalendarView>("week");
  const [anchor, setAnchor] = useState<string | null>(null);
  const [serverToday, setServerToday] = useState("");
  const requestedDays = anchor ? calendarDays(view, anchor) : null;
  const eventsUrl = requestedDays ? `/api/robin/events?from=${requestedDays[0]}&to=${requestedDays.at(-1)}` : "/api/robin/events";
  const { data, error, loading, refresh, updateData } = usePolledResource<EventsResponse>(eventsUrl);
  const { data: todosData, error: todosError, refresh: refreshTodos, updateData: updateTodos } = usePolledResource<{ todos: EditableTodo[] }>("/api/robin/todos");
  const [todoEditor, setTodoEditor] = useState<EditableTodo | null>(null);
  const [sources, setSources] = useState<CalendarSources>({ local: true, google: true, todos: true });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [editor, setEditor] = useState<{ fields: EventFields; event?: DashboardEvent } | null>(null);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<DashboardEvent | null>(null);
  useEffect(() => { if (data?.today) setServerToday(data.today); }, [data?.today]);
  useEffect(() => {
    const requestedView = calendarView(searchParams.get("calendar"));
    const next = requestedView ?? readStoredView();
    setView(next);
    setAnchor(calendarDate(searchParams.get("date")));
    if (!requestedView) writeUrlState({ calendar: next }, "replace");
  }, [searchParams]);
  const today = data?.today ?? serverToday;
  const activeAnchor = anchor ?? today;
  const days = useMemo(() => activeAnchor ? calendarDays(view, activeAnchor) : [], [view, activeAnchor]);
  const palette = useMemo(() => orderSeriesColors(data?.events ?? []), [data]);
  const visible = useMemo(() => days.length ? eventsInRange((data?.events ?? []).filter((event) =>
    isReadOnlyEvent(event) ? sources.google : sources.local), days[0]!, days.at(-1)!) : [], [data, days, sources]);
  const todos = useMemo(() => sources.todos && days.length ? (todosData?.todos ?? []).filter((todo) =>
    !todo.done && todo.due && (todo.startDate ?? todo.due) <= days.at(-1)! && todo.due >= days[0]!) : [], [todosData, days, sources.todos]);
  const heading = useMemo(() => {
    if (!activeAnchor || !days.length) return "";
    if (view === "month") return parseLocalDate(activeAnchor).toLocaleDateString(locale, { year: "numeric", month: "long" });
    if (view === "day") return parseLocalDate(activeAnchor).toLocaleDateString(locale, { month: mobile ? "short" : "long", day: "numeric", weekday: "short", year: "numeric" });
    return new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" }).formatRange(parseLocalDate(days[0]!), parseLocalDate(days.at(-1)!));
  }, [activeAnchor, days, locale, view, mobile]);

  const navigate = (date: string | null, nextView = view) => {
    setAnchor(date); setView(nextView);
    writeUrlState({ calendar: nextView, date });
    try { localStorage.setItem(viewStorageKey(), nextView); } catch { /* Keep live state. */ }
  };
  const selectEvent = (event: DashboardEvent) => { setActionError(null); setSelectedEvent(event); };
  const openEditor = (fields: EventFields, event?: DashboardEvent) => {
    if (saving.current) return;
    if (event && isReadOnlyEvent(event)) { selectEvent(event); return; }
    setActionError(null);
    setSources((current) => ({ ...current, local: true }));
    setEditor({ fields, event });
  };
  const createAt = (slot: CalendarSlot) => openEditor(newEventAt(slot));
  async function run(action: () => Promise<void>): Promise<boolean> {
    if (saving.current) return false;
    saving.current = true; setBusy(true); setActionError(null);
    try { await action(); await refresh(); return true; }
    catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
      await refresh(); return false;
    } finally { saving.current = false; setBusy(false); }
  }
  const saveEvent = async (method: "POST" | "PATCH", body: unknown) => {
    const response = await mutateResponse("/api/robin/events", method, body);
    const { event } = await response.json() as { event: DashboardEvent };
    updateData((current) => current && { ...current, events: [...current.events.filter((item) => item.id !== event.id), event] });
  };
  const patchEvent = (event: DashboardEvent, changes: EventFields) => saveEvent("PATCH", { id: event.id, changes, expected: eventFields(event) });
  const moveEvent = (event: DashboardEvent, fields: EventFields) => {
    if (isReadOnlyEvent(event)) { selectEvent(event); return; }
    void run(() => patchEvent(event, fields));
  };
  const deleteEvent = (event: DashboardEvent) => run(async () => {
    await mutate("/api/robin/events", "DELETE", { id: event.id });
    updateData((current) => current && { ...current, events: current.events.filter((item) => item.id !== event.id) });
  });
  const saveTodoDates = (todo: EditableTodo, dates: { due: string; startDate: string }) => run(async () => {
    try {
      if (!todo.revision) throw new Error(t("robin.calendar.reloadTodo"));
      const response = await mutateResponse("/api/robin/todos", "PATCH", { id: todo.id, revision: todo.revision, ...dates });
      const { todo: saved } = await response.json() as { todo: EditableTodo };
      updateTodos((current) => current && { ...current, todos: current.todos.map((item) => item.id === saved.id ? saved : item) });
      setSources((current) => ({ ...current, todos: true }));
      requestRefresh();
    } finally { void refreshTodos(); }
  });
  const completeTodo = (todo: Todo) => {
    void (async () => {
      try {
        setActionError(null);
        await mutate("/api/robin/todos", "PATCH", { id: todo.id, done: true });
        await refreshTodos(); requestRefresh();
      } catch (caught) { setActionError(caught instanceof Error ? caught.message : String(caught)); }
    })();
  };

  return <section className={`robin-calendar pi-card ${styles.calendar}`} aria-label={t("robin.calendar.title")}>
    <header className={styles.toolbar} data-calendar-toolbar>
      <h2 className={`pi-section-title ${styles.title}`}>{t("robin.calendar.title")}</h2>
      <button type="button" className={`${styles.iconButton} ${styles.sidebarToggle}`} aria-label={t("robin.calendar.dateAndCalendars")}
        aria-expanded={sidebarOpen} aria-controls="calendar-sidebar" onClick={() => setSidebarOpen(!sidebarOpen)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><path d="M4 7h6m4 0h6M4 17h10m4 0h2" /><circle cx="12" cy="7" r="2" /><circle cx="16" cy="17" r="2" /></svg>
      </button>
      <div className={styles.paging}>
        <button type="button" className={styles.iconButton} disabled={!activeAnchor} aria-label={t("robin.calendar.previous")}
          onClick={() => navigate(stepCalendar(view, activeAnchor, -1))}>‹</button>
        <button type="button" className={styles.control} onClick={() => navigate(null)}>{t("robin.calendar.today")}</button>
        <button type="button" className={styles.iconButton} disabled={!activeAnchor} aria-label={t("robin.calendar.next")}
          onClick={() => navigate(stepCalendar(view, activeAnchor, 1))}>›</button>
      </div>
      <p className={styles.period} aria-live="polite" data-calendar-heading>{heading}</p>
      <div className={styles.viewPicker}>
        <select className={`${styles.control} ${styles.viewSelect}`} aria-label={t("robin.calendar.view")} value={view} onChange={(event) => navigate(anchor, event.target.value as CalendarView)}>
          {VIEWS.map((id) => <option key={id} value={id}>{t(`robin.calendar.${id}`)}</option>)}
        </select>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </div>
      <button type="button" className={`${styles.create} robin-calendar-add`} disabled={busy || !today} aria-haspopup="dialog" aria-label={t("robin.calendar.create")}
        onClick={() => createAt({ date: activeAnchor, ...(view === "month" ? {} : { minute: 9 * 60 }) })}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg><span className={styles.createLabel}>{t("robin.calendar.create")}</span>
      </button>
    </header>
    {(error || todosError || actionError) && !editor && !todoEditor && !selectedEvent && <p role="alert" className={styles.feedback}>{actionError ?? error ?? todosError}</p>}
    {today && <div className={styles.layout}>
      <CalendarSidebar anchor={activeAnchor} today={today} open={sidebarOpen} sources={sources} onSources={setSources}
        onDate={(date) => { navigate(date); setSidebarOpen(false); }} />
      <div className={styles.main}>
        {loading && !data ? <p role="status" className={styles.agenda}>{t("robin.calendar.loading")}</p> :
          <SeriesPaletteContext.Provider value={palette}>
            <CalendarInteractions key={`${view}:${activeAnchor}`} events={visible} todos={todosData?.todos ?? []} busy={busy} onMove={moveEvent} onReadOnly={selectEvent}
              onMoveTodo={(todo, dates) => { void saveTodoDates(todo, dates); }}
              onEditTodo={(todo) => { if (!saving.current) { setActionError(null); setTodoEditor(todo); } }}
              onCreate={(fields) => openEditor(fields)}>
              {view === "agenda" && <AgendaView events={visible} todos={todos} today={today} start={activeAnchor} onSelectEvent={selectEvent} onCompleteTodo={completeTodo} />}
              {(view === "week" || view === "day") && <WeekGrid events={visible} todos={todos} today={today} anchor={activeAnchor}
                singleDay={view === "day"} onSelectDay={(day) => navigate(day, "day")} onCreate={createAt} onSelectEvent={selectEvent} onCompleteTodo={completeTodo} />}
              {view === "month" && <MonthView events={visible} todos={todos} today={today} days={days} month={activeAnchor}
                onSelectDay={(day) => navigate(day, "day")} onCreate={createAt} onSelectEvent={selectEvent} onCompleteTodo={completeTodo} />}
            </CalendarInteractions>
          </SeriesPaletteContext.Provider>}
      </div>
    </div>}
    {!today && <p role="status" className={styles.agenda}>{t("robin.calendar.loading")}</p>}
    <footer className={styles.footer}>
      <span role="status">{t(busy ? "robin.calendar.saving" : "robin.calendar.workspaceHint")}</span>
      <GoogleConnect status={data?.google} onChanged={refresh} />
    </footer>
    {selectedEvent && <EventDetailsDialog key={selectedEvent.id} event={selectedEvent}
      onClose={() => setSelectedEvent((current) => current?.id === selectedEvent.id ? null : current)} onDelete={deleteEvent}
      onEdit={(event) => openEditor(eventFields(event), event)} error={isReadOnlyEvent(selectedEvent) ? null : actionError} busy={busy} />}
    {todoEditor && <TodoDeadlineEditor key={todoEditor.id} todo={todoEditor} error={actionError}
      onSave={(dates) => saveTodoDates(todoEditor, dates)}
      onClose={() => setTodoEditor((current) => current === todoEditor ? null : current)} />}
    {editor && <CalendarEventEditor initial={editor.fields} editing={Boolean(editor.event)} error={actionError}
      onSave={(fields, requestId) => run(() => editor.event ? patchEvent(editor.event, fields) : saveEvent("POST", { ...fields, requestId }))}
      onClose={() => setEditor((current) => current === editor ? null : current)} />}
  </section>;
}
