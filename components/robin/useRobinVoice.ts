"use client";
import { useEffect, useRef, useState } from "react";
import { VOICE_SECONDS, voiceExcerpt } from "@/extension/robin/voice";
import { recordingToWav } from "./voice-audio";

export type VoicePhase = "idle" | "permission" | "recording" | "transcribing" | "review" | "waiting" | "synthesizing" | "speaking";
const CLAIM = "robin-voice-claim";

export function useRobinVoice(onTranscript: (text: string) => void) {
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [talk, setTalk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [spokenText, setSpokenText] = useState("");
  const audioRef = useRef<HTMLAudioElement>(null);
  const current = useRef({ epoch: 0, talk: false, mounted: false, stream: null as MediaStream | null,
    recorder: null as MediaRecorder | null, context: null as AudioContext | null,
    request: null as AbortController | null, timer: null as ReturnType<typeof setTimeout> | null, url: null as string | null });
  const transcriptRef = useRef(onTranscript);
  useEffect(() => { transcriptRef.current = onTranscript; });

  function clearResources() {
    const s = current.current;
    s.epoch++;
    if (s.timer) clearTimeout(s.timer); s.timer = null;
    s.request?.abort(); s.request = null;
    if (s.recorder) {
      s.recorder.onstop = null; s.recorder.ondataavailable = null; s.recorder.onerror = null;
      if (s.recorder.state !== "inactive") s.recorder.stop(); s.recorder = null;
    }
    s.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); }); s.stream = null;
    if (s.context && s.context.state !== "closed") void s.context.close().catch(() => {}); s.context = null;
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.removeAttribute("src"); audioRef.current.load(); }
    if (s.url) URL.revokeObjectURL(s.url); s.url = null;
  }
  function stop() {
    clearResources();
    setAudioUrl(null); setSpokenText(""); setPhase("idle");
  }
  function end() {
    stop(); current.current.talk = false; setTalk(false); setError(null);
  }
  function claim() { window.dispatchEvent(new CustomEvent(CLAIM, { detail: current.current })); }
  const alive = (epoch: number) => current.current.mounted && epoch === current.current.epoch;

  useEffect(() => {
    const state = current.current;
    state.mounted = true;
    const hidden = () => { if (document.visibilityState === "hidden") end(); };
    const other = (event: Event) => { if ((event as CustomEvent).detail !== state) end(); };
    const leave = () => end();
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", leave); window.addEventListener(CLAIM, other);
    return () => {
      state.mounted = false; clearResources();
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", leave); window.removeEventListener(CLAIM, other);
    };
    // Resources belong to this panel instance; callbacks use refs, not render snapshots.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function request(url: string, init: RequestInit, epoch: number) {
    const controller = new AbortController(); current.current.request = controller;
    const timer = setTimeout(() => controller.abort(), 70_000);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { code?: string };
        throw new Error(body.code || "provider");
      }
      if (!alive(epoch)) throw new Error("cancelled");
      // Consume the body before releasing the deadline/controller.
      return url.includes("op=speak") ? await response.blob() : await response.json() as { text: string };
    } finally { clearTimeout(timer); if (current.current.request === controller) current.current.request = null; }
  }

  async function start(conversation: boolean) {
    claim(); stop(); setError(null);
    const s = current.current; s.talk = conversation; setTalk(conversation);
    const epoch = s.epoch;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder || !window.AudioContext || !window.OfflineAudioContext) {
      end(); setError("unsupported"); return;
    }
    setPhase("permission");
    try {
      // Create/resume in the user gesture, including Safari. Do not assume later autoplay is permitted.
      const context = new AudioContext(); s.context = context;
      void context.resume().catch(() => {});
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      if (!alive(epoch)) { stream.getTracks().forEach(track => track.stop()); return; }
      s.stream = stream;
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find(value => MediaRecorder.isTypeSupported(value));
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      s.recorder = recorder;
      const chunks: Blob[] = []; let size = 0;
      stream.getTracks().forEach(track => { track.onended = () => { if (alive(epoch)) { end(); setError("interrupted"); } }; });
      recorder.ondataavailable = event => {
        if (!alive(epoch)) return;
        size += event.data.size;
        if (size > 8 * 1024 * 1024) { end(); setError("audio"); return; }
        chunks.push(event.data);
      };
      recorder.onerror = () => { if (alive(epoch)) { end(); setError("audio"); } };
      recorder.onstop = () => {
        if (!alive(epoch)) return;
        if (s.timer) clearTimeout(s.timer); s.timer = null;
        s.recorder = null;
        stream.getTracks().forEach(track => { track.onended = null; track.stop(); }); s.stream = null;
        setPhase("transcribing");
        void (async () => {
          try {
            const wav = await recordingToWav(new Blob(chunks, { type: recorder.mimeType }), context);
            if (!alive(epoch)) return;
            const result = await request("/api/robin/voice?op=transcribe", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav }, epoch) as { text: string };
            if (!alive(epoch)) return;
            if (typeof result.text !== "string" || !result.text.trim()) throw new Error("empty");
            transcriptRef.current(result.text); setPhase("review");
          } catch (caught) {
            if (alive(epoch)) { setError(caught instanceof Error ? caught.message : "audio"); setPhase("idle"); }
          } finally {
            if (context.state !== "closed") void context.close().catch(() => {});
            if (s.context === context) s.context = null;
          }
        })();
      };
      recorder.start(250); setPhase("recording");
      // Leave a small margin for timer jitter; overlong audio is rejected, never clipped.
      s.timer = setTimeout(() => finish(), (VOICE_SECONDS - 1) * 1000);
    } catch {
      if (alive(epoch)) { end(); setError("permission"); }
    }
  }
  function finish() {
    const s = current.current;
    if (s.recorder?.state === "recording") { setPhase("transcribing"); s.recorder.stop(); }
  }

  async function speak(text: string, epoch: number) {
    const excerpt = voiceExcerpt(text);
    if (!excerpt) { setError("noExcerpt"); setPhase("idle"); return; }
    setError(null); setSpokenText(excerpt); setPhase("synthesizing");
    try {
      const blob = await request("/api/robin/voice?op=speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: excerpt }) }, epoch) as Blob;
      if (!alive(epoch)) return;
      const url = URL.createObjectURL(blob); current.current.url = url; setAudioUrl(url);
      const audio = audioRef.current;
      if (!audio) throw new Error("playback");
      audio.src = url;
      try { await audio.play(); if (alive(epoch)) setPhase("speaking"); }
      catch { if (alive(epoch)) { setError("playback"); setPhase("idle"); } }
    } catch (caught) {
      if (alive(epoch)) { setError(caught instanceof Error ? caught.message : "provider"); setPhase("idle"); }
    }
  }

  /** Snapshot consent at dispatch. Ending/changing the panel invalidates this receipt. */
  function prepareReply() {
    const enabled = current.current.talk;
    stop();
    const epoch = current.current.epoch;
    if (enabled) setPhase("waiting");
    let consumed = false;
    return (text: string | null) => {
      if (consumed || !alive(epoch) || !enabled) return;
      consumed = true;
      if (text) { claim(); void speak(text, epoch); } else setPhase("idle");
    };
  }
  function readReply(text: string) { claim(); stop(); void speak(text, current.current.epoch); }
  return { phase, talk, error, audioUrl, audioRef, spokenText, start, finish, stop, end, prepareReply, readReply,
    playbackEnded: () => { if (current.current.url && audioRef.current?.ended) setPhase("idle"); },
    playbackPaused: () => { if (current.current.url && audioRef.current?.paused) setPhase("idle"); },
    playbackStarted: () => { if (current.current.url && !audioRef.current?.paused) setPhase("speaking"); } };
}
