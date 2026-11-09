"use client";
import { useEffect, useRef, useState } from "react";
import { UtteranceGate, type Utterance } from "./companion-audio";

export type MicrophoneState = "off" | "permission" | "listening" | "paused" | "error";
const CLAIM = "robin-voice-claim";

/** Owns one foreground mic. Callbacks cannot retain a stream after Stop or a late permission grant. */
export function useCompanionMicrophone(callbacks: {
  onStart: () => void; onUtterance: (value: Utterance) => void; onStop: () => void; onMute: () => void;
  onReady?: (context: AudioContext) => void;
  onPcm?: (samples: Float32Array, sampleRate: number) => void;
}) {
  const [state, setState] = useState<MicrophoneState>("off");
  const [muted, setMuted] = useState(false);
  const callbacksRef = useRef(callbacks); callbacksRef.current = callbacks;
  const current = useRef({ epoch: 0, mounted: false, active: false, muted: false, state: "off" as MicrophoneState,
    stream: null as MediaStream | null, context: null as AudioContext | null,
    node: null as AudioWorkletNode | null, source: null as MediaStreamAudioSourceNode | null,
    gate: null as UtteranceGate | null, timer: null as ReturnType<typeof setTimeout> | null,
    channel: null as BroadcastChannel | null });
  const update = (next: MicrophoneState) => { current.current.state = next; if (current.current.mounted) setState(next); };
  function stop(next: MicrophoneState = "off") {
    const s = current.current; s.epoch++; s.active = false; s.muted = false;
    if (s.mounted) setMuted(false);
    if (s.timer) clearTimeout(s.timer); s.timer = null;
    if (s.node) { s.node.port.onmessage = null; s.node.port.close(); s.node.disconnect(); } s.node = null;
    s.source?.disconnect(); s.source = null; s.gate?.reset(); s.gate = null;
    s.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); }); s.stream = null;
    if (s.context) { s.context.onstatechange = null; void s.context.close().catch(() => {}); } s.context = null;
    callbacksRef.current.onStop(); update(next);
  }
  function armIdle() {
    const s = current.current;
    if (s.timer) clearTimeout(s.timer);
    s.timer = setTimeout(() => stop("paused"), 120_000);
  }
  async function start() {
    const s = current.current;
    if (s.state === "permission" || s.active) return;
    stop();
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.AudioContext || !window.OfflineAudioContext || !window.AudioWorkletNode) { update("error"); return; }
    window.dispatchEvent(new CustomEvent(CLAIM, { detail: s }));
    s.channel?.postMessage("claim");
    update("permission"); const epoch = s.epoch;
    const alive = () => s.mounted && epoch === s.epoch;
    try {
      // Both are requested in the initiating click, not after a fetch or effect.
      const context = new AudioContext(); s.context = context;
      const resuming = context.resume(); void resuming.catch(() => {});
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      if (!alive()) { stream.getTracks().forEach(track => track.stop()); return; }
      s.stream = stream;
      stream.getTracks().forEach(track => { track.onended = () => { if (alive()) stop("error"); }; });
      await context.audioWorklet.addModule("/robin/companion-capture.js");
      if (!alive()) return;
      await context.resume();
      if (!alive()) return;
      const gate = new UtteranceGate(context.sampleRate, () => { armIdle(); callbacksRef.current.onStart(); },
        utterance => { armIdle(); callbacksRef.current.onUtterance(utterance); });
      const node = new AudioWorkletNode(context, "robin-companion-capture");
      s.node = node; s.gate = gate; s.source = context.createMediaStreamSource(stream);
      node.port.onmessage = event => {
        if (!alive() || !s.active || s.muted || !(event.data instanceof Float32Array)) return;
        if (callbacksRef.current.onPcm) callbacksRef.current.onPcm(event.data, context.sampleRate);
        else gate.push(event.data);
      };
      node.onprocessorerror = () => { if (alive()) stop("error"); };
      s.source.connect(node); node.connect(context.destination); // Worklet outputs silence.
      s.active = true; update("listening"); armIdle();
      context.onstatechange = () => { if (alive() && s.active && context.state !== "running") stop("paused"); };
      callbacksRef.current.onReady?.(context);
    } catch { if (alive()) stop("error"); }
  }
  useEffect(() => {
    const s = current.current; s.mounted = true;
    const hide = () => { if (document.visibilityState === "hidden") stop("paused"); };
    const other = (event: Event) => { if ((event as CustomEvent).detail !== s && (s.active || s.state === "permission")) stop("paused"); };
    const leave = () => stop("paused");
    if (typeof BroadcastChannel !== "undefined") {
      s.channel = new BroadcastChannel("robin-companion-microphone");
      s.channel.onmessage = () => { if (s.active || s.state === "permission") stop("paused"); };
    }
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", leave); window.addEventListener("offline", leave); window.addEventListener(CLAIM, other);
    return () => {
      s.mounted = false; stop(); s.channel?.close(); s.channel = null;
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", leave); window.removeEventListener("offline", leave); window.removeEventListener(CLAIM, other);
    };
    // The resource owner is stable; callbacks are current through callbacksRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function toggleMute() {
    const s = current.current;
    if (!s.active) return;
    s.muted = !s.muted;
    s.stream?.getAudioTracks().forEach(track => { track.enabled = !s.muted; });
    s.gate?.reset(); setMuted(s.muted); armIdle();
    if (s.muted) callbacksRef.current.onMute();
  }
  return { state, muted, toggleMute, isMuted: () => current.current.muted, start, stop: () => stop(), finish: () => current.current.gate?.flush(), active: () => current.current.active, keepAlive: armIdle };
}
