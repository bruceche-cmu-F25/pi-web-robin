"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, type ReactNode, type Ref } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { CanvasAssetLibrary, CanvasDocument, CanvasSummary } from "@/extension/robin/canvas";
import styles from "./NotesWorkspace.module.css";

const CanvasEditor = dynamic(() => import("./CanvasEditor"), { ssr: false, loading: function LoadingCanvas() {
  const { t } = useI18n();
  return <div className={styles.rightColumn}><p className={styles.workspaceNotice} role="status">{t("canvas.loading")}</p></div>;
} });
export interface CanvasWorkspaceHandle { flush: () => Promise<Pick<CanvasSummary, "id" | "revision">> }
export interface CanvasWorkspaceProps {
  id: string;
  ref?: Ref<CanvasWorkspaceHandle>;
  split: boolean;
  mobilePane: "notion" | "note" | "agent";
  model: { provider: string; modelId: string } | null;
  footer: ReactNode;
  onSaved: (summary: CanvasSummary) => void;
  onShowCanvas: () => void;
}
export function CanvasWorkspace(props: CanvasWorkspaceProps) {
  const { t } = useI18n();
  const [loaded, setLoaded] = useState<{ board: CanvasDocument; library: CanvasAssetLibrary } | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [board, library] = await Promise.all([
          fetch(`/api/robin/canvases?id=${encodeURIComponent(props.id)}`, { cache: "no-store" }),
          fetch("/api/robin/canvases/library", { cache: "no-store" }),
        ]);
        const [body, assets] = await Promise.all([board.json(), library.json()]);
        if (!board.ok) throw new Error(body.error ?? "Could not load canvas");
        if (!library.ok) throw new Error(assets.error ?? "Could not load canvas library");
        if (!cancelled) { setLoaded({ board: body.canvas, library: assets }); setError(""); }
      } catch (caught) { if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught)); }
    })();
    return () => { cancelled = true; };
  }, [props.id, reload]);
  if (!loaded) return <div className={styles.rightColumn} hidden={!props.split && props.mobilePane === "notion"}>
    <p className={styles.workspaceNotice} data-error={Boolean(error)} role={error ? "alert" : "status"}>{error || t("canvas.loading")} {error ? <button type="button" onClick={() => setReload((n) => n + 1)}>{t("canvas.retry")}</button> : null}</p>
  </div>;
  return <CanvasEditor {...props} initial={loaded.board} initialLibrary={loaded.library} />;
}
