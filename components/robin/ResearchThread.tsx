"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { MarkdownBody } from "@/components/MarkdownBody";
import { useI18n } from "@/hooks/useI18n";
import type { ResearchMessage } from "@/extension/robin/research-domain";
import type { ResearchCapture } from "@/extension/robin/research-capture-domain";
import { useResearchQuestion, type ResearchThread as Thread } from "./useResearchThread";
import { ResearchPdfUpload, type ResearchPdfUploadHandler } from "./ResearchPdfUpload";
import s from "./ResearchWorkspace.module.css";

/** Enter sends on a keyboard; Shift+Enter, IME composition and touch keyboards write a new line. */
export function submitsOnEnter(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
  if (event.key !== "Enter" || event.nativeEvent.isComposing) return false;
  if (event.metaKey || event.ctrlKey) return true;
  return !event.shiftKey && !window.matchMedia("(pointer: coarse)").matches;
}
export function RunStatus({ thread, projectName }: { thread: Thread; projectName: (id: string) => string }) {
  const { t } = useI18n();
  const run = thread.state.run;
  if (thread.elsewhere && run) return <div role="status" className={s.runStatus}><span className={s.runDot} /><div>{t("rw.sessions.runningElsewhere", { project: projectName(run.projectId) })}</div>
    <button className={s.button} disabled={run.cancelled} onClick={() => void thread.stop()}>{t("rw.stop")}</button></div>;
  if (!thread.busy) return null;
  return <div role="status" className={s.runStatus}><span className={s.runDot} aria-hidden="true" /><div><strong>{t(`rw.phase.${run?.cancelled ? "stopping" : run?.phase ?? "starting"}`)}</strong>{run?.detail && <span className={s.progressDetail}>{run.detail}</span>}
    <span className={s.progressDetail}>{t(run?.cancelled ? "rw.chat.stoppingHint" : run ? "rw.chat.runHint" : "rw.chat.sendingHint")}</span></div>
    <button className={s.button} disabled={run?.cancelled} onClick={() => void thread.stop()}>{t("rw.stop")}</button></div>;
}
export function ThreadMessage({ message, paperTitle, onOpenPaper, onNavigate, onKeep, keepState, busyKeep, capture }: {
  message: ResearchMessage; paperTitle?: string; onOpenPaper?: (id: string) => void; onNavigate: (href: string) => void;
  onKeep?: (message: ResearchMessage) => void; keepState?: "idle" | "saving" | "kept" | "partial"; busyKeep?: boolean; capture?: ResearchCapture;
}) {
  const { t } = useI18n();
  const uploadRequest = message.role === "user" && !!message.paperId && !!paperTitle &&
    ["rw.home.readUploaded", "rw.paper.readUploadedNamed", "rw.paper.readUploaded"].some((key) => message.text === t(key, { title: paperTitle }));
  return <article className={s.message} data-role={message.role}>
    <header className={s.messageHead}>
      <span className={s.speaker}>{t(message.role === "user" ? "rw.you" : "rw.chat.assistant")}</span>
      {message.paperId && paperTitle && (onOpenPaper
        ? <button type="button" className={s.paperRef} onClick={() => onOpenPaper(message.paperId!)} title={paperTitle}>{t("rw.about")} · {paperTitle}</button>
        : <span className={s.paperRef}>{paperTitle}</span>)}
    </header>
    {uploadRequest ? <>
      <p className={s.prose}>{t("rw.chat.uploadRequest")}</p>
      <details className={s.requestDetails}><summary>{t("rw.chat.instructions")}</summary><MarkdownBody>{message.text}</MarkdownBody></details>
    </> : <div className={s.prose}><MarkdownBody onNavigateLink={onNavigate}>{message.text}</MarkdownBody></div>}
    {message.role === "assistant" && onKeep && <div className={s.messageActions}>
      <button className={s.textButton} disabled={keepState === "kept" || keepState === "saving" || busyKeep} onClick={() => onKeep(message)}>{t(keepState === "kept" ? "rw.capture.saved" : keepState === "saving" ? "rw.saving" : keepState === "partial" ? "rw.capture.retry" : "rw.keep")}</button>
      {capture?.archive && <a className={s.textButton} href={capture.archive.url} title={`${capture.archive.vaultPath}/${capture.archive.relativePath}`}>{t("papers.openArchive")}</a>}
    </div>}
    {capture?.error && <p role="alert" className={s.error}>{capture.notebookSaved ? `${t("rw.capture.partial")} ` : ""}{capture.error}</p>}
  </article>;
}

/** Starters that send at once: complete requests the project's brief and focus make specific. */
const STARTERS = { project: ["findForFocus", "stateOfArt", "challenge"], home: [] } as const;
/** Starters that only fill the composer: they need the researcher's link or topic before sending. */
const FILL = { project: ["readLink"], home: ["summarize", "whatsNew", "explain"] } as const;
export function ResearchThread({ thread, projectId, projectName, projectNames, focus = "", paperTitles, onOpenPaper, onNavigate, onKeep, captures = [], onEditFocus, onUpload, variant = "project" }: {
  thread: Thread; projectId: string; projectName: string; projectNames?: Map<string, string>; focus?: string; paperTitles: Map<string, string>;
  onOpenPaper: (id: string) => void; onNavigate: (href: string) => void; onKeep?: (message: ResearchMessage) => Promise<void>;
  captures?: ResearchCapture[]; onEditFocus?: () => void; onUpload?: ResearchPdfUploadHandler; variant?: "home" | "project";
}) {
  const { t } = useI18n();
  const session = thread.state.conversation;
  const storageKey = `pi-research-question:${projectId}${session && (!session.default || session.paperId) ? `:${session.id}` : ""}`;
  const { question, setQuestion, clearSubmitted, draftReady } = useResearchQuestion(storageKey);
  const [keeping, setKeeping] = useState("");
  const [keepError, setKeepError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [showLatest, setShowLatest] = useState(false);
  const currentScope = useRef(storageKey); currentScope.current = storageKey;
  const transcript = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const follow = useRef(true);
  const messages = thread.state.messages;
  const lastQuestion = messages.at(-1)?.role === "user" ? messages.at(-1)!.text : "";
  useEffect(() => { follow.current = true; setShowLatest(false); setKeepError(""); setKeeping(""); }, [storageKey]);
  useEffect(() => {
    const node = transcript.current;
    if (follow.current && node) node.scrollTop = node.scrollHeight;
    else if (node) setShowLatest(true);
  }, [storageKey, messages.length, thread.pending]);
  const disabled = !thread.ready || thread.busy || thread.elsewhere || uploading || !!session?.archived;
  async function ask(text: string) {
    if (disabled || !text.trim()) return;
    follow.current = true;
    const replacesDraft = !question.trim() || question === text;
    if (await thread.send(text) && replacesDraft) clearSubmitted();
  }
  async function keep(message: ResearchMessage) {
    if (keeping || !onKeep) return;
    setKeeping(message.id); setKeepError("");
    try { await onKeep(message); }
    catch (error) { if (currentScope.current === storageKey) setKeepError(error instanceof Error ? error.message : t("rw.error")); }
    finally { if (currentScope.current === storageKey) setKeeping(""); }
  }
  const empty = !messages.length && !thread.pending;
  const paperTitle = session?.paperId ? paperTitles.get(session.paperId) : undefined;
  const answered = messages.at(-1)?.role === "assistant" && !thread.busy && !thread.elsewhere && !thread.error && !thread.state.stopped;
  function latest() {
    follow.current = true; setShowLatest(false);
    const node = transcript.current; if (node) node.scrollTop = node.scrollHeight;
  }
  const starterPrompts = [...FILL[variant]].map((key) => t(`rw.starter.${key}.prompt`));
  /** Put a starter's prompt in the composer, keeping anything already typed after it, caret at the end. */
  function fill(prompt: string) {
    const typed = starterPrompts.reduce((text, known) => text.startsWith(known) ? text.slice(known.length) : text, question).trim();
    setQuestion(prompt + typed);
    requestAnimationFrame(() => { const node = composer.current; if (node) { node.focus(); node.setSelectionRange(node.value.length, node.value.length); } });
  }
  return <section className={s.thread} aria-label={t("rw.discussion")}>
    {empty ? <div className={s.welcome}>
      <h2>{t(paperTitle ? "rw.chat.paperWelcome" : "rw.welcomeTitle")}</h2>
      <p>{t(paperTitle ? "rw.chat.paperWelcomeHint" : "rw.chat.welcomeHint")}</p>
      {!paperTitle && <ol className={s.chatSteps}>{["source", "explain", "followup"].map((step, index) => <li key={step}><span aria-hidden="true">{index + 1}</span>{t(`rw.chat.step.${step}`)}</li>)}</ol>}
      {variant === "project" && !focus.trim() && onEditFocus && <button className={s.textButton} onClick={onEditFocus}>{t("rw.setFocus")} →</button>}
    </div> : <div className={s.transcript} ref={transcript} tabIndex={0} role="region" aria-label={t("rw.chat.messages")} onScroll={() => {
      const node = transcript.current; if (node) {
        follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
        if (follow.current) setShowLatest(false);
      }
    }}>
      {messages.map((message) => {
        const capture = captures.find((item) => item.messageId === message.id);
        return <ThreadMessage key={message.id} message={message} paperTitle={message.paperId ? paperTitles.get(message.paperId) : undefined}
          onOpenPaper={onOpenPaper} onNavigate={onNavigate} onKeep={onKeep ? keep : undefined} capture={capture}
          keepState={keeping === message.id ? "saving" : capture?.archive ? "kept" : capture?.notebookSaved ? "partial" : "idle"} busyKeep={!!keeping} />;
      })}
      {thread.pending && messages.at(-1)?.text !== thread.pending.text && <ThreadMessage message={{ id: "pending", role: "user", text: thread.pending.text, at: "", paperId: thread.pending.paperId }}
        paperTitle={thread.pending.paperId ? paperTitles.get(thread.pending.paperId) : undefined} onNavigate={onNavigate} />}
    </div>}
    {showLatest && <button type="button" className={`${s.button} ${s.latestReply}`} onClick={latest}>{t("rw.chat.latest")} ↓</button>}
    <RunStatus thread={thread} projectName={(id) => projectNames?.get(id) ?? (id === projectId ? projectName : id)} />
    {thread.state.stopped && !thread.busy && <p role="status" className={s.notice}>{t("rw.stopped")}
      {lastQuestion && !question.trim() && <button type="button" className={s.textButton} onClick={() => setQuestion(lastQuestion)}> {t("rw.editAndRetry")} →</button>}</p>}
    {(thread.error || keepError) && <p role="alert" className={s.error}>{keepError || thread.error}</p>}
    {answered && <div className={s.followUp}>
      <span role="status">{t("rw.chat.next")}</span>
      {session?.paperId && <div className={s.quick}>{["simple", "method", "weakness"].map((key) => <button key={key} type="button" disabled={disabled} title={t(`rw.quick.${key}`)} onClick={() => void ask(t(`rw.quick.${key}.prompt`, { project: projectName }))}>{t(`rw.chat.quick.${key}`)}</button>)}</div>}
    </div>}
    <form className={s.composer} aria-label={t("rw.chat.composer")} onSubmit={(event) => { event.preventDefault(); void ask(question); }}>
      <div className={s.composerContext}>
        <label htmlFor="research-question">{t("rw.askLabel")}</label>
        {session?.paperId && <button type="button" className={s.paperRef} onClick={() => onOpenPaper(session.paperId!)}>{paperTitle ?? t("rw.sessions.openPaper")} ↗</button>}
      </div>
      <textarea id="research-question" ref={composer} className={s.question} value={question} maxLength={10_000} rows={empty ? 3 : 2}
        disabled={!draftReady || !thread.ready || !!session?.archived} placeholder={t(variant === "home" ? "rw.home.placeholder" : "rw.placeholder")} onChange={(event) => setQuestion(event.target.value)}
        onKeyDown={(event) => { if (submitsOnEnter(event)) { event.preventDefault(); void ask(question); } }} />
      <div className={s.composerFooter}>
        {onUpload && <ResearchPdfUpload onUpload={onUpload} onOpen={onOpenPaper} onBusyChange={setUploading} />}
        <button className={`${s.button} ${s.primary}`} disabled={disabled || !question.trim()}>{t("rw.send")}</button>
      </div>
      <p className={s.composerHint}>{t(uploading ? "rw.chat.uploadWait" : "rw.chat.uploadHelp")} <span>{t("rw.composerHint")}</span></p>
    </form>
    {/* Starters stay reachable after the first question: full cards on an empty thread, a chip row after. */}
    {!session?.paperId && <div className={empty ? s.starters : s.starterChips} data-variant={variant}>
      {FILL[variant].map((key) => <button type="button" key={key} className={empty ? s.starter : undefined} disabled={disabled} onClick={() => fill(t(`rw.starter.${key}.prompt`))}>
        <strong>{t(`rw.starter.${key}`)}</strong>{empty && <span>{t(`rw.starter.${key}.hint`)}</span>}
      </button>)}
      {STARTERS[variant].map((key) => <button type="button" key={key} className={empty ? s.starter : undefined} disabled={disabled} onClick={() => void ask(t(`rw.starter.${key}.prompt`))}>
        <strong>{t(`rw.starter.${key}`)}</strong>{empty && <span>{t(`rw.starter.${key}.hint`)}</span>}
      </button>)}
    </div>}
  </section>;
}
