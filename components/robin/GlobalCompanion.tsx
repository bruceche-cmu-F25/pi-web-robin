"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { companionPageContext } from "@/extension/robin/companion";
import type { VoiceReadiness } from "@/extension/robin/voice";
import { companionEnglish, companionChinese } from "@/lib/i18n/messages/companion";
import { useCompanionConversation } from "./useCompanionConversation";
import { useBosonRealtime } from "./useBosonRealtime";
import { COMPANION_OPEN, VoiceGlyph, type CompanionOpenDetail } from "./CompanionLauncher";
import type { VoiceTranscriptSink } from "@/lib/voice-transcript";
import styles from "./GlobalCompanion.module.css";

export function GlobalCompanion() {
  return <Suspense fallback={null}><CompanionRoute /></Suspense>;
}
function CompanionRoute() {
  const pathname = usePathname();
  if (!pathname || pathname === "/login" || pathname.startsWith("/api/")) return null;
  return <CompanionSurface />;
}
function CompanionSurface() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [open, setOpen] = useState(false);
  const [engine, setEngine] = useState<"robin" | "boson" | "legacy">("robin");
  const isRealtime = engine === "boson";
  const isRobin = engine === "robin";
  const [transcript, setTranscript] = useState(false);
  const [chinese, setChinese] = useState(false);
  const [ready, setReady] = useState<VoiceReadiness | null>(null);
  const [setupError, setSetupError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [selection, setSelection] = useState("");
  const [quote, setQuote] = useState<{ text: string; page: string } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const transcriptSink = useRef<VoiceTranscriptSink | undefined>(undefined);
  const panel = useRef<HTMLDialogElement>(null);
  const copy = chinese ? companionChinese : companionEnglish;
  const context = companionPageContext(`${pathname}?${search.toString()}`);
  const legacy = useCompanionConversation(() => ({ ...context,
    selection: quote ? `${quote.page}\n${quote.text}`.slice(0, 2000) : "" }));
  const robin = useCompanionConversation(() => context, true);
  const realtime = useBosonRealtime();
  const conversation = isRealtime ? realtime : isRobin ? robin : legacy;
  const { mic, phase, messages, recognizing, inputSpeaking } = conversation;
  const voiceActive = mic.state === "listening" || mic.state === "permission";
  const waiting = phase === "waiting" || phase === "synthesizing";
  const canSend = !!conversation.draft.trim() && !recognizing && !inputSpeaking && !waiting && (!isRobin || !robin.pendingId) && (!isRealtime || realtime.connection === "connected");
  const showTranscript = transcript || phase === "review";
  const status = mic.state === "permission" || mic.state === "error" ? copy.mic[mic.state]
    : isRealtime && realtime.connection === "connecting" ? copy.realtimeConnecting
    : waiting || recognizing || phase === "speaking" || phase === "unconfirmed" || phase === "review" ? copy.phase[phase]
    : mic.muted ? copy.muted : mic.state === "listening" ? copy.listening : copy.mic[mic.state];
  const finish = () => { mic.stop(); setOpen(false); };
  const stopRef = useRef(mic.stop); stopRef.current = mic.stop;
  const beginRef = useRef<((detail: CompanionOpenDetail) => void) | null>(null);
  beginRef.current = detail => {
    if (open) return;
    trigger.current = detail.element;
    transcriptSink.current = detail.createTranscriptSink?.();
    // A click may arrive before the preference-restoring render has committed.
    let selected = engine;
    try { const saved = sessionStorage.getItem("robin:voice:engine-v2"); selected = saved === "legacy" || saved === "boson" ? saved : "robin"; } catch { /* Keep the in-memory choice. */ }
    setEngine(selected); setTranscript(false); setOpen(true);
    if (selected === "boson") realtime.start(transcriptSink.current); else if (selected === "robin") robin.start(transcriptSink.current); else legacy.start();
  };
  const changeEngine = (next: "robin" | "boson" | "legacy") => {
    mic.stop(); setEngine(next); setReady(null); setQuote(null);
    try { sessionStorage.setItem("robin:voice:engine-v2", next); } catch { /* Optional preference only. */ }
    if (next === "boson") realtime.start(transcriptSink.current); else if (next === "robin") robin.start(transcriptSink.current); else legacy.start();
  };
  useEffect(() => {
    try { const saved = sessionStorage.getItem("robin:voice:engine-v2"); if (saved === "legacy" || saved === "boson") setEngine(saved); } catch { /* Default to Robin; old realtime preference is not authority. */ }
    const begin = (event: Event) => {
      const detail = (event as CustomEvent<CompanionOpenDetail>).detail;
      if (detail?.element instanceof HTMLElement) beginRef.current?.(detail);
    };
    window.addEventListener(COMPANION_OPEN, begin);
    return () => window.removeEventListener(COMPANION_OPEN, begin);
  }, []);
  useEffect(() => {
    // The page already owns locale. A second provider would overwrite its preference.
    const changed = () => setChinese(document.documentElement.lang.startsWith("zh"));
    changed(); const observer = new MutationObserver(changed);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const viewport = window.visualViewport;
    const resize = () => {
      root.current?.style.setProperty("--companion-height", `${viewport?.height ?? window.innerHeight}px`);
      root.current?.style.setProperty("--companion-top", `${viewport?.offsetTop ?? 0}px`);
    };
    resize(); viewport?.addEventListener("resize", resize); viewport?.addEventListener("scroll", resize);
    window.addEventListener("resize", resize);
    return () => { viewport?.removeEventListener("resize", resize); viewport?.removeEventListener("scroll", resize); window.removeEventListener("resize", resize); };
  }, []);
  useEffect(() => {
    const dialog = panel.current;
    if (open && dialog && !dialog.open) { dialog.showModal(); dialog.focus({ preventScroll: true }); }
    if (!open && dialog?.open) {
      dialog.close();
      const target = trigger.current?.getClientRects().length && !trigger.current.closest('[inert]') ? trigger.current
        : document.querySelector<HTMLElement>('.robin-mobile-nav-trigger, .chat-input-textarea');
      target?.focus({ preventScroll: true });
    }
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15_000);
    let live = true;
    setSetupError(false); setReady(null);
    void fetch(isRealtime ? "/api/robin/voice/realtime" : "/api/robin/voice", { signal: controller.signal, cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("setup");
      const result = await response.json();
      const body: VoiceReadiness = isRealtime ? { configured: result.configured, ttsConfigured: result.configured, asrModel: "higgs-realtime", ttsModel: "higgs-realtime" } : result;
      if (typeof body.configured !== "boolean" || typeof body.ttsConfigured !== "boolean") throw new Error("setup");
      if (live) {
        setReady(body);
        if (!body.configured || !body.ttsConfigured) stopRef.current();
      }
    }).catch(() => { if (live) { setSetupError(true); stopRef.current(); } }).finally(() => clearTimeout(timer));
    return () => { live = false; clearTimeout(timer); controller.abort(); };
  }, [open, revision, isRealtime]);
  useEffect(() => {
    setSelection("");
    const changed = () => {
      const value = window.getSelection();
      const node = value?.anchorNode;
      const element = node instanceof Element ? node : node?.parentElement;
      const focus = value?.focusNode instanceof Element ? value.focusNode : value?.focusNode?.parentElement;
      if (!element || element.closest("input, textarea, [contenteditable], [data-robin-companion]")
        || focus?.closest("input, textarea, [contenteditable], [data-robin-companion]")) return;
      setSelection((value?.toString() || "").trim().slice(0, 1800));
    };
    document.addEventListener("selectionchange", changed);
    return () => document.removeEventListener("selectionchange", changed);
  }, [pathname, search]);

  return <div ref={root} data-robin-companion>
    <dialog ref={panel} aria-label={copy.title} tabIndex={-1} className={styles.panel}
      onCancel={event => { event.preventDefault(); finish(); }}
      onClose={() => { if (!panel.current?.open) { stopRef.current(); setOpen(false); } }}
      onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finish(); } }}>
      <header className={styles.header}>
        <h2>Robin <span>{isRobin ? chinese ? "语音" : "Voice" : isRealtime ? copy.realtimeLabel : chinese ? "只读" : "Read-only"}</span></h2>
        <button type="button" aria-expanded={showTranscript} onClick={() => setTranscript(value => !value)}>{copy.transcript}</button>
      </header>
      <div className={styles.voice}>
        <div className={styles.glyph} data-active={inputSpeaking || phase === "speaking"} aria-hidden="true"><VoiceGlyph size={48} /></div>
        <p className={styles.status} role="status">{status}</p>
        {conversation.error && <p role="alert" className={styles.error}>{isRealtime
          ? copy.realtimeErrors[conversation.error as keyof typeof copy.realtimeErrors] ?? copy.realtimeErrors.provider
          : isRobin && conversation.error === "reply" ? copy.taskReplyError : copy.error[conversation.error as keyof typeof copy.error] ?? copy.error.reply}</p>}
        {(setupError || (ready && (!ready.configured || !ready.ttsConfigured))) && <p className={styles.error} role="alert">
          {setupError ? copy.setupError : isRealtime ? copy.realtimeNotReady : copy.notReady} <a href="/dashboard/settings#voice">{copy.settings}</a>
        </p>}
        <div className={styles.callControls}>
          {voiceActive ? <button type="button" disabled={mic.state === "permission"} aria-label={mic.muted ? copy.unmute : copy.mute}
            aria-pressed={mic.muted} onClick={mic.toggleMute}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <rect x="9" y="2" width="6" height="13" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />{mic.muted && <path d="m3 3 18 18" />}
            </svg>
          </button> : <button type="button" disabled={!ready?.configured || !ready.ttsConfigured} aria-label={isRealtime ? copy.realtimeRestart : copy.resume}
            onClick={() => { setRevision(value => value + 1); if (isRealtime) realtime.start(transcriptSink.current); else if (isRobin) robin.start(transcriptSink.current); else legacy.start(); }}><VoiceGlyph /></button>}
          <button type="button" className={styles.end} onClick={finish} aria-label={copy.stop}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </div>
        <p className={styles.consent}>{isRobin ? chinese ? "Robin 理解并办事，Boson 只负责播报。" : "Robin understands and acts. Boson only speaks." : isRealtime ? copy.realtimeConsent : copy.consent}</p>
        {isRobin && <>
          <p className={styles.consent}>{chinese ? "明确的待办指令直接执行，可撤销。" : "Clear task instructions act directly, with undo."}</p>
          {robin.lastSpoken && voiceActive && ["speech", "audio", "playback"].includes(robin.error ?? "") && <button type="button" disabled={!!robin.pendingId || waiting || recognizing || inputSpeaking}
            onClick={robin.replay}>{copy.playReply}</button>}
          {robin.pendingId && robin.needsCheck && <div className={styles.receipt} role="status">
            <p>{chinese ? "操作结果待核对。停止语音不会撤销已提交的操作。" : "Awaiting confirmation. Ending voice does not undo submitted actions."}</p>
            <button type="button" onClick={() => void robin.checkResult()}>{chinese ? "核对结果" : "Check result"}</button>{" "}
            <a href="/dashboard">{chinese ? "查看待办" : "View tasks"}</a>
          </div>}
          {robin.receipt && <div className={styles.receipt} role="status" data-task-receipt={robin.receipt.taskId}>
            <p>{(chinese ? { add: "已记录", update: "已修改", complete: "已完成", archive: "已放弃", undo: "已撤销" } : { add: "Saved", update: "Updated", complete: "Completed", archive: "Abandoned", undo: "Undone" })[robin.receipt.action]} · {robin.receipt.title}{robin.receipt.due && !["archive", "undo"].includes(robin.receipt.action) && ` · ${robin.receipt.due}`}</p>
            {robin.receipt.undoable && <button type="button" disabled={!!robin.pendingId || waiting || recognizing || inputSpeaking} onClick={robin.undo}>{chinese ? "撤销" : "Undo"}</button>}
          </div>}
          {robin.linked && <p className={styles.context}>{copy.transcriptLinked}</p>}
          {robin.saveError && <p role="alert" className={styles.error}>{copy.transcriptSaveError}{" "}<button type="button" onClick={() => void robin.retrySave()}>{copy.transcriptRetry}</button></p>}
        </>}
        {isRealtime && <p className={styles.context}>{realtime.linked ? realtime.saving ? copy.transcriptSaving : copy.transcriptLinked : copy.transcriptLocal}</p>}
        {realtime.saveError && <p role="alert" className={styles.error}>{copy.transcriptSaveError}{" "}
          <button type="button" onClick={realtime.retrySave}>{copy.transcriptRetry}</button>
        </p>}
      </div>
      {!isRealtime && !isRobin && <audio ref={legacy.audioRef} controls hidden={!legacy.audioUrl || legacy.error !== "playback"} className={styles.audio}
        aria-label={chinese ? "Robin 语音回复" : "Robin spoken reply"} onPlaying={legacy.onPlaying} onPause={legacy.onPaused} onEnded={legacy.onPaused} onError={legacy.onPlaybackError} />}
      <div className={styles.transcript} hidden={!showTranscript}>
        <label className={styles.context}>{copy.engine}
          <select value={engine} disabled={!!robin.pendingId} onChange={event => changeEngine(event.target.value as "robin" | "boson" | "legacy")}>
            <option value="robin">{chinese ? "Robin · 待办交互 / Boson 播报" : "Robin · task actions / Boson speech"}</option>
            <option value="boson">{copy.realtimeOption}</option><option value="legacy">{copy.legacyOption}</option>
          </select>
        </label>
        {isRealtime ? <p className={styles.context}>{copy.realtimeScope}{realtime.latencyMs !== null && ` · ${copy.realtimeLatency}: ${(realtime.latencyMs / 1000).toFixed(2)}s`}</p>
          : isRobin ? <p className={styles.context}>{chinese ? "与 Robin 文字助手共享对话；待办日期不等于定时提醒。" : "Shares Robin’s typed conversation. A task date is not a timed notification."}</p>
          : <p className={styles.context}>{copy.page}: <code>{context.page}{context.reference && ` · ${context.reference}`}</code></p>}
        <div className={styles.messages} aria-live="polite" aria-relevant="additions text">
          {messages.filter(message => message.text).map((message, index) => <p key={index} data-role={message.role} className={message.role === "user" ? styles.user : styles.assistant}>{message.text}</p>)}
        </div>
        {conversation.sessionId && <a href={`/?session=${encodeURIComponent(conversation.sessionId)}`} target="_blank" rel="noopener noreferrer">{copy.trace}</a>}
        {!isRealtime && !isRobin && quote && <blockquote><p>{quote.text}</p><button type="button" onClick={() => setQuote(null)}>{copy.unquote}</button></blockquote>}
        {!isRealtime && !isRobin && !!selection && <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => { setQuote({ text: selection, page: `${context.page} ${context.reference}`.trim() }); setSelection(""); }}>{copy.quote}</button>}
        <label className={styles.composer}>
          <span className="sr-only">{copy.input}</span>
          <textarea value={conversation.draft} maxLength={4000} rows={2} placeholder={copy.input}
            onChange={event => conversation.setDraft(event.target.value)} onKeyDown={event => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && canSend) { event.preventDefault(); conversation.send(); }
            }} />
        </label>
        <div className={styles.actions}>
          <button type="button" disabled={!canSend} onClick={conversation.send}>{copy.send}</button>
          {!isRealtime && inputSpeaking && <button type="button" onClick={mic.finish}>{copy.finish}</button>}
          {(waiting || phase === "speaking" || conversation.audioUrl) && <button type="button" onClick={conversation.stopOutput}>{copy.interrupt}</button>}
        </div>
        <details className={styles.help}>
          <summary>{chinese ? "使用与隐私" : "Use & privacy"}</summary>
          <p>{copy.limits}</p><p>{isRobin ? chinese ? "音频由本机 Whisper 识别；文字发送给 Robin 主模型；回复文字发送给 Boson 合成语音并消耗额度。任务操作和回执保存在服务器，不因清除此处记录而删除。只在前台工作。" : "Local Whisper transcribes audio; text goes to Robin’s main model, then reply text to Boson for paid speech synthesis. Task actions and receipts persist on the server; clearing this panel does not delete them. Foreground only." : isRealtime ? copy.realtimePrivacy : copy.memory}</p>{!isRealtime && !isRobin && <p>{copy.quoteHint}</p>}
          <button type="button" onClick={() => setRevision(value => value + 1)}>{copy.recheck}</button>
          <button type="button" onClick={() => { conversation.clear(); setQuote(null); }}>{copy.clear}</button>
          <p><a href="/dashboard/settings#voice">{copy.settings}</a></p>
        </details>
      </div>
    </dialog>
  </div>;
}
