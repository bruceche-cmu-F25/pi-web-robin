"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ResearchConversation } from "@/extension/robin/research-domain";
import { researchJson, researchRequest } from "./research-client";

export interface ResearchThread {
  state: ResearchConversation; ready: boolean;
  /** A turn for this project is running (whether started here or in another tab). */
  busy: boolean;
  /** Another project's turn holds the single research lock. */
  elsewhere: boolean;
  pending: { text: string; paperId?: string } | null; error: string;
  send: (text: string, paperId?: string) => Promise<boolean>;
  stop: () => Promise<void>;
  clearError: () => void;
}
/**
 * One project's conversation with the research agent. The workspace thread and the paper sheet share it,
 * so a question asked while reading lands in the same discussion it is answered in.
 */
export function useResearchThread({ projectId, locale, beforeAsk, onChange, fallbackError }: {
  projectId: string; locale: string; beforeAsk: () => Promise<void>; onChange: () => void; fallbackError: string;
}): ResearchThread {
  const [state, setState] = useState<ResearchConversation>({ messages: [], run: null });
  const [ready, setReady] = useState(false);
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<ResearchThread["pending"]>(null);
  const [error, setError] = useState("");
  const control = useRef<AbortController | null>(null);
  const signature = useRef("");
  const runningHere = !!state.run && state.run.projectId === projectId;
  const busy = sending || runningHere;
  const elsewhere = !!state.run && state.run.projectId !== projectId;
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const next = await researchRequest<ResearchConversation>(`/api/research/agent?project=${encodeURIComponent(projectId)}`, { signal });
    setState(next); setReady(true);
    const current = `${next.messages.at(-1)?.id ?? ""}:${next.run?.phase ?? ""}:${next.run?.detail ?? ""}`;
    if (current !== signature.current) { signature.current = current; onChange(); }
  }, [onChange, projectId]);
  useEffect(() => { setState({ messages: [], run: null }); setReady(false); setError(""); }, [projectId]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try { await refresh(controller.signal); }
      catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : fallbackError); }
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), busy || elsewhere ? 1200 : 6000);
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [busy, elsewhere, fallbackError, refresh]);
  useEffect(() => () => control.current?.abort(), []);
  const send = useCallback(async (text: string, paperId?: string) => {
    if (control.current || state.run || !text.trim()) return false;
    const controller = new AbortController(); control.current = controller;
    setPending({ text: text.trim(), paperId }); setSending(true); setError("");
    let sent = false;
    try {
      await beforeAsk();
      controller.signal.throwIfAborted();
      sent = true;
      await researchRequest("/api/research/agent", researchJson("POST", { question: text.trim(), locale, paperId, projectId }, controller.signal));
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : fallbackError);
    } finally {
      control.current = null; setSending(false); setPending(null); onChange();
      await refresh().catch(() => {});
    }
    return sent;
  }, [beforeAsk, fallbackError, locale, onChange, projectId, refresh, state.run]);
  const stop = useCallback(async () => {
    control.current?.abort();
    try { await researchRequest("/api/research/agent", researchJson("DELETE", {})); await refresh(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : fallbackError); }
  }, [fallbackError, refresh]);
  return { state, ready, busy, elsewhere, pending, error: error || state.error || "", send, stop, clearError: () => setError("") };
}
