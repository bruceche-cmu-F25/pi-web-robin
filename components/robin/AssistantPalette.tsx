"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useI18n } from "@/hooks/useI18n";
import { AssistantBar } from "./AssistantBar";

export function AssistantPalette({
  sessionId,
  cwd,
}: {
  sessionId?: string | null;
  cwd?: string | null;
} = {}) {
  const { t } = useI18n();
  const dashboard = usePathname() === "/dashboard";
  const [open, setOpen] = useState(false);
  const [visited, setVisited] = useState(false);
  const [mode, setMode] = useState<"search" | "execute">("search");
  const triggerRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const close = useCallback(() => {
    dialogRef.current?.close();
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.key.toLowerCase() !== "k" || event.altKey || event.shiftKey) return;
      if (!event.metaKey && !event.ctrlKey) return;

      event.preventDefault();
      triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setMode("search"); setVisited(true); setOpen((current) => !current);
    };
    const launch = (event: Event) => {
      triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setMode((event as CustomEvent).detail === "execute" ? "execute" : "search");
      setVisited(true); setOpen(true);
    };
    window.addEventListener("robin-assistant-open", launch);
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("robin-assistant-open", launch); };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!open) { dialog.close(); return; }
    if (!dialog.open) dialog.showModal();
    requestAnimationFrame(() => dialog.querySelector<HTMLInputElement>("input")?.focus());
  }, [open]);

  if (!visited) return null;

  return (
    <dialog
      ref={dialogRef}
      className="robin-command-dialog robin-dashboard"
      data-dashboard={dashboard || undefined}
      aria-label={dashboard ? t(`robin.assistant.${mode}Label`) : t("robin.assistant.placeholder")}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClose={() => {
        // Native close events are queued: an old one must not dismiss a reopened dialog.
        if (!dialogRef.current?.open) setOpen(false);
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="robin-command-dialog__content">
        <button
          type="button"
          className="robin-command-dialog__close ui-action"
          onClick={close}
          aria-label={t("chat.close")}
          title={t("chat.close")}
        >
          ×
        </button>
        <AssistantBar key={dashboard ? mode : undefined} sessionId={sessionId} cwd={cwd} onNavigate={close} initialMode={mode} modeSwitch={!dashboard} active={open} />
        {!dashboard && mode === "execute" && <p className="robin-command-dialog__hint">{t("daily.captureHint")}</p>}
        {!dashboard && <p className="robin-command-dialog__hint">
          daily · job · email · events · learn · research · product · chat
        </p>}
      </div>
    </dialog>
  );
}
