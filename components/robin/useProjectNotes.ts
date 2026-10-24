"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ResearchCaptures } from "@/extension/robin/research-capture-domain";

export type NotesSaveState = "loading" | "saving" | "saved" | "error" | "conflict";
export interface ProjectNotes {
  loaded: boolean; saveState: NotesSaveState; objective: string; note: string; capturing: boolean;
  setObjective: (value: string) => void; setNote: (value: string) => void;
  /** Persist pending edits now; throws when the server does not have the newest text. */
  flush: () => Promise<void>;
  /** Keep the stored answer and archive it; partial failures still refresh the notebook. */
  capture: (messageId: string) => Promise<void>;
  captureState: ResearchCaptures;
  setVaultId: (id: string) => void;
  saveSoon: () => void;
}
/**
 * A project's focus (weekly objective) and notebook. Edits autosave, serialized so a slow older write
 * never lands over a newer one; a research turn drains them first so the agent reads the latest goal.
 */
export function useProjectNotes(projectId: string, messages: { error: string; limit: string }): ProjectNotes {
  const [objective, setObjectiveState] = useState("");
  const [note, setNoteState] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<NotesSaveState>("loading");
  const [capturing, setCapturing] = useState(false);
  const [captureState, setCaptureState] = useState<ResearchCaptures>({ captures: [], vaults: [], vaultId: "" });
  const objectiveRef = useRef(""); const noteRef = useRef("");
  const savedObjective = useRef(""); const savedNote = useRef("");
  const revision = useRef(""); const conflicted = useRef(false);
  const saveInFlight = useRef<Promise<void> | null>(null);
  const appendInFlight = useRef<Promise<void> | null>(null);
  const mounted = useRef(true);
  const url = `/api/research/objective?project=${encodeURIComponent(projectId)}&captures=1`;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let cancelled = false;
    setLoaded(false); setSaveState("loading");
    void fetch(url, { cache: "no-store" }).then(async (response) => {
      const body = await response.json().catch(() => null) as { objective?: unknown; note?: unknown; revision?: unknown; error?: string; captureState?: ResearchCaptures } | null;
      if (!response.ok || typeof body?.objective !== "string" || typeof body.note !== "string" || typeof body.revision !== "string") throw new Error(body?.error ?? "Invalid notes response");
      if (cancelled) return;
      revision.current = body.revision; conflicted.current = false;
      objectiveRef.current = savedObjective.current = body.objective;
      noteRef.current = savedNote.current = body.note;
      setObjectiveState(body.objective); setNoteState(body.note); setLoaded(true); setSaveState("saved");
      if (body.captureState) setCaptureState(body.captureState);
    }).catch(() => { if (!cancelled) setSaveState("error"); });
    return () => { cancelled = true; };
  }, [url]);
  const dirty = () => savedObjective.current !== objectiveRef.current || savedNote.current !== noteRef.current;
  const saveLatest = useCallback(async () => {
    if (!loaded || conflicted.current || saveInFlight.current || !dirty()) { await saveInFlight.current; return; }
    const save = (async () => {
      try {
        while (dirty()) {
          const next = { objective: objectiveRef.current, note: noteRef.current };
          if (mounted.current) setSaveState("saving");
          const patch = { revision: revision.current,
            ...(next.objective !== savedObjective.current ? { objective: next.objective } : {}),
            ...(next.note !== savedNote.current ? { note: next.note } : {}) };
          const response = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
          const body = await response.json().catch(() => null) as { revision?: unknown; error?: string } | null;
          if (response.status === 409) conflicted.current = true;
          if (!response.ok || typeof body?.revision !== "string") throw new Error(body?.error ?? messages.error);
          revision.current = body.revision;
          savedObjective.current = next.objective; savedNote.current = next.note;
        }
        if (mounted.current) setSaveState("saved");
      } catch { if (mounted.current) setSaveState(conflicted.current ? "conflict" : "error"); }
      finally { saveInFlight.current = null; }
    })();
    saveInFlight.current = save;
    await save;
  }, [loaded, messages.error, url]);
  useEffect(() => {
    if (!loaded || conflicted.current || (objective === savedObjective.current && note === savedNote.current)) return;
    setSaveState("saving");
    const timer = window.setTimeout(() => void saveLatest(), 600);
    return () => window.clearTimeout(timer);
  }, [loaded, note, objective, saveLatest]);
  const flush = useCallback(async () => {
    if (!loaded) throw new Error(messages.error);
    await appendInFlight.current;
    await saveLatest();
    if (dirty() || conflicted.current) throw new Error(messages.error);
  }, [loaded, messages.error, saveLatest]);
  const capture = useCallback(async (messageId: string) => {
    if (!loaded || appendInFlight.current) throw new Error(messages.error);
    setCapturing(true);
    const run = (async () => {
      await saveLatest();
      if (dirty() || conflicted.current) throw new Error(messages.error);
      const response = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messageId, vaultId: captureState.vaultId }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(response.status === 413 ? messages.limit : body.error ?? messages.error);
      if (typeof body.objective !== "string" || typeof body.note !== "string" || typeof body.revision !== "string") throw new Error(messages.error);
      revision.current = body.revision;
      objectiveRef.current = savedObjective.current = body.objective;
      noteRef.current = savedNote.current = body.note;
      setObjectiveState(body.objective); setNoteState(body.note); setSaveState("saved");
      if (body.captureState) setCaptureState(body.captureState);
    })();
    appendInFlight.current = run;
    try { await run; } finally { appendInFlight.current = null; setCapturing(false); }
  }, [captureState.vaultId, loaded, messages.error, messages.limit, saveLatest, url]);
  return {
    loaded, saveState, objective, note, capturing, flush, capture, captureState,
    setVaultId: (id: string) => setCaptureState((current) => ({ ...current, vaultId: id })),
    saveSoon: () => void saveLatest(),
    setObjective: (value) => { objectiveRef.current = value; setObjectiveState(value); },
    setNote: (value) => { noteRef.current = value; setNoteState(value); },
  };
}
