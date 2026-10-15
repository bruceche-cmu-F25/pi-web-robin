"use client";

import { useEffect, useEffectEvent, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { isReadOnlyEvent, type DashboardEvent } from "@/extension/robin/events";
import { toMinutes } from "@/extension/robin/layout";
import { useI18n } from "@/hooks/useI18n";
import type { EditableTodo } from "@/extension/robin/todo-domain";
import { eventFields, moveEvent, moveTodo, resizeEvent, selectEventRange, type CalendarSlot, type EventFields } from "./calendar-edit";
import styles from "./CalendarInteractions.module.css";

export function eventDragProps(event: DashboardEvent) {
  return { "data-calendar-event": event.id, "data-calendar-draggable": isReadOnlyEvent(event) ? undefined : "true",
    "data-calendar-readonly": isReadOnlyEvent(event) ? "true" : undefined, draggable: false } as const;
}
type Box = { left: number; top: number; width: number; height: number };

/** Only a valid pointer-up commits. Geometry is shared by moving, resizing and empty-space selection. */
export function CalendarInteractions({ children, events, todos, busy, onMove, onMoveTodo, onEditTodo, onReadOnly, onCreate }: {
  children: ReactNode; events: DashboardEvent[]; todos: EditableTodo[]; busy: boolean;
  onMoveTodo: (todo: EditableTodo, dates: { due: string; startDate: string }) => void;
  onEditTodo: (todo: EditableTodo) => void;
  onMove: (event: DashboardEvent, fields: EventFields) => void;
  onReadOnly: (event: DashboardEvent) => void;
  onCreate: (fields: EventFields) => void;
}) {
  const { t } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const suppressClick = useRef(false);
  const [preview, setPreview] = useState<{ fields: EventFields; todoDue?: string; x: number; y: number; boxes: Box[] } | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  function hit(x: number, y: number): CalendarSlot | null {
    const element = document.elementFromPoint(x, y);
    if (!element || !root.current?.contains(element)) return null;
    const sticky = element.closest("[data-calendar-sticky]");
    for (const cell of root.current.querySelectorAll<HTMLElement>("[data-calendar-date]")) {
      if (sticky && cell.dataset.calendarMinute !== undefined) continue;
      const rect = cell.getBoundingClientRect();
      const band = cell.closest("[data-calendar-sticky]")?.getBoundingClientRect();
      if (band && (y < band.top || y >= band.bottom)) continue;
      if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) continue;
      const first = cell.dataset.calendarMinute;
      return { date: cell.dataset.calendarDate!, ...(first === undefined ? {} : {
        minute: Number(first) + (y - rect.top) / Number(cell.dataset.calendarScale),
      }) };
    }
    return null;
  }
  function previewBoxes(fields: EventFields): Box[] {
    const boxes: Box[] = [];
    const timed = Boolean(fields.start) && (!fields.endDate || fields.endDate === fields.date);
    for (const cell of root.current?.querySelectorAll<HTMLElement>("[data-calendar-date]") ?? []) {
      const date = cell.dataset.calendarDate!;
      if (date < fields.date || date > (fields.endDate || fields.date)) continue;
      const timedCell = cell.dataset.calendarMinute !== undefined;
      if (timedCell && !timed) continue;
      if (!timedCell && timed && root.current?.querySelector("[data-calendar-minute]")) continue;
      const rect = cell.getBoundingClientRect();
      const scroller = cell.closest("[data-calendar-scroll]");
      if (!scroller) continue;
      const clip = scroller.getBoundingClientRect();
      const pageTop = cell.closest(".robin-dashboard")?.querySelector(".robin-dashboard-header")?.getBoundingClientRect().bottom ?? 0;
      const header = timedCell ? (scroller.querySelector("[data-calendar-sticky]")?.getBoundingClientRect().height ?? 0) : 0;
      const scale = Number(cell.dataset.calendarScale);
      const first = Number(cell.dataset.calendarMinute ?? 0);
      const start = fields.start ? toMinutes(fields.start) - first : 0;
      const end = fields.end ? toMinutes(fields.end) - first : start + 60;
      const top = Math.max(0, pageTop, clip.top + header, timedCell ? rect.top + start * scale : rect.top);
      const bandBottom = cell.closest("[data-calendar-sticky]")?.getBoundingClientRect().bottom ?? clip.bottom;
      const bottom = Math.min(window.innerHeight, clip.bottom, bandBottom, timedCell ? rect.top + Math.max(end, start + 15) * scale : rect.bottom);
      const left = Math.max(0, clip.left, rect.left), right = Math.min(window.innerWidth, clip.right, rect.right);
      if (right > left && bottom > top) boxes.push({ left, top, width: right - left, height: bottom - top });
    }
    return boxes;
  }

  function begin(pointer: ReactPointerEvent<HTMLDivElement> | PointerEvent) {
    suppressClick.current = false;
    if (busy || !pointer.isPrimary || pointer.button !== 0 || cleanup.current) return;
    const element = pointer.target as HTMLElement;
    const source = element.closest<HTMLElement>("[data-calendar-event], [data-calendar-create], [data-calendar-todo]");
    const event = events.find((item) => item.id === source?.dataset.calendarEvent);
    const todo = todos.find((item) => item.id === source?.dataset.calendarTodo && !item.done && !item.archivedAt);
    const origin = hit(pointer.clientX, pointer.clientY);
    // Empty space stays scrollable on touch; only explicit task grips start a sidebar drag.
    if (!source || (source.dataset.calendarTodo && !todo) || (!origin && !todo) || (!event && !todo && pointer.pointerType === "touch")) return;
    const resizing = Boolean(event && !isReadOnlyEvent(event) && element.closest("[data-calendar-resize]"));
    const { pointerId, clientX: x, clientY: y } = pointer;
    let moved = false, currentX = x, currentY = y, frame = 0;
    const scroller = source.closest<HTMLElement>("[data-calendar-scroll]") ?? root.current?.querySelector<HTMLElement>("[data-calendar-scroll]");
    const page = source.closest<HTMLElement>(".robin-dashboard");
    const fieldsAt = (target: CalendarSlot) => {
      if (todo) {
        const dates = moveTodo(todo, origin, target);
        return eventFields({ title: todo.title, date: dates.startDate || dates.due, endDate: dates.startDate ? dates.due : "" });
      }
      return !event ? selectEventRange(origin!, target) : resizing ? resizeEvent(event, target) : moveEvent(event, origin!, target);
    };
    source.setPointerCapture(pointerId);
    const updatePreview = () => {
      if (event && isReadOnlyEvent(event)) return;
      const target = hit(currentX, currentY);
      if (!target || (resizing && target.minute === undefined) || (!event && !todo && (origin!.minute === undefined) !== (target.minute === undefined))) {
        setPreview(null); return;
      }
      const fields = fieldsAt(target);
      setPreview({ fields, todoDue: todo ? moveTodo(todo, origin, target).due : undefined, x: currentX, y: currentY, boxes: previewBoxes(fields) });
    };
    const autoScroll = () => {
      if (!scroller) return;
      const rect = scroller.getBoundingClientRect();
      // The full-height calendar scrolls vertically with the dashboard, not in a nested window.
      const vertical = scroller.scrollHeight > scroller.clientHeight + 1 ? scroller : page;
      const clip = vertical?.getBoundingClientRect() ?? rect;
      const headerBottom = vertical === scroller
        ? (scroller.querySelector("[data-calendar-sticky]")?.getBoundingClientRect().bottom ?? rect.top)
        : (page?.querySelector(".robin-dashboard-header")?.getBoundingClientRect().bottom ?? clip.top);
      const topEdge = Math.max(rect.top, clip.top, headerBottom, 0);
      const bottomEdge = Math.min(rect.bottom, clip.bottom, window.innerHeight);
      const leftEdge = Math.max(rect.left, 0), rightEdge = Math.min(rect.right, window.innerWidth);
      if (currentX >= leftEdge && currentX < rightEdge && currentY >= topEdge && currentY < bottomEdge) {
        const left = scroller.scrollLeft, top = vertical?.scrollTop;
        if (currentX < leftEdge + 24) scroller.scrollLeft -= 8;
        else if (currentX > rightEdge - 24) scroller.scrollLeft += 8;
        if (vertical) {
          if (currentY < topEdge + 24) vertical.scrollBy({ top: -8, behavior: "instant" });
          else if (currentY > bottomEdge - 24) vertical.scrollBy({ top: 8, behavior: "instant" });
        }
        if (left !== scroller.scrollLeft || top !== vertical?.scrollTop) updatePreview();
      }
      frame = requestAnimationFrame(autoScroll);
    };
    const finish = () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancelPointer);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", cancel);
      source.removeEventListener("lostpointercapture", cancel);
      if (source.hasPointerCapture(pointerId)) source.releasePointerCapture(pointerId);
      cleanup.current = null; setPreview(null);
    };
    const cancel = () => { suppressClick.current = moved; finish(); };
    const cancelPointer = (e: PointerEvent) => { if (e.pointerId === pointerId) cancel(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); cancel(); } };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      if (!moved && Math.hypot(e.clientX - x, e.clientY - y) < 6) return;
      if (!moved) frame = requestAnimationFrame(autoScroll);
      moved = true; currentX = e.clientX; currentY = e.clientY;
      e.preventDefault(); updatePreview();
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      const target = hit(e.clientX, e.clientY);
      suppressClick.current = moved; finish();
      if (!moved) return;
      if (event && isReadOnlyEvent(event)) { onReadOnly(event); return; }
      if (!target || (resizing && target.minute === undefined) || (!event && !todo && (origin!.minute === undefined) !== (target.minute === undefined))) return;
      if (todo) {
        const dates = moveTodo(todo, origin, target);
        if (dates.due !== todo.due || dates.startDate !== (todo.startDate ?? "")) onMoveTodo(todo, dates);
        return;
      }
      const fields = fieldsAt(target);
      if (!event) onCreate(fields);
      else if (JSON.stringify(fields) !== JSON.stringify(eventFields(event))) onMove(event, fields);
    };
    cleanup.current = finish;
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancelPointer);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", cancel);
    source.addEventListener("lostpointercapture", cancel);
  }

  const outsidePointer = useEffectEvent((event: PointerEvent) => {
    const grip = (event.target as Element).closest("[data-calendar-todo]");
    if (grip && !root.current?.contains(grip)) begin(event);
  });
  const gripClick = useEffectEvent((event: MouseEvent) => {
    const grip = (event.target as Element).closest<HTMLElement>("[data-calendar-todo]");
    if (!grip) return;
    if (suppressClick.current && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); return; }
    const todo = todos.find((item) => item.id === grip.dataset.calendarTodo && !item.done && !item.archivedAt);
    if (!busy && todo) onEditTodo(todo);
  });
  useEffect(() => {
    const page = root.current?.closest(".robin-dashboard");
    if (!page) return;
    const down = (event: Event) => outsidePointer(event as PointerEvent);
    const click = (event: Event) => gripClick(event as MouseEvent);
    page.addEventListener("pointerdown", down, true);
    page.addEventListener("click", click, true);
    return () => { page.removeEventListener("pointerdown", down, true); page.removeEventListener("click", click, true); };
  }, []);

  return <div ref={root} className={styles.surface} aria-busy={busy} data-busy={busy || undefined}
    onPointerDownCapture={begin} onDragStartCapture={(event) => event.preventDefault()}
    onClickCapture={(event) => { if (suppressClick.current && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); } }}>
    {children}
    {preview && <>
      {preview.boxes.map((box, index) => <div key={index} className={styles.ghost} style={box} aria-hidden />)}
      <div className={styles.preview} role="status" style={{ left: Math.max(8, Math.min(preview.x + 12, window.innerWidth - 248)), top: Math.max(8, Math.min(preview.y + 16, window.innerHeight - 100)) }}>
        <strong>{preview.fields.title || t("robin.calendar.create")}</strong><br />
        {preview.todoDue ? t("robin.calendar.deadlineOn", { date: preview.todoDue }) : <>
          {preview.fields.date}{preview.fields.start ? ` ${preview.fields.start}` : ` · ${t("robin.calendar.allDay")}`}
          {preview.fields.endDate && ` – ${preview.fields.endDate}`}{preview.fields.end && ` – ${preview.fields.end}`}
        </>}
      </div>
    </>}
  </div>;
}
