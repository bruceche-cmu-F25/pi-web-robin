"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type NotesSaveState = "loading" | "saving" | "saved" | "error";
export interface ProjectNotes {
  loaded: boolean; saveState: NotesSaveState; objective: string; note: string; capturing: boolean;
  setObjective: (value: string) => void; setNote: (value: string) => void;
  /** Persist pending edits now; throws when the server does not have the newest text. */
  flush: () => Promise<void>;
  /** Append a captured answer to the latest server notebook (never a stale browser snapshot). */
  append: (text: string) => Promise<void>;
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
  const objectiveRef = useRef(""); const noteRef = useRef("");
  const savedObjective = useRef(""); const savedNote = useRef("");
  const saveInFlight = useRef<Promise<void> | null>(null);
  const appendInFlight = useRef<Promise<void> | null>(null);
  const mounted = useRef(true);
  const url = `/api/research/objective?project=${encodeURIComponent(projectId)}`;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let cancelled = false;
    setLoaded(false); setSaveState("loading");
    void fetch(url, { cache: "no-store" }).then(async (response) => {
      const body = await response.json().catch(() => null) as { objective?: unknown; note?: unknown; error?: string } | null;
      if (!response.ok || typeof body?.objective !== "string" || typeof body.note !== "string") throw new Error(body?.error ?? messages.error);
      if (cancelled) return;
      objectiveRef.current = savedObjective.current = body.objective;
      noteRef.current = savedNote.current = body.note;
      setObjectiveState(body.objective); setNoteState(body.note); setLoaded(true); setSaveState("saved");
    }).catch(() => { if (!cancelled) setSaveState("error"); });
    return () => { cancelled = true; };
  }, [messages.error, url]);
  const dirty = () => savedObjective.current !== objectiveRef.current || savedNote.current !== noteRef.current;
  const saveLatest = useCallback(async () => {
    if (!loaded || saveInFlight.current || !dirty()) { await saveInFlight.current; return; }
    const save = (async () => {
      try {
        while (dirty()) {
          const next = { objective: objectiveRef.current, note: noteRef.current };
          if (mounted.current) setSaveState("saving");
          const response = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
          const body = await response.json().catch(() => null) as { error?: string } | null;
          if (!response.ok) throw new Error(body?.error ?? messages.error);
          savedObjective.current = next.objective; savedNote.current = next.note;
        }
        if (mounted.current) setSaveState("saved");
      } catch { if (mounted.current) setSaveState("error"); }
      finally { saveInFlight.current = null; }
    })();
    saveInFlight.current = save;
    await save;
  }, [loaded, messages.error, url]);
  useEffect(() => {
    if (!loaded || (objective === savedObjective.current && note === savedNote.current)) return;
    setSaveState("saving");
    const timer = window.setTimeout(() => void saveLatest(), 600);
    return () => window.clearTimeout(timer);
  }, [loaded, note, objective, saveLatest]);
  const flush = useCallback(async () => {
    if (!loaded) throw new Error(messages.error);
    await appendInFlight.current;
    await saveLatest();
    if (dirty()) throw new Error(messages.error);
  }, [loaded, messages.error, saveLatest]);
  const append = useCallback(async (text: string) => {
    if (!loaded || appendInFlight.current) throw new Error(messages.error);
    setCapturing(true);
    const run = (async () => {
      await saveLatest();
      if (dirty()) throw new Error(messages.error);
      const response = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(response.status === 413 ? messages.limit : body.error ?? messages.error);
      if (typeof body.objective !== "string" || typeof body.note !== "string") throw new Error(messages.error);
      objectiveRef.current = savedObjective.current = body.objective;
      noteRef.current = savedNote.current = body.note;
      setObjectiveState(body.objective); setNoteState(body.note); setSaveState("saved");
    })();
    appendInFlight.current = run;
    try { await run; } finally { appendInFlight.current = null; setCapturing(false); }
  }, [loaded, messages.error, messages.limit, saveLatest, url]);
  return {
    loaded, saveState, objective, note, capturing, flush, append, saveSoon: () => void saveLatest(),
    setObjective: (value) => { objectiveRef.current = value; setObjectiveState(value); },
    setNote: (value) => { noteRef.current = value; setNoteState(value); },
  };
}
