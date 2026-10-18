"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { MarkdownBody } from "@/components/MarkdownBody";
import { useI18n } from "@/hooks/useI18n";
import type { ResearchMessage } from "@/extension/robin/research-domain";
import type { ResearchThread as Thread } from "./useResearchThread";
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
  if (thread.elsewhere && run) return <div role="status" className={s.runStatus}><span className={s.runDot} /><div>{t("rw.runningElsewhere", { project: projectName(run.projectId) })}</div>
    <button className={s.button} disabled={run.cancelled} onClick={() => void thread.stop()}>{t("rw.stop")}</button></div>;
  if (!thread.busy) return null;
  return <div role="status" className={s.runStatus}><span className={s.runDot} /><div>{t(`rw.phase.${run?.cancelled ? "stopping" : run?.phase ?? "starting"}`)}{run?.detail && <span className={s.progressDetail}>{run.detail}</span>}</div>
    <button className={s.button} disabled={run?.cancelled} onClick={() => void thread.stop()}>{t("rw.stop")}</button></div>;
}
export function ThreadMessage({ message, paperTitle, onOpenPaper, onNavigate, onKeep, keepState, busyKeep }: {
  message: ResearchMessage; paperTitle?: string; onOpenPaper?: (id: string) => void; onNavigate: (href: string) => void;
  onKeep?: (message: ResearchMessage) => void; keepState?: "idle" | "saving" | "kept"; busyKeep?: boolean;
}) {
  const { t } = useI18n();
  return <article className={s.message} data-role={message.role}>
    {(message.role === "user" || paperTitle) && <header className={s.messageHead}>
      {message.role === "user" && <span>{t("rw.you")}</span>}
      {message.paperId && paperTitle && <button type="button" className={s.paperRef} onClick={() => onOpenPaper?.(message.paperId!)} title={paperTitle}>{t("rw.about")} · {paperTitle}</button>}
    </header>}
    <div className={s.prose}><MarkdownBody onNavigateLink={onNavigate}>{message.text}</MarkdownBody></div>
    {message.role === "assistant" && onKeep && <div className={s.messageActions}>
      <button className={s.textButton} disabled={keepState !== "idle" || busyKeep} onClick={() => onKeep(message)}>{t(keepState === "kept" ? "rw.kept" : keepState === "saving" ? "rw.saving" : "rw.keep")}</button>
    </div>}
  </article>;
}

/** Starters that send at once: complete requests the project's brief and focus make specific. */
const STARTERS = { project: ["findForFocus", "stateOfArt", "challenge"], home: [] } as const;
/** Starters that only fill the composer: they need the researcher's link or topic before sending. */
const FILL = { project: ["readLink"], home: ["summarize", "whatsNew", "explain"] } as const;
export function ResearchThread({ thread, projectId, projectName, focus = "", paperTitles, onOpenPaper, onNavigate, onKeep, onEditFocus, variant = "project" }: {
  thread: Thread; projectId: string; projectName: string; focus?: string; paperTitles: Map<string, string>;
  onOpenPaper: (id: string) => void; onNavigate: (href: string) => void; onKeep?: (message: ResearchMessage) => Promise<void>;
  onEditFocus?: () => void; variant?: "home" | "project";
}) {
  const { t } = useI18n();
  const storageKey = `pi-research-question:${projectId}`;
  const [question, setQuestion] = useState("");
  const [draftReady, setDraftReady] = useState(false);
  const [keeping, setKeeping] = useState("");
  const [kept, setKept] = useState<string[]>([]);
  const [keepError, setKeepError] = useState("");
  const transcript = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    try { setQuestion(localStorage.getItem(storageKey)?.slice(0, 10_000) ?? ""); } catch { /* Drafts are a convenience. */ }
    setDraftReady(true);
  }, [storageKey]);
  useEffect(() => { if (draftReady) { try { localStorage.setItem(storageKey, question); } catch { /* Optional. */ } } }, [draftReady, question, storageKey]);
  const messages = thread.state.messages;
  const lastQuestion = messages.at(-1)?.role === "user" ? messages.at(-1)!.text : "";
  useEffect(() => {
    const node = transcript.current;
    if (follow.current && node) node.scrollTop = node.scrollHeight;
  }, [messages.length, thread.pending]);
  const disabled = !thread.ready || thread.busy || thread.elsewhere;
  async function ask(text: string) {
    if (disabled || !text.trim()) return;
    follow.current = true;
    const replacesDraft = !question.trim() || question === text;
    if (await thread.send(text) && replacesDraft) setQuestion("");
  }
  async function keep(message: ResearchMessage) {
    if (keeping || !onKeep) return;
    setKeeping(message.id); setKeepError("");
    try { await onKeep(message); setKept((ids) => [...ids, message.id]); }
    catch (error) { setKeepError(error instanceof Error ? error.message : t("rw.error")); }
    finally { setKeeping(""); }
  }
  const empty = !messages.length && !thread.pending;
  const starterPrompts = [...FILL[variant]].map((key) => t(`rw.starter.${key}.prompt`));
  /** Put a starter's prompt in the composer, keeping anything already typed after it, caret at the end. */
  function fill(prompt: string) {
    const typed = starterPrompts.reduce((text, known) => text.startsWith(known) ? text.slice(known.length) : text, question).trim();
    setQuestion(prompt + typed);
    requestAnimationFrame(() => { const node = composer.current; if (node) { node.focus(); node.setSelectionRange(node.value.length, node.value.length); } });
  }
  return <section className={s.thread} aria-label={t("rw.discussion")}>
    {empty ? variant === "home" ? null : <div className={s.welcome}>
      <h2>{t("rw.welcomeTitle")}</h2>
      <p>{t(focus.trim() ? "rw.welcomeWithFocus" : "rw.welcomeNoFocus")}</p>
      {!focus.trim() && onEditFocus && <button className={s.textButton} onClick={onEditFocus}>{t("rw.setFocus")} →</button>}
    </div> : <div className={s.transcript} ref={transcript} onScroll={() => {
      const node = transcript.current; if (node) follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
    }}>
      {messages.map((message) => <ThreadMessage key={message.id} message={message} paperTitle={message.paperId ? paperTitles.get(message.paperId) : undefined}
        onOpenPaper={onOpenPaper} onNavigate={onNavigate} onKeep={onKeep ? keep : undefined} keepState={kept.includes(message.id) ? "kept" : keeping === message.id ? "saving" : "idle"} busyKeep={!!keeping} />)}
      {thread.pending && messages.at(-1)?.text !== thread.pending.text && <ThreadMessage message={{ id: "pending", role: "user", text: thread.pending.text, at: "", paperId: thread.pending.paperId }}
        paperTitle={thread.pending.paperId ? paperTitles.get(thread.pending.paperId) : undefined} onNavigate={onNavigate} />}
    </div>}
    <RunStatus thread={thread} projectName={() => projectName} />
    {thread.state.stopped && !thread.busy && <p role="status" className={s.notice}>{t("rw.stopped")}
      {lastQuestion && !question.trim() && <button type="button" className={s.textButton} onClick={() => setQuestion(lastQuestion)}> {t("rw.editAndRetry")} →</button>}</p>}
    {(thread.error || keepError) && <p role="alert" className={s.error}>{keepError || thread.error}</p>}
    <form className={s.composer} onSubmit={(event) => { event.preventDefault(); void ask(question); }}>
      <label className="sr-only" htmlFor="research-question">{t("rw.askLabel")}</label>
      <textarea id="research-question" ref={composer} className={s.question} value={question} maxLength={10_000} rows={empty ? 3 : 2}
        disabled={!draftReady} placeholder={t(variant === "home" ? "rw.home.placeholder" : "rw.placeholder")} onChange={(event) => setQuestion(event.target.value)}
        onKeyDown={(event) => { if (submitsOnEnter(event)) { event.preventDefault(); void ask(question); } }} />
      <div className={s.composerFooter}>
        <span>{t("rw.composerHint")}</span>
        <button className={`${s.button} ${s.primary}`} disabled={disabled || !question.trim()}>{t("rw.send")}</button>
      </div>
    </form>
    {/* Starters stay reachable after the first question: full cards on an empty thread, a chip row after. */}
    <div className={empty ? s.starters : s.starterChips} data-variant={variant}>
      {FILL[variant].map((key) => <button type="button" key={key} className={empty ? s.starter : undefined} disabled={disabled} onClick={() => fill(t(`rw.starter.${key}.prompt`))}>
        <strong>{t(`rw.starter.${key}`)}</strong>{empty && <span>{t(`rw.starter.${key}.hint`)}</span>}
      </button>)}
      {STARTERS[variant].map((key) => <button type="button" key={key} className={empty ? s.starter : undefined} disabled={disabled} onClick={() => void ask(t(`rw.starter.${key}.prompt`))}>
        <strong>{t(`rw.starter.${key}`)}</strong>{empty && <span>{t(`rw.starter.${key}.hint`)}</span>}
      </button>)}
    </div>
  </section>;
}
