"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ResearchConversation } from "@/extension/robin/research-domain";
import { researchJson, researchRequest } from "./research-client";

export interface ResearchThread {
  state: ResearchConversation; ready: boolean; busy: boolean; elsewhere: boolean;
  pending: { text: string; paperId?: string } | null; error: string;
  send: (text: string, paperId?: string) => Promise<boolean>;
  stop: () => Promise<void>; reload: () => Promise<void>; clearError: () => void;
}
const empty = (): ResearchConversation => ({ messages: [], run: null });
/** Poll one human conversation. Switching it never cancels accepted background work. */
export function useResearchThread({ projectId, conversationId, paperId, locale, beforeAsk, onChange, onConversation, fallbackError }: {
  projectId: string; conversationId?: string | null; paperId?: string | null; locale: string;
  beforeAsk: () => Promise<void>; onChange: () => void; fallbackError: string;
  onConversation?: (id: string, paperId?: string) => void;
}): ResearchThread {
  const key = `${projectId}:${conversationId ?? ""}:${paperId ?? ""}`;
  const scope = useRef(key); scope.current = key;
  const [snapshot, setSnapshot] = useState<{ key: string; state: ResearchConversation }>({ key, state: empty() });
  const state = snapshot.key === key ? snapshot.state : empty();
  const [readyKey, setReadyKey] = useState("");
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<ResearchThread["pending"]>(null);
  const [error, setError] = useState("");
  const [pollError, setPollError] = useState("");
  const control = useRef<AbortController | null>(null);
  const signature = useRef("");
  const runningHere = !!state.run && state.run.projectId === projectId
    && (!state.run.conversationId || state.run.conversationId === state.conversation?.id);
  const busy = sending || runningHere;
  const elsewhere = !!state.run && !runningHere;
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const params = new URLSearchParams({ project: projectId });
    if (conversationId) params.set("conversation", conversationId);
    if (paperId) params.set("paper", paperId);
    const next = await researchRequest<ResearchConversation>(`/api/research/agent?${params}`, { signal });
    if (signal?.aborted || scope.current !== key) return;
    setSnapshot({ key, state: next }); setReadyKey(key); setPollError("");
    const current = `${key}:${next.messages.at(-1)?.id ?? ""}:${next.run?.id ?? ""}:${next.run?.phase ?? ""}:${next.run?.detail ?? ""}:${next.conversation?.revision ?? ""}`;
    if (current !== signature.current) { signature.current = current; onChange(); }
  }, [conversationId, key, onChange, paperId, projectId]);
  useEffect(() => {
    setReadyKey(""); setError(""); setPollError(""); setSending(false); setPending(null);
    return () => control.current?.abort();
  }, [key]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try { await refresh(controller.signal); }
      catch (failure) { if (!controller.signal.aborted && scope.current === key) setPollError(failure instanceof Error ? failure.message : fallbackError); }
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), busy || elsewhere ? 1200 : 6000);
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [busy, elsewhere, fallbackError, key, refresh]);
  const send = useCallback(async (text: string, targetPaperId?: string) => {
    if (control.current || state.run || state.conversation?.archived || !text.trim()) return false;
    const controller = new AbortController(); control.current = controller;
    const selectedPaper = targetPaperId ?? state.conversation?.paperId ?? paperId ?? undefined;
    const selectedConversation = targetPaperId && targetPaperId !== state.conversation?.paperId ? undefined : state.conversation?.id ?? conversationId ?? undefined;
    setPending({ text: text.trim(), paperId: selectedPaper }); setSending(true); setError("");
    let sent = false;
    try {
      await beforeAsk(); controller.signal.throwIfAborted();
      const result = await researchRequest<{ run: ResearchConversation["run"] }>("/api/research/agent", researchJson("POST", {
        question: text.trim(), locale, paperId: selectedPaper, projectId, conversationId: selectedConversation,
      }, controller.signal));
      controller.signal.throwIfAborted();
      if (scope.current !== key) return false;
      setSnapshot((current) => ({ key, state: { ...current.state, run: result.run, error: undefined, stopped: undefined } }));
      sent = true;
      if (result.run?.conversationId) onConversation?.(result.run.conversationId, result.run.paperId);
    } catch (failure) {
      if (!controller.signal.aborted && scope.current === key) setError(failure instanceof Error ? failure.message : fallbackError);
    } finally {
      await refresh(controller.signal).catch(() => {});
      if (control.current === controller) control.current = null;
      if (scope.current === key) { setSending(false); setPending(null); onChange(); }
    }
    return sent;
  }, [beforeAsk, conversationId, fallbackError, key, locale, onChange, onConversation, paperId, projectId, refresh, state]);
  const stop = useCallback(async () => {
    control.current?.abort();
    try {
      await researchRequest(`/api/research/agent${state.run ? `?run=${encodeURIComponent(state.run.id)}` : ""}`, researchJson("DELETE", {}));
      await refresh();
    } catch (failure) { if (scope.current === key) setError(failure instanceof Error ? failure.message : fallbackError); }
  }, [fallbackError, key, refresh, state.run]);
  return { state, ready: readyKey === key, busy, elsewhere, pending, error: error || state.error || pollError,
    send, stop, reload: refresh, clearError: () => { setError(""); setPollError(""); } };
}

/** Scope drafts too: an unsubmitted question must not follow the reader into another conversation. */
export function useResearchQuestion(key: string) {
  const [draft, setDraft] = useState({ key: "", text: "" });
  const latest = useRef(draft);
  useEffect(() => {
    let text = "";
    try { text = localStorage.getItem(key)?.slice(0, 10_000) ?? ""; } catch { /* Optional browser persistence. */ }
    latest.current = { key, text };
    setDraft(latest.current);
  }, [key]);
  const setQuestion = (text: string) => {
    try { localStorage.setItem(key, text); } catch { /* Optional. */ }
    if (latest.current.key !== key) return;
    latest.current = { key, text };
    setDraft(latest.current);
  };
  // A send owns this snapshot, not text typed while its request was pending.
  const clearSubmitted = () => { if (latest.current === draft && draft.key === key) setQuestion(""); };
  return { question: draft.key === key ? draft.text : "", setQuestion, clearSubmitted, draftReady: draft.key === key };
}
