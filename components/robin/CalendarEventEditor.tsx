"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { EventFields } from "./calendar-edit";
import styles from "./CalendarPanel.module.css";

/** A modal quick editor keeps the selected calendar position in place, including on phones. */
export function CalendarEventEditor({ initial, editing, error, onSave, onClose }: {
  initial: EventFields;
  editing: boolean;
  error: string | null;
  onSave: (fields: EventFields, requestId: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const headingId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState(initial);
  const [allDay, setAllDay] = useState(!initial.start);
  // One identity per draft, retained after failures and uncertain network responses.
  const [requestId] = useState(() => Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join(""));
  useEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    titleInput.current?.focus({ preventScroll: true });
    return () => {
      element?.close();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);
  const close = () => {
    if (submitting.current) return;
    const dirty = JSON.stringify(fields) !== JSON.stringify(initial) || allDay !== !initial.start;
    if (dirty && !window.confirm(t("robin.calendar.discardDraft"))) return;
    onClose();
  };
  const change = (key: keyof EventFields, value: string) => setFields((current) => ({ ...current, [key]: value }));
  return <dialog ref={dialog} className={`calendar-event-dialog ${styles.editor}`} aria-labelledby={headingId}
    onCancel={(event) => { event.preventDefault(); close(); }}
    onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
    <header className={styles.editorHeader}>
      <h2 id={headingId} className="pi-eyebrow">{t(editing ? "robin.calendar.edit" : "robin.calendar.create")}</h2>
      <button type="button" className={styles.iconButton} aria-label={t("i18n.close")} disabled={busy} onClick={close}>×</button>
    </header>
    <form id="robin-calendar-form" className={styles.editorForm} aria-busy={busy} onSubmit={(event) => {
      event.preventDefault();
      if (submitting.current || !fields.title.trim()) return;
      submitting.current = true; setBusy(true);
      void onSave({ ...fields, start: allDay ? "" : fields.start, end: allDay ? "" : fields.end }, requestId)
        .then((saved) => { if (saved) onClose(); })
        .finally(() => { submitting.current = false; setBusy(false); });
    }}>
      <fieldset disabled={busy}>
        <input ref={titleInput} className={styles.titleInput} required value={fields.title}
          aria-label={t("robin.calendar.eventPlaceholder")} placeholder={t("robin.calendar.eventPlaceholder")}
          onChange={(event) => change("title", event.target.value)} />
        <label className={styles.allDay}><input type="checkbox" checked={allDay} onChange={(event) => {
          setAllDay(event.target.checked);
          if (!event.target.checked && !fields.start) setFields((current) => ({ ...current, start: "09:00", end: "10:00" }));
        }} />{t("robin.calendar.allDay")}</label>
        <div className={styles.editorDates}>
          <label>{t("robin.calendar.date")}<input type="date" required value={fields.date} onChange={(event) => {
            const date = event.target.value;
            setFields((current) => ({ ...current, date, endDate: current.endDate && current.endDate < date ? date : current.endDate }));
          }} /></label>
          <label>{t("robin.calendar.lastDay")}<input type="date" value={fields.endDate || fields.date} min={fields.date}
            title={t("robin.calendar.endDateHint")} onChange={(event) => change("endDate", event.target.value)} /></label>
          {!allDay && <>
            <label>{t("robin.calendar.startTime")}<input type="time" required value={fields.start} onChange={(event) => change("start", event.target.value)} /></label>
            <label>{t("robin.calendar.endTime")}<input type="time" value={fields.end}
              min={!fields.endDate || fields.endDate === fields.date ? fields.start : undefined} onChange={(event) => change("end", event.target.value)} /></label>
          </>}
        </div>
        <label>{t("robin.calendar.location")}<input value={fields.location} onChange={(event) => change("location", event.target.value)} /></label>
        <p className={styles.note}>{t("robin.calendar.localEvent")}</p>
        {error && <p role="alert" className={styles.feedback}>{error}</p>}
        <div className={styles.editorActions}>
          <button type="button" className={styles.control} onClick={close}>{t("robin.common.cancel")}</button>
          <button type="submit" className={styles.create} disabled={!fields.title.trim() || !fields.date}>{t(busy ? "robin.calendar.saving" : "robin.common.save")}</button>
        </div>
      </fieldset>
    </form>
  </dialog>;
}
