"use client";

import Link from "next/link";
import { useRef } from "react";
import { useI18n } from "@/hooks/useI18n";
import styles from "./Dashboard.module.css";

/** Native modal: no new form, draft store, or assistant request until a choice is made. */
export function DashboardQuickAdd({ href, onAssistant }: { href: (path: string) => string; onAssistant: () => void }) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const close = () => dialog.current?.close();
  return <>
    <button type="button" className="ui-action" onClick={() => dialog.current?.showModal()} aria-label={t("daily.quickAdd")} aria-haspopup="dialog">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
    </button>
    <dialog ref={dialog} className={styles.quickAdd} aria-labelledby="dashboard-add-title" onClick={event => { if (event.target === event.currentTarget) close(); }}>
      <div className={styles.quickAddContent}>
        <header><h2 id="dashboard-add-title">{t("daily.quickAdd")}</h2><button type="button" className="ui-action" onClick={close} aria-label={t("daily.close")}>×</button></header>
        <Link prefetch={false} scroll={false} className="ui-action" href={href("/dashboard?view=todos&add=todo")} onClick={close}>
          <span>{t("daily.addTask")}</span><span aria-hidden="true">＋</span>
        </Link>
        <Link prefetch={false} scroll={false} className="ui-action" href={href("/dashboard?view=calendar&add=event")} onClick={close}>
          <span>{t("daily.addEvent")}</span><span aria-hidden="true">＋</span>
        </Link>
        <button type="button" className="ui-action" onClick={() => { close(); onAssistant(); }}>
          <span>{t("daily.capture")}</span><span aria-hidden="true">↗</span>
        </button>
      </div>
    </dialog>
  </>;
}
