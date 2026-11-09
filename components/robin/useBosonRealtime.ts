"use client";
import { useEffect, useRef, useState } from "react";
import { useCompanionMicrophone } from "./useCompanionMicrophone";
import type { CompanionPhase } from "./useCompanionConversation";
import type { VoiceTranscript, VoiceTranscriptSink } from "@/lib/voice-transcript";
import { BOSON_REALTIME_URL, REALTIME_MAX_MS, bosonSession, Pcm24Encoder, RealtimePlayer } from "./boson-realtime";

type Message = { id: string; role: "user" | "assistant"; text: string };
type Position = NonNullable<ReturnType<RealtimePlayer["position"]>>;
/** One foreground, tool-free trial. Never restores permission, credentials or server context. */
export function useBosonRealtime() {
  const [phase, setPhase] = useState<CompanionPhase>("idle");
  const [connection, setConnection] = useState<"off" | "connecting" | "connected">("off");
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [inputSpeaking, setInputSpeaking] = useState(false);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [linked, setLinked] = useState(false);
  const writes = useRef({ queue: [] as { entry: VoiceTranscript; sink: VoiceTranscriptSink }[], busy: false, failed: false });
  const current = useRef({ mounted: false, epoch: 0, ws: null as WebSocket | null, abort: null as AbortController | null,
    player: null as RealtimePlayer | null, encoder: null as Pcm24Encoder | null, connected: false,
    response: "", generating: false, blocked: new Set<string>(), truncate: new Map<string, Position>(),
    messages: [] as Message[], turnEnd: 0, firstAudio: false,
    sink: undefined as VoiceTranscriptSink | undefined, finalized: new Set<string>(), responseItems: new Set<string>(),
    deadline: null as ReturnType<typeof setTimeout> | null, cap: null as ReturnType<typeof setTimeout> | null });
  function updateMessages(id: string, role: Message["role"], text: string, append = false) {
    const s = current.current;
    if (!id || id.length > 200) return;
    const previous = s.messages.find(message => message.id === id);
    const value = { id, role, text: ((append ? previous?.text ?? "" : "") + text).slice(0, 4000) };
    s.messages = (previous ? s.messages.map(message => message.id === id ? value : message) : [...s.messages, value]).slice(-12);
    if (s.mounted) setMessages(s.messages);
  }
  async function flushTranscripts() {
    const w = writes.current;
    if (w.busy || w.failed) return;
    w.busy = true;
    if (current.current.mounted) setSaving(true);
    try {
      while (w.queue.length) {
        const { entry, sink } = w.queue[0];
        await sink(entry);
        w.queue.shift();
      }
    } catch {
      w.failed = true;
      if (current.current.mounted) setSaveError(true);
    } finally {
      w.busy = false;
      if (current.current.mounted) setSaving(false);
    }
  }
  function persistMessage(id: string, interrupted = false) {
    const s = current.current, message = s.messages.find(value => value.id === id);
    if (!s.sink || s.finalized.has(id) || !message?.text.trim()) return;
    s.finalized.add(id);
    writes.current.queue.push({ sink: s.sink, entry: { id: crypto.randomUUID(), role: message.role, text: message.text, interrupted } });
    void flushTranscripts();
  }
  function finalizeResponse(interrupted: boolean) {
    for (const id of current.current.responseItems) persistMessage(id, interrupted);
  }
  function send(event: object) {
    const ws = current.current.ws;
    if (ws?.readyState !== WebSocket.OPEN) return false;
    if (ws.bufferedAmount > 256_000) { fail("network"); return false; }
    ws.send(JSON.stringify(event)); return true;
  }
  function release() {
    const s = current.current;
    finalizeResponse(true);
    s.epoch++; s.connected = false; s.generating = false;
    s.abort?.abort(); s.abort = null;
    if (s.deadline) clearTimeout(s.deadline); if (s.cap) clearTimeout(s.cap);
    s.deadline = s.cap = null;
    const ws = s.ws; s.ws = null;
    if (ws) { ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null; ws.close(); }
    s.player?.clear(); s.player = null; s.encoder = null; s.blocked.clear(); s.truncate.clear(); s.response = "";
    if (s.mounted) { setConnection("off"); setInputSpeaking(false); setPhase("idle"); }
  }
  function fail(code: string) { mic.stop(); if (current.current.mounted) { setError(code); setPhase("unconfirmed"); } }
  function awaitReply() {
    const s = current.current, epoch = s.epoch;
    if (s.deadline) clearTimeout(s.deadline);
    s.deadline = setTimeout(() => { if (s.epoch === epoch && s.connected) fail("network"); }, 30_000);
  }
  function interrupt(cancel: boolean) {
    const s = current.current, position = s.player?.position();
    if (s.deadline) clearTimeout(s.deadline); s.deadline = null;
    if (s.response) {
      finalizeResponse(true);
      s.blocked.add(s.response);
      if (s.blocked.size > 64) s.blocked.delete(s.blocked.values().next().value!);
      if (position) {
        if (s.generating) s.truncate.set(s.response, position);
        else send({ type: "conversation.item.truncate", ...position });
      }
      if (cancel && s.generating) send({ type: "response.cancel", response_id: s.response });
    }
    s.player?.clear();
    if (s.mounted) setPhase("interrupted");
  }
  const mic = useCompanionMicrophone({
    onStart: () => {}, onUtterance: () => {}, // Raw streaming bypasses local segmentation.
    onStop: release,
    onMute: () => { setInputSpeaking(false); if (current.current.connected) send({ type: "input_audio_buffer.clear" }); },
    onReady: context => { void connect(context); },
    onPcm: (samples, sampleRate) => {
      const s = current.current;
      if (!s.connected) return; // No pre-consent/handshake audio queue.
      try { s.encoder ??= new Pcm24Encoder(sampleRate); send({ type: "input_audio_buffer.append", audio: s.encoder.encode(samples) }); }
      catch { fail("audio"); }
    },
  });
  async function connect(context: AudioContext) {
    const s = current.current, epoch = s.epoch;
    const alive = () => s.mounted && s.epoch === epoch && mic.active();
    setConnection("connecting");
    s.deadline = setTimeout(() => { if (alive()) fail("network"); }, 25_000);
    s.cap = setTimeout(() => { if (alive()) fail("limit"); }, REALTIME_MAX_MS);
    const controller = new AbortController(); s.abort = controller;
    try {
      const response = await fetch("/api/robin/voice/realtime", { method: "POST", headers: { "Content-Type": "application/json" },
        body: "{}", signal: controller.signal, cache: "no-store" });
      const credential = await response.json();
      if (!alive()) return;
      if (!response.ok) { fail(["setup", "auth", "quota", "busy"].includes(credential.code) ? credential.code : "network"); return; }
      if (typeof credential.secret !== "string" || !/^bai-eph-[A-Za-z0-9._-]{1,2048}$/.test(credential.secret)
        || !Number.isFinite(credential.expiresAt) || credential.expiresAt * 1000 <= Date.now()) throw new Error("credential");
      const ws = new WebSocket(BOSON_REALTIME_URL, ["realtime", `bai-client-secret.${credential.secret}`]);
      s.ws = ws;
      s.player = new RealtimePlayer(context, () => {
        if (!alive()) return;
        if (s.deadline) clearTimeout(s.deadline); s.deadline = null;
        setPhase("speaking");
        if (!s.firstAudio && s.turnEnd) { s.firstAudio = true; setLatencyMs(Math.round(performance.now() - s.turnEnd)); }
      }, () => { if (alive()) setPhase(s.generating ? "waiting" : "answered"); });
      ws.onopen = () => { if (alive()) send({ type: "session.update", session: bosonSession }); };
      ws.onerror = () => { if (alive()) fail("network"); };
      ws.onclose = event => { if (alive()) fail(event.code === 4429 ? "quota" : "disconnected"); };
      ws.onmessage = event => {
        if (!alive()) return;
        try {
          if (typeof event.data !== "string" || event.data.length > 1_048_576) throw new Error("event");
          const data = JSON.parse(event.data);
          if (typeof data.type !== "string") throw new Error("event");
          if (data.type === "session.created") {
            if (data.session?.model !== "higgs-realtime" || !Array.isArray(data.session?.tools) || data.session.tools.length) throw new Error("session");
            if (s.deadline) clearTimeout(s.deadline); s.deadline = null;
            s.connected = true; setConnection("connected"); setPhase("idle"); return;
          }
          if (!s.connected && data.type !== "error") return;
          if (data.type === "error") {
            // Cancellation may race completion; never display provider messages or echo credentials.
            if (["response_not_active", "response_id_mismatch"].includes(data.error?.code)) return;
            fail(data.error?.type === "insufficient_quota" ? "quota" : "provider"); return;
          }
          if (data.type === "session.idle_timeout" || data.type === "session.max_duration_reached") { fail("limit"); return; }
          if (data.type === "input_audio_buffer.speech_started") {
            mic.keepAlive(); interrupt(false); setInputSpeaking(true); setPhase("idle");
            if (typeof data.item_id === "string") updateMessages(data.item_id, "user", "");
          } else if (data.type === "input_audio_buffer.speech_stopped") {
            mic.keepAlive(); awaitReply(); setInputSpeaking(false); setPhase("waiting"); s.turnEnd = performance.now(); s.firstAudio = false;
          } else if (data.type === "conversation.item.input_audio_transcription.completed") {
            if (typeof data.transcript === "string" && typeof data.item_id === "string") {
              updateMessages(data.item_id, "user", data.transcript); persistMessage(data.item_id);
            }
          } else if (data.type === "response.created") {
            if (typeof data.response?.id !== "string") throw new Error("response");
            if (s.response !== data.response.id) s.player?.clear();
            s.responseItems.clear();
            s.response = data.response.id; s.generating = true; setPhase("waiting");
          } else if (data.type === "response.done") {
            const id = data.response?.id;
            const position = s.truncate.get(id);
            if (position) { send({ type: "conversation.item.truncate", ...position }); s.truncate.delete(id); }
            if (id !== s.response) return;
            s.generating = false;
            if (s.deadline) clearTimeout(s.deadline); s.deadline = null;
            finalizeResponse(data.response.status !== "completed");
            if (!s.player?.hasAudio()) setPhase(data.response.status === "completed" ? "answered" : "interrupted");
          } else if (data.response_id === s.response && !s.blocked.has(data.response_id)) {
            if (data.type === "response.output_audio.delta") {
              if (typeof data.delta !== "string" || typeof data.item_id !== "string" || !Number.isInteger(data.content_index)) throw new Error("audio");
              try { s.player?.append(data.delta, data.item_id, data.content_index); }
              catch { fail("audio"); }
            } else if (["response.output_audio_transcript.delta", "response.output_audio_transcript.done"].includes(data.type)) {
              const text = data.type.endsWith(".done") ? data.transcript : data.delta;
              if (typeof text === "string" && typeof data.item_id === "string") {
                s.responseItems.add(data.item_id);
                updateMessages(data.item_id, "assistant", text, data.type.endsWith(".delta"));
              }
            } else if (data.type.startsWith("response.function_call")) {
              // No tools are configured and no event can dispatch a Robin API call.
              fail("provider");
            }
          }
        } catch { if (alive()) fail("provider"); }
      };
    } catch { if (alive()) fail("network"); }
    finally { if (s.abort === controller) s.abort = null; }
  }
  useEffect(() => {
    const s = current.current; s.mounted = true;
    return () => { s.mounted = false; release(); };
    // Resource owner is stable; callbacks are current via the microphone hook.
  }, []);
  return { mic, phase, connection, error, messages, draft, setDraft, inputSpeaking, latencyMs,
    recognizing: false, sessionId: null, audioUrl: null,
    saving, saveError, linked,
    retrySave: () => { writes.current.failed = false; setSaveError(false); void flushTranscripts(); },
    start: (sink?: VoiceTranscriptSink) => {
      if (mic.active() || mic.state === "permission") return;
      setError(null); setLatencyMs(null); setDraft("");
      current.current.sink = sink; setLinked(!!sink);
      current.current.finalized.clear(); current.current.responseItems.clear();
      current.current.messages = []; setMessages([]); // A reconnect is explicitly a new Boson conversation.
      void mic.start();
    },
    stopOutput: () => interrupt(true),
    clear: () => { mic.stop(); current.current.messages = []; setMessages([]); setDraft(""); setError(null); },
    send: () => {
      if (!current.current.connected || !draft.trim() || draft.length > 4000) return;
      interrupt(true);
      const id = `user_${crypto.randomUUID()}`;
      if (send({ type: "conversation.item.create", item: { id, type: "message", role: "user", content: [{ type: "input_text", text: draft.trim() }] } })) {
        updateMessages(id, "user", draft.trim()); persistMessage(id); setDraft("");
        current.current.turnEnd = performance.now(); current.current.firstAudio = false;
        send({ type: "response.create" }); awaitReply(); setPhase("waiting");
      }
    },
  };
}
