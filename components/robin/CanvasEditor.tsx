"use client";

import { useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CaptureUpdateAction, Excalidraw, FONT_FAMILY, MainMenu, convertToExcalidrawElements, restoreElements, useHandleLibrary } from "@excalidraw/excalidraw";
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI, LibraryItems } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement, FontFamilyValues } from "@excalidraw/excalidraw/element/types";
import "@excalidraw/excalidraw/index.css";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { isDarkTheme } from "@/lib/theme";
import { canvasContext, snapshotCanvas, MAX_CANVAS_BYTES, type CanvasAssetLibrary, type CanvasDocument } from "@/extension/robin/canvas";
import { AgentPanel } from "./AgentPanel";
import { createCanvasAutosave, type CanvasSaveState } from "./canvas-autosave";
import { configureCanvasFont } from "./canvas-font";
import type { CanvasWorkspaceProps } from "./CanvasWorkspace";
import layout from "./NotesWorkspace.module.css";
import styles from "./CanvasEditor.module.css";

// Fonts, including Chinese fallback glyphs, stay on this server rather than a CDN.
(window as Window & { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = "/excalidraw/";
const NOTES_FONT = configureCanvasFont(FONT_FAMILY, getComputedStyle(document.documentElement).getPropertyValue("--font-serif")) as FontFamilyValues;

export default function CanvasEditor({ initial, initialLibrary, ref, split, mobilePane, model, footer, onSaved, onShowCanvas }: CanvasWorkspaceProps & { initial: CanvasDocument; initialLibrary: CanvasAssetLibrary }) {
  const { t, locale } = useI18n();
  const { theme } = useTheme();
  const router = useRouter();
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const [title, setTitle] = useState(initial.title);
  const [scene, setScene] = useState(initial.scene);
  const [saveState, setSaveState] = useState<CanvasSaveState>("saved");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const content = useRef({ title: initial.title, scene: initial.scene });
  const fingerprint = useRef("");
  const onSavedRef = useRef(onSaved);
  useEffect(() => { onSavedRef.current = onSaved; }, [onSaved]);
  const [saver] = useState(() => createCanvasAutosave({
    revision: initial.revision,
    persist: async (next, revision) => {
      const body = JSON.stringify({ id: initial.id, revision, ...next });
      if (new TextEncoder().encode(body).length > MAX_CANVAS_BYTES) throw new Error(t("canvas.tooLarge"));
      const response = await fetch("/api/robin/canvases", { method: "PATCH", headers: { "Content-Type": "application/json" }, body });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 409 || response.status === 404) setConflict(true);
        throw new Error(result.error ?? t("notes.save.error"));
      }
      return result.canvas;
    },
    onState: (state, failure) => { setSaveState(state); setError(failure?.message ?? ""); },
    onSaved: (summary) => onSavedRef.current(summary),
  }));
  const [libraryState, setLibraryState] = useState<CanvasSaveState>("saved");
  const [libraryError, setLibraryError] = useState("");
  const [libraryConflict, setLibraryConflict] = useState(false);
  const libraryFingerprint = useRef(JSON.stringify(initialLibrary.libraryItems));
  const [librarySaver] = useState(() => createCanvasAutosave<LibraryItems, Pick<CanvasAssetLibrary, "revision">>({
    revision: initialLibrary.revision,
    persist: async (libraryItems, revision) => {
      const body = JSON.stringify({ libraryItems, revision });
      if (new TextEncoder().encode(body).length > MAX_CANVAS_BYTES) throw new Error(t("canvas.assets.tooLarge"));
      const response = await fetch("/api/robin/canvases/library", { method: "PUT", headers: { "Content-Type": "application/json" }, body });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 409) setLibraryConflict(true);
        throw new Error(result.error ?? t("canvas.assets.error"));
      }
      return result;
    },
    onState: (state, failure) => { setLibraryState(state); setLibraryError(failure?.message ?? ""); },
    onSaved: () => {},
  }));
  // Use the native, domain-restricted URL import and confirmation flow. Our own
  // saver retains failed edits and flushes before switching boards, just like scenes.
  useHandleLibrary({ excalidrawAPI: api });
  const libraryChanged = (items: LibraryItems) => {
    const fingerprint = JSON.stringify(items);
    if (fingerprint === libraryFingerprint.current) return;
    libraryFingerprint.current = fingerprint;
    librarySaver.change(items);
  };
  useImperativeHandle(ref, () => ({ flush: async () => {
    await Promise.all([saver.flush(), librarySaver.flush()]);
    return { id: initial.id, revision: saver.getRevision() };
  } }), [initial.id, saver, librarySaver]);

  useEffect(() => {
    const flush = () => Promise.all([saver.flush(), librarySaver.flush()]);
    const dirty = () => saver.isDirty() || librarySaver.isDirty();
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty()) { event.preventDefault(); event.returnValue = ""; }
    };
    const leave = (event: MouseEvent) => {
      if (!dirty() || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
      if (!link || link.target === "_blank" || link.hasAttribute("download") || link.getAttribute("href")?.startsWith("#")) return;
      event.preventDefault();
      event.stopPropagation();
      void flush().then(() => {
        const target = new URL(link.href);
        if (target.origin === location.origin) router.push(target.pathname + target.search + target.hash);
        else location.assign(target.href);
      }).catch(() => {});
    };
    const visibility = () => { if (document.visibilityState === "hidden") void flush().catch(() => {}); };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", leave, true);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", leave, true);
      document.removeEventListener("visibilitychange", visibility);
      saver.dispose();
      librarySaver.dispose();
      void flush().catch(() => {});
    };
  }, [router, saver, librarySaver]);

  const changed = (elements: readonly ExcalidrawElement[], state: AppState, files: BinaryFiles) => {
    if (state.isLoading) return;
    const next = snapshotCanvas(elements, state, files);
    const key = JSON.stringify([elements.map((el) => [el.id, el.version, el.versionNonce, el.isDeleted]), Object.keys(files), next.appState]);
    if (key === fingerprint.current) return;
    const first = fingerprint.current === "";
    fingerprint.current = key;
    content.current = { ...content.current, scene: next };
    setScene(next);
    // Restoring the initial scene is not an edit and must not advance its revision.
    if (!first) saver.change(content.current);
  };
  useEffect(() => {
    // The embedded editor's menu trigger is icon-only and has no default name.
    boardRef.current?.querySelector(".main-menu-trigger")?.setAttribute("aria-label", t("canvas.menu"));
  }, [api, split, t]);

  const rename = (value: string) => {
    setTitle(value);
    content.current = { ...content.current, title: value.trim() || t("canvas.untitled") };
    saver.change(content.current);
  };
  const sticky = (text: string) => {
    if (!api) return;
    const state = api.getAppState();
    const added = convertToExcalidrawElements([{
      type: "rectangle", x: -state.scrollX + state.width / state.zoom.value / 2 - 120,
      y: -state.scrollY + state.height / state.zoom.value / 2 - 90,
      width: 240, height: 180, roughness: 0, roundness: null, fillStyle: "solid",
      // Element colors belong to the portable drawing, not theme-dependent UI.
      backgroundColor: "#f5e6b8", strokeColor: "#8a7354", strokeWidth: 1,
      label: { text, fontSize: 18, fontFamily: NOTES_FONT, textAlign: "left", verticalAlign: "top" },
    }]);
    api.updateScene({ elements: [...api.getSceneElementsIncludingDeleted(), ...added], appState: { selectedElementIds: Object.fromEntries(added.map((element) => [element.id, true])) }, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    api.setActiveTool({ type: "selection" });
    onShowCanvas();
    requestAnimationFrame(() => boardRef.current?.querySelector<HTMLElement>(".excalidraw")?.focus());
  };
  const context = useMemo(() => canvasContext(scene), [scene]);
  const initialData = useMemo(() => ({
    ...initial.scene,
    libraryItems: initialLibrary.libraryItems,
    // Reflow saved text using the same font that now draws it, including bound labels.
    elements: restoreElements(initial.scene.elements, null, { refreshDimensions: true, repairBindings: true }),
    appState: { ...initial.scene.appState, viewBackgroundColor: "transparent", currentItemRoughness: 0, currentItemRoundness: "sharp" as const, currentItemFontFamily: NOTES_FONT, currentItemStrokeColor: "#34343b" },
  }), [initial, initialLibrary]);

  return <div className={layout.rightColumn} hidden={!split && mobilePane === "notion"}>
    <main className={`${layout.notePane} ${styles.pane}`} hidden={!split && mobilePane !== "note"} aria-label={t("canvas.title")}>
      <div className={styles.toolbar}>
        <input value={title} onChange={(event) => rename(event.target.value)} onBlur={() => setTitle(content.current.title)} aria-label={t("canvas.name")} maxLength={200} />
        <span role="status" data-state={libraryState === "saved" ? saveState : libraryState}>{t(libraryState !== "saved" ? libraryState === "error" ? "canvas.assets.error" : "canvas.assets.saving" : saveState === "dirty" ? "notes.save.unsaved" : saveState === "saving" ? "notes.save.saving" : saveState === "error" ? "notes.save.error" : "notes.save.saved")}</span>
        <button type="button" className="ui-action pi-chrome-label pi-bracket" aria-label={t("canvas.sticky")} disabled={!api} onClick={() => sticky(t("canvas.stickyText"))}>{t("canvas.sticky")}</button>
      </div>
      {error ? <div className={styles.error} role="alert">{conflict ? t("canvas.conflict") : error}
        {conflict ? <button type="button" onClick={() => { if (window.confirm(t(librarySaver.isDirty() ? "canvas.assets.reloadConfirm" : "canvas.reloadConfirm"))) { saver.discard(); librarySaver.discard(); location.reload(); } }}>{t("canvas.reload")}</button>
          : <button type="button" onClick={() => void saver.flush().catch(() => {})}>{t("canvas.retry")}</button>}
      </div> : null}
      {libraryError ? <div className={styles.error} role="alert">{libraryConflict ? t("canvas.assets.conflict") : `${t("canvas.assets.error")}: ${libraryError}`}
        {libraryConflict ? <button type="button" onClick={() => { if (window.confirm(t("canvas.assets.reloadConfirm"))) { saver.discard(); librarySaver.discard(); location.reload(); } }}>{t("canvas.reload")}</button>
          : <button type="button" onClick={() => void librarySaver.flush().catch(() => {})}>{t("canvas.retry")}</button>}
      </div> : null}
      <div ref={boardRef} className={styles.board}>
        <Excalidraw excalidrawAPI={setApi} initialData={initialData} onChange={changed} name={title}
          onLibraryChange={libraryChanged} libraryReturnUrl={encodeURIComponent(`${location.origin}/notes?canvas=${initial.id}`)}
          langCode={locale === "zh-CN" ? "zh-CN" : "en"} theme={isDarkTheme(theme) ? "dark" : "light"}
          handleKeyboardGlobally={false} aiEnabled={false} validateEmbeddable={false}
          UIOptions={{ canvasActions: { changeViewBackgroundColor: false, toggleTheme: false, export: { saveFileToDisk: true }, saveToActiveFile: false } }}>
          <MainMenu>
            <MainMenu.DefaultItems.LoadScene />
            <MainMenu.DefaultItems.SaveToActiveFile />
            <MainMenu.DefaultItems.Export />
            <MainMenu.DefaultItems.SaveAsImage />
            <MainMenu.DefaultItems.ClearCanvas />
            <MainMenu.DefaultItems.Help />
          </MainMenu>
        </Excalidraw>
      </div>
      <p className={styles.hint}>{t("canvas.hint")}</p>
    </main>
    <section id="notes-agent" className={layout.agentPane} hidden={!split && mobilePane !== "agent"} aria-label={t("canvas.agent.title")}>
      <AgentPanel mode="notes" endpoint="/api/robin/notes-agent" requestBody={{ draftId: `canvas:${initial.id}`, documentKind: "canvas", title, note: context, provider: model?.provider ?? "", modelId: model?.modelId ?? "" }}
        titleKey="canvas.agent.title" placeholderKey="canvas.agent.placeholder" restartHintKey="notes.agent.restartHint" emptyHintKey="canvas.agent.empty" toolKeys={{}}
        replyAction={{ labelKey: "canvas.agent.useReply", onReply: sticky }} attachments disabled={!model || !api} footer={footer} transcriptKey={`canvas:${initial.id}`} />
    </section>
  </div>;
}
