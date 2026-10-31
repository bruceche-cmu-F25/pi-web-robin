"use client";
import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import type { VoiceReadiness } from "@/extension/robin/voice";
import { useRobinVoice } from "./useRobinVoice";
import { useVoiceGesture } from "./useVoiceGesture";
import { smoothVoiceLevel, voiceLevel } from "./voice-meter";
import styles from "./VoiceControls.module.css";

export interface VoiceHandle { prepareReply: () => (text: string | null) => void; end: () => void; isCapturing: () => boolean }
interface Props {
  onTranscript: (text: string) => void; onSend: () => void; canSend: boolean; busy: boolean;
  replyText?: string; triggerTarget?: HTMLElement | null; dictationOnly?: boolean; inputKind?: "search" | "message";
  /** Standalone Robin entry keeps an editable transcript here, then requires Send. */
  standalone?: boolean;
  completed?: boolean;
  /** Composer-local dictation: compact bar, then return to the existing draft. */
  inline?: boolean;
  onCaptureChange?: (capturing: boolean) => void;
  children?: ReactNode;
}

/** Shared capture UI. Finishing a recording only produces a draft, never a message. */
export const VoiceControls = forwardRef<VoiceHandle, Props>(function VoiceControls({ onTranscript, onSend, canSend, busy, replyText, triggerTarget, dictationOnly = false, inputKind = "message", standalone = false, completed = false, inline = false, onCaptureChange, children }, ref) {
  const { t } = useI18n();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [spokenReplies, setSpokenReplies] = useState(false);
  const [receipt, setReceipt] = useState(false);
  const voice = useRobinVoice(text => {
    onTranscript(text);
    if (inline) {
      // Transcription succeeded: the destination owns the text now. Do not keep
      // a misleading "microphone off" panel over the draft or send it implicitly.
      setReceipt(true); setOpen(false); voice.end();
    }
  });
  const [config, setConfig] = useState<VoiceReadiness | null>(null);
  const [failed, setFailed] = useState(false);
  const [checking, setChecking] = useState(0);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const finishRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [triggerPressed, setTriggerPressed] = useState(false);
  const gesture = useVoiceGesture({
    phase: () => busy ? "waiting" : voice.capture.current.phase,
    start: () => {
      setOpen(true); setReceipt(false);
      setHost((triggerTarget ?? rootRef.current)?.closest<HTMLElement>("dialog[open]") ?? document.body);
      // Inline controls leave a focused composer (and its keyboard) alone.
      if (!inline && document.activeElement instanceof HTMLElement) document.activeElement.blur();
      // Reopening an unsent transcript is review, not consent to replace it.
      if ((!open && standalone && canSend) || !config?.configured || busy) return Promise.resolve(false);
      return voice.start(spokenReplies && !!config.ttsConfigured);
    },
    finish: () => voice.finish(),
    cancel: () => { voice.end(); if (inline) setOpen(false); },
  });
  const endRef = useRef(gesture.cancel);
  const interruptRef = useRef(voice.interrupt);
  useEffect(() => { endRef.current = gesture.cancel; interruptRef.current = () => { gesture.reset(); voice.interrupt(); }; });
  useEffect(() => {
    // Another device may start a turn while this device is recording. Never leave a
    // hidden/live microphone behind a working state, or submit this utterance later.
    if (busy && ["permission", "recording", "transcribing"].includes(voice.capture.current.phase)) {
      interruptRef.current();
    }
  }, [busy, voice.capture]);
  useEffect(() => {
    const target = triggerTarget ?? rootRef.current;
    setHost(target?.closest<HTMLElement>("dialog[open]") ?? document.body);
    if (!target || !window.IntersectionObserver) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => !entry.isIntersecting)) endRef.current();
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [triggerTarget]);
  useImperativeHandle(ref, () => ({ prepareReply: () => voice.prepareReply(spokenReplies && !!config?.ttsConfigured), end: () => { gesture.cancel(); setOpen(false); },
    isCapturing: () => ["permission", "recording", "transcribing"].includes(voice.capture.current.phase),
  }));
  useEffect(() => {
    const claimed = (event: Event) => {
      if ((event as CustomEvent).detail !== voice.capture.current) setOpen(false);
    };
    window.addEventListener("robin-voice-claim", claimed);
    return () => window.removeEventListener("robin-voice-claim", claimed);
  }, [voice.capture]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/robin/voice", { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("setup");
      const body = await response.json() as VoiceReadiness;
      if (!controller.signal.aborted) { setConfig(body); setFailed(false); }
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [checking]);
  const active = open || voice.phase !== "idle" || !!voice.error;
  const capturing = ["permission", "recording", "transcribing"].includes(voice.phase);
  useEffect(() => { onCaptureChange?.(capturing); }, [capturing, onCaptureChange]);
  useEffect(() => () => onCaptureChange?.(false), [onCaptureChange]);
  function close() {
    gesture.cancel(); setOpen(false);
    if (!inline) triggerRef.current?.focus({ preventScroll: true });
    else if (rootRef.current?.contains(document.activeElement)) requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  }
  useEffect(() => {
    if (!active) return;
    // Nonmodal top-layer panel: opening must not steal capture from the held trigger.
    // iOS 16.2 falls back to the fixed panel in the owning dialog/body.
    panelRef.current?.showPopover?.();
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopPropagation();
      endRef.current(); setOpen(false);
      if (!inline) triggerRef.current?.focus({ preventScroll: true });
      else if (rootRef.current?.contains(document.activeElement)) requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
    };
    document.addEventListener("keydown", escape, true);
    return () => document.removeEventListener("keydown", escape, true);
  }, [active, host, inline]);
  const errorCode = ["setup", "local", "provider", "busy", "cancelled", "empty", "audio", "text", "unsupported", "insecure", "permission", "interrupted", "noExcerpt", "playback"].includes(voice.error ?? "") ? voice.error : "provider";
  const recording = voice.phase === "recording";
  const title = standalone ? "voice.talkToRobin" : "voice.dictate";
  const label = recording ? "voice.finish" : title;
  const instruction = gesture.cancelling ? "voice.releaseCancel" : gesture.holding ? "voice.releaseFinish" : "voice.tapFinish";
  const trigger = <button ref={triggerRef} type="button" className={`ui-action ${styles.trigger}`}
    aria-label={t(label)} title={t(label)} aria-expanded={active} aria-haspopup={inline ? undefined : "dialog"}
    data-recording={recording || undefined} disabled={!config && !failed}
    {...gesture.handlers}
    // Keep the original target mounted and visible until pointer capture ends.
    // Afterwards only the inline bar exposes a finish button; its slot stays put.
    style={{ visibility: inline && active && !triggerPressed ? "hidden" : undefined }}
    onPointerDown={event => { setTriggerPressed(true); setOpen(true); gesture.handlers.onPointerDown(event); }}
    onPointerUp={event => { gesture.handlers.onPointerUp(event); setTriggerPressed(false); }}
    onPointerCancel={() => { gesture.handlers.onPointerCancel(); setTriggerPressed(false); }}
    onLostPointerCapture={() => { gesture.handlers.onLostPointerCapture(); setTriggerPressed(false); }}
    onClick={event => {
      // A keyboard user can reopen a submitted turn; suppressed pointer clicks
      // must never reopen an inline bar after a slide-to-cancel release.
      if (busy && event.detail === 0 && !inline) setOpen(true);
      gesture.handlers.onClick();
      if (inline && event.detail === 0) requestAnimationFrame(() => (finishRef.current?.disabled ? cancelRef.current : finishRef.current)?.focus({ preventScroll: true }));
    }}>
    <Microphone stop={recording} />
  </button>;

  return <div ref={rootRef} className={styles.root} data-voice-phase={voice.phase}>
    {triggerTarget !== undefined ? triggerTarget && createPortal(trigger, triggerTarget) : trigger}
    {inline && <span className="sr-only" role="status">{receipt ? t("voice.inserted") : ""}</span>}
    {inline && active && <div data-voice-panel data-voice-inline data-voice-phase={voice.phase} role="group" aria-label={t(title)}>
      <div className={styles.inlinePanel} data-cancelling={gesture.cancelling || undefined}>
        <button ref={cancelRef} type="button" className={`ui-action ${styles.inlineButton}`} onPointerDown={event => event.preventDefault()} onClick={close}
          aria-label={t(capturing ? "voice.cancelRecording" : "voice.close")} title={t(capturing ? "voice.cancelRecording" : "voice.close")}>
          <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
        {recording ? <>
          <VoiceMeter voice={voice} compact />
          <span className="sr-only" role="status">{t(gesture.cancelling ? "voice.releaseCancel" : "voice.listening")}</span>
        </> : <p role="status" className={styles.inlineStatus}>{t(voice.phase === "permission" ? "voice.permissionWaiting" : voice.phase === "transcribing" ? "voice.recognizing" : voice.error ? "voice.retryHint" : "voice.dictate")}</p>}
        <button ref={finishRef} type="button" className={`ui-action ${styles.inlineButton} ${styles.inlineFinish}`} {...gesture.handlers}
          disabled={!config?.configured || busy || ["permission", "transcribing"].includes(voice.phase)} aria-label={t(label)} title={t(label)}>
          <Microphone stop={recording} />
        </button>
      </div>
      {voice.error && <p role="alert" className={styles.error}>{t(`voice.error.${errorCode}`)}</p>}
      {!config?.configured && <div className={styles.setup}>
        <p role="status">{t(failed ? "voice.configFailed" : config ? "voice.setup" : "voice.checking")}</p>
        <button type="button" className="ui-action pi-bracket" onClick={() => setChecking(n => n + 1)}>{t("voice.checkAgain")}</button>
      </div>}
      {(voice.error || !config?.configured) && <a className={`ui-action ${styles.settingsLink}`} href="/dashboard/settings#voice" onClick={close}>{t("voice.openSettings")}</a>}
    </div>}
    {!inline && active && host && createPortal(<div ref={panelRef} popover="manual" role="dialog" aria-labelledby={titleId}
      className={styles.panel} data-voice-panel data-voice-phase={voice.phase} data-cancelling={gesture.cancelling || undefined}>
      <h2 id={titleId} className="sr-only">{t(title)}</h2>
      <div className={styles.captureRow}>
        <button type="button" className={`ui-action ${styles.close}`} onClick={close} aria-label={t(capturing ? "voice.cancelRecording" : "voice.close")} title={t("voice.close")}>
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
        <div className={styles.feedback}>
          <p role="status" aria-live="polite" className={styles.status}>
            {t(busy ? "voice.working" : recording ? "voice.listening" : voice.phase === "permission" ? "voice.permissionWaiting" : voice.phase === "transcribing" ? "voice.recognizing" : standalone && canSend ? "voice.review" : voice.phase === "idle" && completed ? "voice.done" : dictationOnly && inputKind === "search" && voice.phase === "review" ? "voice.searchReview" : voice.phase === "idle" ? "voice.gestureHint" : `voice.phase.${voice.phase}`)}
          </p>
          {recording && <VoiceMeter voice={voice} />}
          {voice.phase === "transcribing" && <span className={styles.processing} aria-hidden="true"><i /><i /><i /></span>}
        </div>
        <button type="button" className={`ui-action ${styles.record}`} {...gesture.handlers}
          disabled={!config?.configured || busy || ["permission", "transcribing"].includes(voice.phase)} aria-label={t(label)} title={t(label)}>
          <Microphone stop={recording} />
        </button>
      </div>
      {recording && <p className={styles.instruction}>{t(instruction)}</p>}
      {!config?.configured && <div className={styles.setup}>
        <p role="status">{t(failed ? "voice.configFailed" : config ? "voice.setup" : "voice.checking")}</p>
        <button type="button" className="ui-action pi-bracket" onClick={() => setChecking(n => n + 1)}>{t("voice.checkAgain")}</button>
      </div>}
      {voice.error && <p role="alert" className={styles.error}>{t(`voice.error.${errorCode}`)}</p>}
      {!capturing && children}
      {!capturing && <div className={styles.footer}>
        <details className={styles.options}>
          <summary>{t("voice.options")}</summary>
          <div>
            {!dictationOnly && config?.ttsConfigured && <div className={styles.speech}>
              <label><input type="checkbox" checked={spokenReplies} disabled={busy} onChange={event => setSpokenReplies(event.target.checked)} />{t("voice.spokenReplies")}</label>
              {replyText && <button type="button" className="ui-action" disabled={busy} onClick={() => voice.readReply(replyText)}>{t("voice.read")}</button>}
            </div>}
            <p>{t("voice.gestureDetails")}</p>
            <p>{t(standalone ? "voice.directPrivacy" : dictationOnly ? inputKind === "search" ? "voice.searchPrivacy" : "voice.dictationPrivacy" : "voice.privacy")}</p>
            <a className={`ui-action ${styles.settingsLink}`} href="/dashboard/settings#voice" onClick={close}>{t("voice.openSettings")}</a>
          </div>
        </details>
        {!dictationOnly && ((standalone && (!completed || canSend)) || voice.phase === "review") && <button type="button" className={`ui-action ${styles.send}`} disabled={busy || !canSend} onClick={onSend}>{t("voice.send")}</button>}
      </div>}
      {(voice.phase === "synthesizing" || voice.phase === "speaking" || voice.audioUrl) && <button type="button" className={`ui-action ${styles.settingsLink}`} onClick={voice.stop}>{t("voice.stopSpeech")}</button>}
      {voice.spokenText && <details><summary>{t("voice.excerpt")}</summary><p>{voice.spokenText}</p></details>}
      <audio ref={voice.audioRef} hidden={!voice.audioUrl} controls preload="none" aria-label={t("voice.player")}
        onEnded={voice.playbackEnded} onPause={voice.playbackPaused} onPlay={voice.playbackStarted} />
    </div>, host)}
  </div>;
});

function Microphone({ stop }: { stop: boolean }) {
  return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    {stop ? <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" /> : <><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/></>}
  </svg>;
}

function VoiceMeter({ voice, compact = false }: { voice: ReturnType<typeof useRobinVoice>; compact?: boolean }) {
  const barsRef = useRef<HTMLDivElement>(null);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const state = voice.capture.current;
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - state.startedAt) / 1000)), 1000);
    const samples = new Float32Array(state.analyser?.fftSize ?? 1024);
    const bars = Array.from(barsRef.current?.children ?? []) as HTMLElement[];
    const levels = new Array<number>(bars.length).fill(0);
    const center = Math.floor(bars.length / 2);
    const history = new Array<number>(compact ? bars.length : center + 1).fill(0);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0, last = 0, sampledAt = -Infinity;
    const draw = (time: number) => {
      const elapsed = last ? time - last : 16; last = time;
      const interval = reduce.matches ? 250 : 80;
      const sampled = time - sampledAt >= interval;
      if (sampled) {
        const steps = Number.isFinite(sampledAt) ? Math.min(history.length, Math.floor((time - sampledAt) / interval)) : 1;
        sampledAt = Number.isFinite(sampledAt) ? time - (time - sampledAt) % interval : time;
        samples.fill(0); state.analyser?.getFloatTimeDomainData(samples);
        const level = voiceLevel(samples);
        // Age the short trail by elapsed time, not frame count, including on slow phones.
        for (let step = 0; step < steps; step++) { history.pop(); history.unshift(level); }
      }
      bars.forEach((bar, index) => {
        const distance = compact ? bars.length - 1 - index : Math.abs(index - center);
        const target = history[distance] * (compact ? 1 : 1 - distance * 0.045);
        const next = reduce.matches ? history[0] : smoothVoiceLevel(levels[index], target, elapsed);
        if (next === levels[index] && !sampled) return;
        levels[index] = next;
        // Only these tiny elements change. No React frames, layout changes, random
        // waves or animated blur. Reduced motion keeps dots still, varying opacity.
        bar.style.transform = `scaleY(${reduce.matches ? 0.0833 : 0.0833 + next * 0.9167})`;
        bar.style.opacity = String(0.3 + next * 0.7);
      });
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => { clearInterval(timer); cancelAnimationFrame(frame); };
  }, [voice.capture, compact]);
  return <div className={compact ? `${styles.meter} ${styles.compactMeter}` : styles.meter}>
    <div ref={barsRef} className={styles.bars} data-voice-meter aria-hidden="true">
      {Array.from({ length: compact ? 31 : 9 }, (_, index) => <span key={index} />)}
    </div>
    <span className={styles.elapsed} aria-hidden="true">0:{String(seconds).padStart(2, "0")} / 1:00</span>
  </div>;
}
