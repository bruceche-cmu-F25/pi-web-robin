"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { Todo } from "@/extension/robin/todo-domain";
import { TodoTitle } from "./TodoTitle";
import styles from "./CalendarPanel.module.css";

type Props = { todo: Todo; children: ReactNode };

/** Phones show the content directly: no disclosure button, popover or hover listeners. */
export function CalendarTodoTitle({ todo, children }: Props) {
  const mobile = useIsMobile();
  const { t } = useI18n();
  if (!mobile) return <DesktopCalendarTodoTitle todo={todo}>{children}</DesktopCalendarTodoTitle>;
  return <div className={styles.todoCopy}>
    <div className={styles.todoControls}>{children}</div>
    <div className={styles.weekTodoTitle}><TodoTitle todo={todo} t={t} nativeTooltip={false} /></div>
  </div>;
}

/** Desktop preview uses the native top layer without moving the calendar layout. */
function DesktopCalendarTodoTitle({ todo, children }: Props) {
  const { t } = useI18n();
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const copy = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dismissed = useRef(false);
  const [overflowing, setOverflowing] = useState(false);
  const [open, setOpen] = useState(false);
  const clearTimer = () => clearTimeout(timer.current);
  const hide = () => {
    clearTimer();
    const hadFocus = popup.current?.contains(document.activeElement);
    popup.current?.hidePopover();
    if (hadFocus) root.current?.querySelector<HTMLButtonElement>("button[aria-controls]")?.focus({ preventScroll: true });
  };
  const show = () => {
    clearTimer();
    const panel = popup.current, anchor = root.current;
    if (!overflowing || dismissed.current || !panel || !anchor || panel.matches(":popover-open")) return;
    panel.showPopover();
    const rect = anchor.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - panel.offsetWidth - 8))}px`;
    const below = rect.bottom + 6;
    panel.style.top = `${Math.max(8, below + panel.offsetHeight <= window.innerHeight - 8 ? below : rect.top - panel.offsetHeight - 6)}px`;
  };
  const leave = () => {
    clearTimer();
    timer.current = setTimeout(() => {
      if (!root.current?.contains(document.activeElement)) hide();
    }, 160);
  };
  useEffect(() => {
    const element = copy.current;
    if (!element) return;
    let active = true;
    const measure = () => { if (active) setOverflowing(element.scrollHeight > element.clientHeight + 1); };
    const observer = new ResizeObserver(measure);
    observer.observe(element); measure();
    void document.fonts.ready.then(measure);
    return () => { active = false; observer.disconnect(); };
  }, [todo.title]);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    const panel = popup.current;
    const close = () => {
      clearTimeout(timer.current); dismissed.current = true;
      const hadFocus = panel?.contains(document.activeElement);
      panel?.hidePopover();
      if (hadFocus) root.current?.querySelector<HTMLButtonElement>("button[aria-controls]")?.focus({ preventScroll: true });
    };
    const scroll = (event: Event) => { if (!(event.target instanceof Node) || !panel?.contains(event.target)) close(); };
    const down = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) close(); };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && panel?.matches(":popover-open")) { event.preventDefault(); event.stopPropagation(); close(); }
    };
    window.addEventListener("resize", close);
    document.addEventListener("scroll", scroll, true);
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", scroll, true);
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key, true);
    };
  }, [open]);

  return <div ref={root} className={styles.todoCopy}
    onPointerEnter={(event) => { if (event.pointerType === "mouse" && event.buttons === 0) { clearTimer(); dismissed.current = false; timer.current = setTimeout(show, 220); } }}
    onPointerLeave={() => { dismissed.current = false; leave(); }}
    onFocusCapture={(event) => {
      // Native popovers can restore focus while another popover is opening.
      if (!popup.current?.contains(event.target)) { clearTimer(); timer.current = setTimeout(show, 0); }
    }}
    onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) { dismissed.current = false; leave(); } }}
    onPointerDownCapture={(event) => {
      if ((event.target as Element).closest("[data-calendar-todo], input")) { dismissed.current = true; hide(); }
    }}>
    <div className={styles.todoControls}>
      {children}
      {overflowing && <button type="button" className={styles.todoMore} aria-haspopup="dialog" aria-controls={id} aria-expanded={open}
        aria-label={t("robin.common.expandText", { title: todo.title })}
        onClick={() => { dismissed.current = false; show(); popup.current?.focus({ preventScroll: true }); }}>…</button>}
    </div>
    <div ref={copy} className={styles.weekTodoTitle}>
      <TodoTitle todo={todo} t={t} nativeTooltip={false} />
    </div>
    <div ref={popup} id={id} popover="auto" role="dialog" tabIndex={-1}
      aria-label={t("robin.common.expandText", { title: todo.title })} className={styles.todoPreview}
      onBeforeToggle={(event) => { if (event.newState === "closed") { dismissed.current = true; clearTimer(); } }}
      onToggle={(event) => setOpen(event.newState === "open")}
      onPointerEnter={clearTimer} onPointerLeave={leave}>
      <button type="button" className={styles.todoPreviewClose} aria-label={t("i18n.close")}
        onClick={() => { dismissed.current = true; hide(); }}>×</button>
      <TodoTitle todo={todo} t={t} nativeTooltip={false} />
      {todo.due && <p className={styles.note}>{t("robin.calendar.deadlineOn", { date: todo.due })}</p>}
    </div>
  </div>;
}
