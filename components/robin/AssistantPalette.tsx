"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const close = useCallback(() => {
    dialogRef.current?.close();
    setOpen(false);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.key.toLowerCase() !== "k" || event.altKey || event.shiftKey) return;
      if (!event.metaKey && !event.ctrlKey) return;

      event.preventDefault();
      setOpen((current) => !current);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (!dialog.open) dialog.showModal();
    requestAnimationFrame(() => dialog.querySelector<HTMLInputElement>("input")?.focus());
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      className="robin-command-dialog robin-dashboard"
      aria-label={t("robin.assistant.placeholder")}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClose={() => setOpen(false)}
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
        <AssistantBar sessionId={sessionId} cwd={cwd} onNavigate={close} />
        <p className="robin-command-dialog__hint">
          daily · job · gmail · events · learn · research · product · chat
        </p>
      </div>
    </dialog>
  );
}
