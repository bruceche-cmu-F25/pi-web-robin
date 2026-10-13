"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { CanvasDocument, CanvasSummary } from "@/extension/robin/canvas";
import styles from "./NotesWorkspace.module.css";

export function CanvasLibrary({ selectedId, latest, beforeChange, onSelect, onDeleted }: {
  selectedId: string;
  latest: CanvasSummary | null;
  beforeChange: () => Promise<Pick<CanvasSummary, "id" | "revision"> | undefined>;
  onSelect: (id: string) => void;
  onDeleted: (id: string) => void;
}) {
  const { t } = useI18n();
  const [boards, setBoards] = useState<CanvasSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/robin/canvases");
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Could not load canvases");
        if (!cancelled) { setBoards(body.canvases); setError(""); }
      } catch (caught) { if (!cancelled) setError(String(caught)); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [reload]);

  useEffect(() => {
    if (latest) setBoards((current) => current.map((board) => board.id === latest.id && latest.revision >= board.revision ? latest : board));
  }, [latest]);

  const action = async (work: (saved: Pick<CanvasSummary, "id" | "revision"> | undefined) => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      // Save failures are already explained beside the drawing; don't duplicate them here.
      const saved = await beforeChange().catch(() => null);
      if (saved !== null) await work(saved);
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  };
  const create = () => action(async () => {
    const response = await fetch("/api/robin/canvases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: t("canvas.untitled") }) });
    const body = await response.json() as { canvas: CanvasDocument; error?: string };
    if (!response.ok) throw new Error(body.error ?? "Could not create canvas");
    setBoards((current) => [body.canvas, ...current]);
    onSelect(body.canvas.id);
  });
  const remove = (board: CanvasSummary) => {
    if (!window.confirm(t("canvas.deleteConfirm", { title: board.title }))) return;
    void action(async (saved) => {
      // Accept our own flushed revision, never silently accept another tab's edit.
      const revision = saved?.id === board.id ? saved.revision : board.revision;
      const response = await fetch("/api/robin/canvases", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: board.id, revision }) });
      if (!response.ok) throw new Error((await response.json()).error ?? "Could not delete canvas");
      setBoards((items) => items.filter((item) => item.id !== board.id));
      window.localStorage.removeItem(`pi-robin-agent-transcript:canvas:${board.id}`);
      onDeleted(board.id);
    });
  };
  return <section className={styles.drafts} aria-label={t("canvas.library")}>
    <header><h2 className="pi-eyebrow">{t("canvas.library")}<span className={styles.count}>{boards.length}</span></h2>
      <button type="button" disabled={busy || loading} onClick={() => void create()} aria-label={t("canvas.new")} title={t("canvas.new")}>＋</button>
    </header>
    {loading ? <p>{t("robin.common.loading")}</p> : null}
    {!loading && boards.length === 0 && !error ? <p>{t("canvas.empty")}</p> : null}
    <ul>{boards.map((stored) => {
      const board = latest?.id === stored.id && latest.revision >= stored.revision ? latest : stored;
      return <li key={board.id} data-active={selectedId === board.id}>
        <button type="button" disabled={busy} aria-current={selectedId === board.id ? "true" : undefined} onClick={() => void action(async () => onSelect(board.id))}><span>{board.title}</span><small>Canvas</small></button>
        <button type="button" disabled={busy} onClick={() => remove(board)} aria-label={t("canvas.delete", { title: board.title })}>×</button>
      </li>;
    })}</ul>
    {error ? <p role="alert">{error} <button type="button" onClick={() => setReload((n) => n + 1)}>{t("canvas.retry")}</button></p> : null}
  </section>;
}
