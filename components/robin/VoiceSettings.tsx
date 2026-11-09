"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { VoiceReadiness } from "@/extension/robin/voice";
import { ConfigButton, ConfigDetailActions, ConfigDetailGrid, ConfigDetailGridRow } from "../SettingsUi";
import { useRobinVoice } from "./useRobinVoice";

/** Diagnostics never capture audio; preview is an explicit, billed TTS request. */
export function VoiceSettings({ children, previewDisabled = false }: { children?: ReactNode; previewDisabled?: boolean }) {
  const { t } = useI18n();
  const speech = useRobinVoice(() => {});
  const previewing = speech.phase === "synthesizing" || speech.phase === "speaking";
  const [permission, setPermission] = useState<PermissionState | "unknown">("unknown");
  const [availability, setAvailability] = useState<"checking" | "ready" | "insecure" | "unsupported">("checking");
  const [config, setConfig] = useState<VoiceReadiness | null>(null);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<"ok" | "denied" | "missing" | "busy" | null>(null);
  const mounted = useRef(false);
  const pending = useRef(false);
  const refreshPermission = useRef<() => void>(() => {});

  useEffect(() => {
    mounted.current = true;
    setAvailability(!window.isSecureContext ? "insecure" :
      !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder || !window.AudioContext || !window.OfflineAudioContext ? "unsupported" : "ready");
    let disposed = false;
    let status: PermissionStatus | undefined;
    const changed = () => { if (status && !disposed) setPermission(status.state); };
    const refresh = async () => {
      try {
        const next = await navigator.permissions.query({ name: "microphone" as PermissionName });
        if (disposed) return;
        status?.removeEventListener("change", changed);
        status = next;
        changed();
        status.addEventListener("change", changed);
      } catch {
        // Safari versions without microphone query support are unknown, not denied.
        if (!disposed) setPermission("unknown");
      }
    };
    refreshPermission.current = () => { void refresh(); };
    void refresh();
    window.addEventListener("focus", refresh);
    return () => {
      disposed = true; mounted.current = false;
      status?.removeEventListener("change", changed);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setConfig(null); setFailed(false);
    void fetch("/api/robin/voice", { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("readiness");
      const body = await response.json() as VoiceReadiness;
      if (typeof body.configured !== "boolean" || typeof body.ttsConfigured !== "boolean") throw new Error("readiness");
      if (!controller.signal.aborted) setConfig(body);
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [revision]);

  async function checkMicrophone() {
    if (pending.current || availability !== "ready") return;
    pending.current = true; setTesting(true); setResult(null);
    try {
      // Called directly from a click. Never record, upload, or hold a stream open.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Also releases a late grant after leaving Settings or switching categories.
      stream.getTracks().forEach(track => track.stop());
      if (mounted.current) { setResult("ok"); refreshPermission.current(); }
    } catch (error) {
      if (mounted.current) {
        const name = error instanceof Error ? error.name : "";
        setResult(name === "NotAllowedError" || name === "SecurityError" ? "denied" : name === "NotFoundError" ? "missing" : "busy");
        refreshPermission.current();
      }
    } finally {
      pending.current = false;
      if (mounted.current) setTesting(false);
    }
  }

  return <>
    <h2>{t("voice.settingsTitle")}</h2>
    <p>{t("voice.settingsIntro")}</p>
    <div aria-live="polite">
      <ConfigDetailGrid>
        <ConfigDetailGridRow label={t("voice.browserSupport")}>{t(`voice.support.${availability}`)}</ConfigDetailGridRow>
        <ConfigDetailGridRow label={t("voice.microphonePermission")}>{t(`voice.permission.${permission}`)}</ConfigDetailGridRow>
        <ConfigDetailGridRow label={t("voice.recognitionService")}>
          {t(failed ? "voice.configFailed" : !config ? "voice.checking" : config.configured ? "voice.localReady" : "voice.setup")}
        </ConfigDetailGridRow>
        <ConfigDetailGridRow label={t("voice.replyService")}>
          {t(failed ? "voice.configFailed" : !config ? "voice.checking" : config.ttsConfigured ? "voice.ttsReady" : "voice.ttsOff")}
          {config?.ttsConfigured && <span> · {config.ttsModel}</span>}
        </ConfigDetailGridRow>
      </ConfigDetailGrid>
    </div>
    <ConfigDetailActions>
      <ConfigButton disabled={availability !== "ready" || testing} onClick={() => void checkMicrophone()}>
        {t(testing ? "voice.permissionWaiting" : "voice.checkMicrophone")}
      </ConfigButton>
      <ConfigButton onClick={() => { setRevision(value => value + 1); refreshPermission.current(); }}>{t("voice.checkAgain")}</ConfigButton>
    </ConfigDetailActions>
    <p>{t("voice.microphoneCheckHint")}</p>
    {result && <p role={result === "ok" ? "status" : "alert"} style={{ color: result === "ok" ? "var(--text)" : "var(--danger)" }}>{t(`voice.micResult.${result}`)}</p>}
    {children}
    <p>{t("voice.bosonPreviewHint")}</p>
    <p>{t("voice.bosonSample")}</p>
    <ConfigDetailActions>
      <ConfigButton disabled={previewDisabled || previewing || !config?.ttsConfigured || config.ttsModel !== "higgs-tts-3"}
        onClick={() => speech.readReply(t("voice.bosonSample"))}>
        {t(speech.phase === "synthesizing" ? "voice.bosonGenerating" : "voice.bosonPreview")}
      </ConfigButton>
      {(previewing || speech.audioUrl) && <ConfigButton onClick={speech.end}>{t("voice.stopSpeech")}</ConfigButton>}
    </ConfigDetailActions>
    {speech.error && <p role="alert" style={{ color: "var(--danger)" }}>{t(`voice.error.${speech.error}`)}</p>}
    <audio ref={speech.audioRef} controls hidden={!speech.audioUrl} aria-label={t("voice.bosonPreview")}
      style={{ width: "100%" }} onEnded={speech.playbackEnded} onPause={speech.playbackPaused} onPlay={speech.playbackStarted} />
    <h3>{t("voice.permissionGuide")}</h3>
    <p>{t("voice.permissionHelp")}</p>
    <p>{t("voice.chromePermissionHelp")}</p>
    <p>{t("voice.systemPermissionHelp")}</p>
    <details>
      <summary>{t("voice.setupDetails")}</summary>
      <p>{t("voice.setupInstructions")}</p>
      <p>{t("voice.setupOrigin")}</p>
    </details>
    <details>
      <summary>{t("voice.privacyLabel")}</summary>
      <p>{t("voice.gestureDetails")}</p>
      <p>{t("voice.directPrivacy")}</p>
      <p>{t("voice.dictationPrivacy")}</p>
    </details>
  </>;
}
