"use client";
import { useEffect, useRef, useState } from "react";
import { COMPANION_HISTORY_LIMIT, COMPANION_TEXT_LIMIT, unfinishedUtterance, type CompanionContext, type CompanionMessage, type CompanionReply } from "@/extension/robin/companion";
import { utteranceWav, type Utterance } from "./companion-audio";
import { useCompanionMicrophone } from "./useCompanionMicrophone";
import type { VoiceInteractionReply, VoiceTaskReceipt } from "@/extension/robin/voice-interaction";
import type { VoiceTranscript, VoiceTranscriptSink } from "@/lib/voice-transcript";

export type CompanionPhase = "idle" | "recognizing" | "review" | "waiting" | "synthesizing" | "speaking" | "answered" | "interrupted" | "unconfirmed";
const STORAGE = "robin:companion:recent-v1";

export function useCompanionConversation(getContext: () => CompanionContext, taskMode = false) {
  const storage = taskMode ? "robin:voice:interaction-v1" : STORAGE;
  const [lastSpoken, setLastSpoken] = useState("");
  const [receipt, setReceipt] = useState<VoiceTaskReceipt | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [needsCheck, setNeedsCheck] = useState(false);
  const taskState = useRef({ pendingId: null as string | null, lastActionId: undefined as string | undefined,
    busy: false, request: null as AbortController | null, sink: undefined as VoiceTranscriptSink | undefined,
    saving: false, writes: [] as Array<{ sink: VoiceTranscriptSink; entry: VoiceTranscript }> });
  const [saveError, setSaveError] = useState(false);
  const [linked, setLinked] = useState(false);
  async function retrySave() {
    const state = taskState.current;
    if (state.saving) return;
    state.saving = true;
    try {
      while (state.writes.length) { const item = state.writes[0]; await item.sink(item.entry); state.writes.shift(); }
      if (current.current.mounted) setSaveError(false);
    } catch { if (current.current.mounted) setSaveError(true); }
    finally { state.saving = false; }
  }
  function saveTranscript(sink: VoiceTranscriptSink | undefined, entry: VoiceTranscript) {
    if (!sink) return;
    if (taskState.current.writes.length >= 24) { setSaveError(true); return; }
    taskState.current.writes.push({ sink, entry }); void retrySave();
  }
  const [messages, setMessages] = useState<CompanionMessage[]>([]);
  const [draft, setDraftState] = useState("");
  const [phase, setPhaseState] = useState<CompanionPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [inputSpeaking, setInputSpeaking] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const [restored, setRestored] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const contextRef = useRef(getContext); contextRef.current = getContext;
  const current = useRef({ mounted: false, generation: 0, reply: 0, draft: "", phase: "idle" as CompanionPhase,
    messages: [] as CompanionMessage[], manual: false, userSpeaking: false, queued: 0,
    chain: Promise.resolve(), asr: null as AbortController | null, request: null as AbortController | null,
    url: null as string | null,
    outputContext: null as AudioContext | null, output: null as AudioBufferSourceNode | null, buffer: null as AudioBuffer | null,
    heldSpeech: null as { text: string; generation: number; reply: number } | null });
  function phaseTo(value: CompanionPhase) { current.current.phase = value; if (current.current.mounted) setPhaseState(value); }
  function draftTo(value: string) { current.current.draft = value; if (current.current.mounted) setDraftState(value); }
  function messagesTo(value: CompanionMessage[]) { current.current.messages = value.slice(-COMPANION_HISTORY_LIMIT); if (current.current.mounted) setMessages(current.current.messages); }
  function stopOutput() {
    const s = current.current; s.reply++; s.request?.abort(); s.request = null; s.heldSpeech = null;
    if (s.output) { s.output.onended = null; s.output.stop(); s.output.disconnect(); s.output = null; }
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.removeAttribute("src"); audioRef.current.load(); }
    if (s.url) URL.revokeObjectURL(s.url); s.url = null;
    if (s.mounted) setAudioUrl(null);
  }
  function interrupted() {
    const pending = ["waiting", "synthesizing", "speaking"].includes(current.current.phase);
    stopOutput();
    if (pending) phaseTo("interrupted");
  }
  function stopConversation() {
    const s = current.current; s.generation++; s.userSpeaking = false; s.queued = 0; s.asr?.abort(); s.asr = null;
    interrupted(); s.outputContext = null; s.buffer = null;
    if (s.mounted) { setRecognizing(false); setInputSpeaking(false); }
    if (s.phase === "recognizing") phaseTo(s.draft ? "review" : "idle");
  }
  const mic = useCompanionMicrophone({
    // Reuse the context resumed by the opening click. Creating a new media
    // element after ASR/Agent/TTS waits loses that gesture on mobile Safari.
    onReady: context => { if (taskMode) current.current.outputContext = context; },
    onStart: () => {
      current.current.userSpeaking = true; setInputSpeaking(true);
      // Stop actual output immediately, but a noise onset while the Agent is
      // still working is not yet a replacement utterance. Let ASR decide that.
      if (!taskMode || !taskState.current.busy) interrupted();
    },
    onUtterance: value => { current.current.userSpeaking = false; setInputSpeaking(false); enqueue(value); },
    onStop: stopConversation,
    onMute: () => { current.current.userSpeaking = false; setInputSpeaking(false); },
  });

  async function fetchBounded(url: string, body: unknown, controller: AbortController, timeout: number, audio = false) {
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": body instanceof ArrayBuffer ? "audio/wav" : "application/json" },
        body: body instanceof ArrayBuffer ? body : JSON.stringify(body), signal: controller.signal });
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.code === "empty" ? "empty" : "request");
      }
      return audio ? await response.blob() : await response.json();
    } finally { clearTimeout(timer); }
  }

  async function submit(text: string, speak: boolean, undoOf?: string) {
    const s = current.current;
    if (!text.trim() || text.length > COMPANION_TEXT_LIMIT || s.queued || s.userSpeaking || s.phase === "waiting" || s.phase === "synthesizing" || (taskMode && taskState.current.pendingId)) return;
    stopOutput(); s.buffer = null; setError(null); setLastSpoken("");
    const reply = s.reply, generation = s.generation;
    const context = contextRef.current();
    const history = s.messages;
    draftTo(""); s.manual = false;
    messagesTo([...history, { role: "user", text: text.trim() }]);
    phaseTo("waiting");
    const alive = () => s.mounted && reply === s.reply;
    const controller = new AbortController(); s.request = controller;
    let answered = false;
    try {
      let result: Pick<CompanionReply, "answer" | "spoken">;
      if (taskMode) {
        const task = taskState.current;
        const requestId = `${Date.now()}-${crypto.randomUUID()}`;
        const sink = task.sink;
        saveTranscript(sink, { id: `voice_${requestId}_user`, role: "user", text: text.trim(), interrupted: false, source: "robin" });
        task.pendingId = requestId; task.busy = true; setPendingId(requestId); setNeedsCheck(false);
        // Store the replay id before dispatch; reload can only GET its outcome.
        persistTaskState();
        const actionController = new AbortController(); task.request = actionController;
        try {
          const value = await fetchBounded("/api/robin/voice/interaction", {
            requestId, message: text.trim(), allowTasks: true, lastActionId: task.lastActionId, ...(undoOf ? { undoOf } : {}),
          }, actionController, 105_000) as VoiceInteractionReply;
          if (!s.mounted) return;
          result = acceptTaskResult(value, requestId);
          saveTranscript(sink, { id: `voice_${requestId}_assistant`, role: "assistant", text: result.answer, interrupted: false, source: "robin" });
        } finally { task.busy = false; task.request = null; }
      } else {
        const value = await fetchBounded("/api/robin/companion", { message: text.trim(), history, context }, controller, 100_000) as CompanionReply;
        if (!alive()) return;
        if (value.actionState !== "not-executed" || typeof value.answer !== "string" || !value.answer.trim()
          || value.answer.length > COMPANION_TEXT_LIMIT || typeof value.sessionId !== "string" || value.sessionId.length > 160) throw new Error("receipt");
        result = value; setSessionId(value.sessionId);
        messagesTo([...s.messages, { role: "assistant", text: value.answer }]);
      }
      answered = true;
      const spoken = typeof result.spoken === "string" && result.spoken.trim() && result.spoken.length <= 240 ? result.spoken.trim() : "";
      setLastSpoken(spoken);
      if (alive() && !s.userSpeaking && !s.queued) phaseTo(s.draft ? "review" : "answered");
      if (taskMode && alive() && speak && spoken && generation === s.generation && (s.userSpeaking || s.queued)) {
        s.heldSpeech = { text: spoken, generation, reply };
      }
      // Interrupting playback cannot discard a task's eventual receipt. It only
      // prevents that stale response from speaking over the user's correction.
      if (!alive() || !speak || s.userSpeaking || s.queued || s.draft || !mic.active() || generation !== s.generation || document.visibilityState === "hidden") return;
      if (typeof result.spoken !== "string" || !result.spoken.trim() || result.spoken.length > 240) { setError("screenOnly"); return; }
      await playSpeech(spoken, generation, reply, controller);
    } catch {
      if (!s.mounted || ((!taskMode || answered) && !alive())) return;
      if (taskMode && !answered && taskState.current.pendingId) setNeedsCheck(true);
      phaseTo(answered ? "answered" : "unconfirmed"); setError(answered ? "speech" : "reply");
    } finally {
      if (s.request === controller) s.request = null;
      if (taskMode && s.mounted && !taskState.current.pendingId && s.draft && !s.manual && !s.queued && !s.userSpeaking
        && mic.active() && !mic.isMuted() && !unfinishedUtterance(s.draft)) void submit(s.draft, true);
    }
  }

  function playBuffer(buffer: AudioBuffer, context: AudioContext) {
    const s = current.current;
    if (context !== s.outputContext || context.state !== "running") throw new Error("playback");
    const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination);
    source.onended = () => {
      source.disconnect();
      if (s.output !== source) return;
      s.output = null;
      if (s.phase === "speaking") phaseTo("answered");
    };
    try { source.start(); }
    catch (error) { source.onended = null; source.disconnect(); throw error; }
    s.output = source; phaseTo("speaking");
  }
  async function playSpeech(text: string, generation: number, reply: number, controller = new AbortController()) {
    const s = current.current;
    const alive = () => s.mounted && generation === s.generation && reply === s.reply && mic.active() && document.visibilityState !== "hidden";
    if (!alive()) return;
    s.request = controller; s.heldSpeech = null; setError(null); phaseTo("synthesizing");
    try {
      const blob = await fetchBounded("/api/robin/voice?op=speak", { text }, controller, 70_000, true) as Blob;
      if (!alive()) return;
      if (blob.size > 8 * 1024 * 1024 || !blob.size) throw new Error("audio");
      if (taskMode) {
        const context = s.outputContext;
        if (!context || context.state !== "running") throw new Error("playback");
        const buffer = await context.decodeAudioData(await blob.arrayBuffer());
        if (!alive() || context !== s.outputContext) return;
        if (!buffer.length || buffer.duration > 120) throw new Error("audio");
        s.buffer = buffer; playBuffer(buffer, context);
        return;
      }
      const url = URL.createObjectURL(blob); s.url = url; setAudioUrl(url);
      const audio = audioRef.current;
      if (!audio) throw new Error("audio");
      audio.src = url;
      try { await audio.play(); } catch { if (alive()) { phaseTo("answered"); setError("playback"); } }
      // Only the media playing event may claim playback, never a model reply.
    } catch { if (alive()) { phaseTo("answered"); setError("speech"); } }
    finally { if (s.request === controller) s.request = null; }
  }
  function resumeHeldSpeech() {
    const s = current.current, held = s.heldSpeech;
    if (held && !s.userSpeaking && !s.queued && !s.draft && !taskState.current.pendingId) {
      void playSpeech(held.text, held.generation, held.reply);
    }
  }
  function enqueue(utterance: Utterance) {
    const s = current.current, generation = s.generation;
    if (++s.queued > 3) { mic.stop(); setError("backlog"); return; }
    setRecognizing(true); phaseTo("recognizing");
    s.chain = s.chain.then(async () => {
      if (!s.mounted || generation !== s.generation) return;
      const controller = new AbortController(); s.asr = controller;
      try {
        const wav = await utteranceWav(utterance);
        if (generation !== s.generation) return;
        const result = await fetchBounded("/api/robin/voice?op=transcribe", wav, controller, 70_000) as { text?: unknown };
        if (!s.mounted || generation !== s.generation) return;
        if (typeof result.text !== "string" || !result.text.trim()) throw new Error("empty");
        const text = [s.draft, result.text.trim()].filter(Boolean).join(" ");
        if (text.length > COMPANION_TEXT_LIMIT) { mic.stop(); setError("long"); return; }
        draftTo(text);
        if (utterance.limited) s.manual = true; // A duration limit never proves the sentence is complete.
        s.queued--; setRecognizing(s.queued > 0);
        if (s.queued || s.userSpeaking) return;
        if (s.manual || mic.isMuted() || unfinishedUtterance(text)) { phaseTo("review"); return; }
        // Recognition remains serial, but a slow task turn must not block the
        // next correction's ASR. Its text waits for the preceding real receipt.
        if (taskMode) void submit(text, true); else await submit(text, true);
      } catch (error) {
        if (s.mounted && generation === s.generation) {
          if (taskMode && error instanceof Error && error.message === "empty") {
            // A false speech onset must not shut down the call or lose the
            // pending reply. No text means no new Agent/tool request.
            s.queued--; setRecognizing(s.queued > 0);
            if (!s.queued && !s.userSpeaking) { phaseTo(taskState.current.pendingId ? "waiting" : s.draft ? "review" : "interrupted"); resumeHeldSpeech(); }
          } else { mic.stop(); phaseTo("review"); setError("recognition"); }
        }
      } finally { if (s.asr === controller) s.asr = null; }
    });
  }

  function persistTaskState() {
    if (!taskMode) return;
    try { sessionStorage.setItem(storage, JSON.stringify({ messages: current.current.messages,
      pendingId: taskState.current.pendingId, lastActionId: taskState.current.lastActionId })); } catch { /* Optional local recovery only. */ }
  }
  function acceptTaskResult(value: VoiceInteractionReply, expected: string) {
    if (value.requestId !== expected || value.state !== "done" || typeof value.answer !== "string" || !value.answer.trim()
      || value.answer.length > 4000 || typeof value.spoken !== "string") throw new Error("unconfirmed");
    taskState.current.pendingId = null; setPendingId(null); setNeedsCheck(false);
    if (value.receipt) {
      taskState.current.lastActionId = value.receipt.requestId;
      setReceipt(value.receipt);
    }
    if (value.sessionId) setSessionId(value.sessionId);
    messagesTo([...current.current.messages, { role: "assistant", text: value.answer }]);
    persistTaskState(); setError(null);
    return value;
  }
  async function checkResult() {
    const id = taskState.current.pendingId;
    if (!id || taskState.current.busy) return;
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(`/api/robin/voice/interaction?id=${encodeURIComponent(id)}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("unconfirmed");
      const value = await response.json();
      if (!current.current.mounted || taskState.current.pendingId !== id) return;
      acceptTaskResult(value, id); phaseTo(current.current.draft ? "review" : "answered");
    } catch { if (current.current.mounted) { phaseTo("unconfirmed"); setError("reply"); } }
    finally { clearTimeout(timer); }
  }

  const effects = useRef({ checkResult, persistTaskState });
  effects.current = { checkResult, persistTaskState };
  useEffect(() => {
    const task = taskState.current;
    const s = current.current; s.mounted = true;
    try {
      const raw = JSON.parse(sessionStorage.getItem(storage) || "null");
      if (taskMode) {
        if (typeof raw?.lastActionId === "string") taskState.current.lastActionId = raw.lastActionId;
        if (typeof raw?.pendingId === "string") {
          taskState.current.pendingId = raw.pendingId; setPendingId(raw.pendingId); setNeedsCheck(true); phaseTo("unconfirmed");
          void effects.current.checkResult();
        }
      }
      if (Array.isArray(raw?.messages)) messagesTo(raw.messages.filter((item: CompanionMessage) =>
        item && (item.role === "user" || item.role === "assistant") && typeof item.text === "string" && item.text.length <= COMPANION_TEXT_LIMIT));
      if (typeof raw?.sessionId === "string" && raw.sessionId.length <= 160) setSessionId(raw.sessionId);
      if (raw?.pending) phaseTo("unconfirmed");
    } catch { /* Storage is optional; no voice consent is restored. */ }
    setRestored(true);
    return () => { s.mounted = false; s.generation++; s.asr?.abort(); task.request?.abort(); stopOutput(); };
    // The root owner survives client navigation; full document navigation restores text only.
  }, [storage, taskMode]);
  useEffect(() => {
    if (!restored) return;
    if (taskMode) { effects.current.persistTaskState(); return; }
    try { sessionStorage.setItem(storage, JSON.stringify({ messages, sessionId, pending: phase === "waiting" })); } catch { /* Private mode/quota. */ }
  }, [messages, sessionId, phase, restored, storage, taskMode]);

  return { messages, draft, phase, error, sessionId, audioUrl, audioRef, mic, recognizing, inputSpeaking,
    receipt, pendingId, needsCheck, lastSpoken, checkResult, saveError, linked, retrySave,
    replay: () => {
      if (!lastSpoken || taskState.current.pendingId || current.current.userSpeaking || current.current.queued || !mic.active()) return;
      const s = current.current;
      if (taskMode && s.buffer && s.outputContext?.state === "running") {
        stopOutput(); setError(null);
        try { playBuffer(s.buffer, s.outputContext); } catch { setError("audio"); }
        return;
      }
      const audio = audioRef.current;
      if (current.current.url && audio) {
        // Autoplay-blocked audio is already downloaded: retry playback in the
        // click gesture, without another synthesis or Agent request.
        audio.currentTime = 0; setError(null);
        void audio.play().catch(() => { setError("playback"); phaseTo("answered"); });
      } else {
        stopOutput(); void playSpeech(lastSpoken, current.current.generation, current.current.reply);
      }
    },
    undo: () => { if (receipt?.undoable) void submit(document.documentElement.lang.startsWith("zh") ? "撤销上一步操作" : "Undo the last action", mic.active(), receipt.requestId); },
    setDraft: (value: string) => { current.current.manual = true; draftTo(value); },
    send: () => { void submit(current.current.draft, taskMode && mic.active()); },
    stopOutput: interrupted,
    clear: () => {
      if (taskMode && taskState.current.busy) return;
      if (taskMode && taskState.current.pendingId && !window.confirm("请先核对待办。清除记录不会撤销已提交的操作。确认已经核对？ / Check your tasks first. Clearing does not undo submitted actions. Have you checked?")) return;
      mic.stop(); taskState.current.pendingId = null; taskState.current.lastActionId = undefined;
      setPendingId(null); setNeedsCheck(false); setReceipt(null); setLastSpoken(""); messagesTo([]); draftTo(""); setSessionId(null); setError(null); phaseTo("idle"); persistTaskState();
    },
    start: (sink?: VoiceTranscriptSink) => {
      taskState.current.sink = sink; setLinked(!!sink);
      setError(null);
      if (["unconfirmed", "interrupted"].includes(current.current.phase)) phaseTo(current.current.draft ? "review" : "idle");
      void mic.start();
    },
    onPlaying: () => { if (current.current.url && !audioRef.current?.paused) phaseTo("speaking"); },
    onPaused: () => { if (current.current.phase === "speaking") phaseTo("answered"); },
    onPlaybackError: () => { if (current.current.url) { stopOutput(); phaseTo("answered"); setError("audio"); } },
  };
}
