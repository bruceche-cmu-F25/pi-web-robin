"use client";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import type { VoiceReadiness } from "@/extension/robin/voice";
import { useRobinVoice } from "./useRobinVoice";
import styles from "./VoiceControls.module.css";

export interface VoiceHandle { prepareReply: () => (text: string | null) => void; end: () => void }
interface Props { onTranscript: (text: string) => void; onSend: () => void; canSend: boolean; busy: boolean; replyText?: string; triggerTarget?: HTMLElement | null; dictationOnly?: boolean; inputKind?: "search" | "message" }

/** Adds ears and a voice to the owning panel, never another agent/session. */
export const VoiceControls = forwardRef<VoiceHandle, Props>(function VoiceControls({ onTranscript, onSend, canSend, busy, replyText, triggerTarget, dictationOnly = false, inputKind = "search" }, ref) {
  const { t } = useI18n();
  const voice = useRobinVoice(onTranscript);
  const [config, setConfig] = useState<VoiceReadiness | null>(null);
  const [failed, setFailed] = useState(false);
  const [checking, setChecking] = useState(0);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const endRef = useRef(voice.end);
  useEffect(() => { endRef.current = voice.end; });
  useEffect(() => {
    // Workspace tabs sometimes hide rather than unmount their AgentPanel.
    // Never keep a microphone running with its controls out of view.
    const target = triggerTarget ?? rootRef.current;
    if (!target || !window.IntersectionObserver) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => !entry.isIntersecting)) endRef.current();
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [triggerTarget]);
  useImperativeHandle(ref, () => ({ prepareReply: voice.prepareReply, end: voice.end }));
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/robin/voice", { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("setup");
      const body = await response.json() as VoiceReadiness;
      if (!controller.signal.aborted) { setConfig(body); setFailed(false); }
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [checking]);
  const capturing = ["permission", "recording", "transcribing"].includes(voice.phase);
  const canRecord = !!config?.configured && !busy && !capturing;
  const errorCode = ["setup", "local", "provider", "busy", "cancelled", "empty", "audio", "text", "unsupported", "permission", "interrupted", "noExcerpt", "playback"].includes(voice.error ?? "") ? voice.error : "provider";
  const active = open || voice.phase !== "idle" || voice.talk;

  const inline = triggerTarget !== undefined;
  const trigger = <button type="button" className={inline ? `ui-action ${styles.trigger}` : "ui-action pi-bracket"}
    aria-label={t("voice.title")} title={t("voice.title")} aria-expanded={active} data-recording={voice.phase === "recording" || undefined}
    onClick={() => { if (active) voice.end(); setOpen(!active); }}>
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/></svg>
    {!inline && t("voice.title")}
  </button>;

  return <div ref={rootRef} className={styles.root} data-voice-phase={voice.phase} style={inline && !active ? { margin: 0 } : undefined}>
    {inline && triggerTarget && createPortal(trigger, triggerTarget)}
    <div className={styles.actions}>
      {!inline && trigger}
      {voice.talk && <span>{t("voice.conversationOn")}</span>}
      {(voice.phase === "synthesizing" || voice.phase === "speaking" || voice.audioUrl) && <button type="button" className="ui-action pi-bracket" aria-label={t("voice.stopSpeech")} onClick={voice.stop}>{t("voice.stopSpeech")}</button>}
    </div>
    {active && <div className={styles.panel}>
      <p className={styles.hint}>{t(dictationOnly ? inputKind === "search" ? "voice.searchPrivacy" : "voice.dictationPrivacy" : "voice.privacy")}</p>
      {!config?.configured && <div className={styles.setup}>
        <p role="status">{t(failed ? "voice.configFailed" : config ? "voice.setup" : "voice.checking")}</p>
        <details><summary>{t("voice.setupDetails")}</summary>
          <p>{t("voice.setupInstructions")}</p>
          <code>ROBIN_VOICE_WHISPER_BIN</code><p>{t("voice.setupOrigin")}</p><code>ROBIN_VOICE_WHISPER_MODEL</code>
        </details>
        <button type="button" className="ui-action pi-bracket" aria-label={t("voice.checkAgain")} onClick={() => setChecking(n => n + 1)}>{t("voice.checkAgain")}</button>
      </div>}
      <div className={styles.actions}>
        <button type="button" className="ui-action pi-bracket" aria-label={t("voice.dictate")} disabled={!canRecord} onClick={() => void voice.start(false)}>{t("voice.dictate")}</button>
        {!dictationOnly && config?.ttsConfigured && <button type="button" className="ui-action pi-bracket" aria-label={t(voice.talk ? "voice.next" : "voice.conversation")} disabled={!canRecord} onClick={() => void voice.start(true)}>{t(voice.talk ? "voice.next" : "voice.conversation")}</button>}
        {voice.phase === "recording" && <button type="button" className="ui-action pi-bracket" aria-label={t("voice.finish")} onClick={voice.finish}>{t("voice.finish")}</button>}
        {(capturing || voice.talk || voice.phase === "waiting") && <button type="button" className="ui-action pi-bracket" aria-label={t("voice.end")} onClick={voice.end}>{t("voice.end")}</button>}
        {!dictationOnly && <button type="button" className="ui-action pi-bracket" aria-label={t("voice.send")} disabled={busy || capturing || !canSend} onClick={onSend}>{t("voice.send")}</button>}
        {!dictationOnly && config?.ttsConfigured && replyText && <button type="button" className="ui-action pi-bracket" aria-label={t("voice.read")} disabled={busy || capturing} onClick={() => voice.readReply(replyText)}>{t("voice.read")}</button>}
      </div>
      <p role="status" aria-live="polite" className={styles.status}>{t(dictationOnly && inputKind === "search" && voice.phase === "review" ? "voice.searchReview" : `voice.phase.${voice.phase}`)}</p>
      {voice.error && <p role="alert" className={styles.error}>{t(`voice.error.${errorCode}`)}</p>}
      {voice.spokenText && <details className={styles.excerpt}><summary>{t("voice.excerpt")}</summary><p>{voice.spokenText}</p></details>}
    </div>}
    {/* The hook owns src. Reapplying it through JSX can abort an in-flight play(). */}
    <audio ref={voice.audioRef} hidden={!voice.audioUrl} controls preload="none"
      aria-label={t("voice.player")} onEnded={voice.playbackEnded} onPause={voice.playbackPaused} onPlay={voice.playbackStarted} />
  </div>;
});
