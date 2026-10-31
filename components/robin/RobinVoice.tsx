"use client";
import { useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { VoiceControls, type VoiceHandle } from "./VoiceControls";
import { usePolledResource } from "./usePolledResource";
import { requestRefresh } from "./refreshBus";
import styles from "./VoiceControls.module.css";

/** A voice entrance to the existing default Robin conversation, not a separate voice agent. */
export function RobinVoice() {
  const { t } = useI18n();
  const voice = useRef<VoiceHandle>(null);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [heard, setHeard] = useState("");
  const [draft, setDraft] = useState("");
  const [reply, setReply] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const { data: trace, refresh } = usePolledResource<{ sessionId: string | null; running: boolean }>("/api/robin/assistant", busy ? 2_000 : 15_000);
  const traceId = sessionId ?? trace?.sessionId;

  async function send(text: string) {
    if (!text.trim() || inFlight.current || trace?.running) return;
    setHeard(text); setDraft(""); setReply(""); setError(false);
    inFlight.current = true; setBusy(true);
    const speak = voice.current?.prepareReply();
    try {
      // Exactly the same endpoint/mode/session as Dashboard Act. Never retry writes on disconnect.
      const response = await fetch("/api/robin/assistant", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text }),
      });
      const body = await response.json();
      if (!response.ok || typeof body.reply !== "string") throw new Error("unconfirmed");
      setReply(body.reply); setSessionId(body.sessionId ?? null); speak?.(body.reply);
      requestRefresh();
    } catch {
      setError(true); speak?.(null);
    } finally {
      inFlight.current = false; setBusy(false); void refresh();
    }
  }

  return <VoiceControls ref={voice} standalone busy={busy || trace?.running === true} canSend={!!draft.trim()}
    onTranscript={text => { setDraft(previous => [previous.trim(), text].filter(Boolean).join("\n")); setHeard(""); setReply(""); setError(false); }}
    onSend={() => void send(draft)} replyText={reply} completed={!!reply}>
    <div className={styles.result}>
      {heard && !draft && <><p>{t("voice.heard")}</p><blockquote>{heard}</blockquote></>}
      {!heard && !reply && !error && <label><span className="sr-only">{t("voice.heard")}</span><textarea aria-label={t("voice.heard")} value={draft} onChange={event => setDraft(event.target.value)} rows={3} /></label>}
      {reply && <p>{reply}</p>}
      {error && <p role="alert" className={styles.error}>{t("voice.actionUnconfirmed")}</p>}
      {traceId && !draft && (heard || reply || error) && <a href={`/?session=${encodeURIComponent(traceId)}`} target="_blank" rel="noopener noreferrer">{t("robin.assistant.trace")} ↗</a>}
    </div>
  </VoiceControls>;
}
