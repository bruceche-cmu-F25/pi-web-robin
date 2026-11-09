"use client";
import { useI18n } from "@/hooks/useI18n";
import styles from "./GlobalCompanion.module.css";
import type { VoiceTranscriptSink } from "@/lib/voice-transcript";

export interface CompanionOpenDetail { element: HTMLElement; createTranscriptSink?: () => VoiceTranscriptSink }

export const COMPANION_OPEN = "robin-companion-open";
export function VoiceGlyph({ size = 22 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
    <path d="M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4" />
  </svg>;
}
/** Opens the one root owner synchronously, preserving the microphone's user gesture. */
export function CompanionLauncher({ navigation = false, onOpen, createTranscriptSink }: {
  navigation?: boolean; onOpen?: () => void; createTranscriptSink?: () => VoiceTranscriptSink;
}) {
  const { locale } = useI18n();
  const chinese = locale.startsWith("zh");
  const label = chinese ? "开始语音对话" : "Start voice conversation";
  const hint = chinese ? "停顿后自动发送 · 明确待办直接执行，可撤销 · 语音消耗额度" : "Auto-send after pauses · clear task instructions act with undo · billed speech";
  return <button type="button" className={navigation ? `robin-nav-entry ${styles.navLauncher}` : styles.launcher}
    data-companion-launcher aria-label={label} title={`${label} — ${hint}`}
    onClick={event => { onOpen?.(); window.dispatchEvent(new CustomEvent(COMPANION_OPEN, { detail: { element: event.currentTarget, createTranscriptSink } satisfies CompanionOpenDetail })); }}>
    <span className={navigation ? "robin-nav-icon" : undefined}><VoiceGlyph /></span>
    {navigation && <span className="robin-nav-label">{chinese ? "语音对话" : "Voice"}</span>}
    <span className="sr-only">{hint}</span>
  </button>;
}
