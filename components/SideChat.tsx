"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAgentSession } from "@/hooks/useAgentSession";
import { selectStreamingMessage, useStreamingSelector } from "@/hooks/useStreamingSelector";
import { useI18n } from "@/hooks/useI18n";
import { sideChatPrompt, sideChatQuestion, sideChatQuestionText, sideChatVisibleMessage, type SideChatTab } from "@/lib/side-chat";
import { sendAgentCommand } from "@/lib/agent-client";
import type { SessionInfo } from "@/lib/types";
import { ChatInput, type ChatInputHandle } from "./ChatInput";
import { MessageView } from "./MessageView";
import styles from "./SideChat.module.css";

export function SideChat({ tab, active, onClose }: { tab: SideChatTab; active: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const prompt = useMemo(() => sideChatPrompt(tab.context, tab.language), [tab]);
  const [savedSession, setSavedSession] = useState<SessionInfo | null>(null);
  const [seedFailed, setSeedFailed] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const inputRef = useRef<ChatInputHandle | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const startedRef = useRef(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const followRef = useRef(true);
  const pagingRef = useRef(false);
  const prependHeightRef = useRef<number | null>(null);
  const [paging, setPaging] = useState(false);
  const created = useCallback((session: SessionInfo) => {
    setSavedSession(session);
    // This names only the new session. No parent notification or source write.
    void sendAgentCommand(session.id, { type: "set_session_name", name: tab.label })
      .catch((error: unknown) => setNameError(error instanceof Error ? error.message : String(error)));
  }, [tab.label]);
  const agent = useAgentSession({
    session: savedSession,
    newSessionCwd: tab.cwd,
    newSessionDraftKey: tab.id,
    initialToolPreset: "none",
    sideChat: true,
    initialNewSessionChoices: { model: tab.model, thinkingLevel: null },
    onSessionCreated: created,
    chatInputRef: inputRef,
    deferInitialScroll: true,
  });
  const streaming = useStreamingSelector(agent.streamingStore, selectStreamingMessage);
  const busy = agent.agentRunning || agent.isCompacting;
  const send = agent.handleSend;

  // Strict Mode, tab switches and panel visibility must not repeat the first turn.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void send(prompt);
  }, [prompt, send]);

  // Rejected sends keep the question, not the internal context envelope, in the composer.
  const attachInput = useCallback((input: ChatInputHandle | null) => {
    inputRef.current = input ? {
      ...input,
      restoreSubmission(text, images, key) {
        if (text === prompt) setSeedFailed(true);
        else input.restoreSubmission(sideChatQuestionText(text), images, key);
      },
    } : null;
  }, [prompt]);

  useLayoutEffect(() => {
    if (active) headingRef.current?.focus({ preventScroll: true });
  }, [active]);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!active || !list) return;
    if (prependHeightRef.current !== null) {
      list.scrollTop += list.scrollHeight - prependHeightRef.current;
      prependHeightRef.current = null;
    } else if (followRef.current) list.scrollTop = list.scrollHeight;
  }, [active, agent.messages, streaming]);

  return (
    <section
      className={styles.panel}
      aria-label={t("sideChat.title")}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
        // Never let Escape in the side conversation stop the main agent.
        event.stopPropagation();
        if (event.defaultPrevented) return; // The composer already handled Stop or a menu.
        event.preventDefault();
        if (busy) void agent.handleAbort();
        else onClose();
      }}
    >
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h2 ref={headingRef} tabIndex={-1}>{t("sideChat.title")}</h2>
          {busy && <button type="button" className="ui-action ui-action--outline" onClick={() => void agent.handleAbort()}>{t("sideChat.stop")}</button>}
          <button type="button" className="ui-action ui-action--outline" onClick={onClose}>{t("sideChat.back")}</button>
        </div>
        <p className={styles.hint}>{t("sideChat.isolated")}</p>
        <blockquote className={styles.selection}>{tab.context.selection}</blockquote>
        <details className={styles.background}>
          <summary>{t("sideChat.background")}</summary>
          <div>
            <strong>{t("sideChat.question")}</strong>
            <p>{tab.context.question ?? t("sideChat.questionMissing")}</p>
            <strong>{t("sideChat.answer")}</strong>
            <p>{tab.context.answer}</p>
          </div>
        </details>
      </header>
      <div
        ref={listRef}
        className={styles.messages}
        onScroll={(event) => {
          const el = event.currentTarget;
          followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
      >
        {agent.hasEarlierMessages && <button type="button" className="ui-action" disabled={paging} onClick={async () => {
          const id = agent.sessionIdRef.current;
          if (!id || !agent.historyCursor || pagingRef.current) return;
          pagingRef.current = true;
          setPaging(true);
          followRef.current = false;
          prependHeightRef.current = listRef.current?.scrollHeight ?? null;
          try { await agent.loadContext(id, agent.activeLeafId, agent.historyCursor); }
          finally { pagingRef.current = false; setPaging(false); }
        }}>{t("chat.loadEarlier")}</button>}
        {agent.messages.map((message, index) => {
          const shown = sideChatVisibleMessage(message, prompt);
          if (!shown) return null;
          return <MessageView key={agent.messageKeys[index]} message={shown} sessionId={agent.sessionIdRef.current ?? undefined} entryId={agent.entryIds[index]} modelNames={agent.modelNames} />;
        })}
        {streaming && <MessageView message={streaming} isStreaming modelNames={agent.modelNames} />}
        {busy && !streaming && <p role="status" className={styles.hint}>{t("sideChat.thinking")}</p>}
        {agent.error && <p role="alert">{agent.error}</p>}
        {nameError && <p role="alert">{t("sideChat.nameFailed")} {nameError}</p>}
        {agent.notices.map((notice) => <p key={notice.id} role={notice.type === "error" ? "alert" : "status"}>{notice.message}</p>)}
        {seedFailed && !busy && <button type="button" className="ui-action ui-action--outline" onClick={() => {
          setSeedFailed(false);
          followRef.current = true;
          void send(prompt);
        }}>{t("sideChat.retry")}</button>}
      </div>
      <footer className={styles.composer}>
        <fieldset disabled={seedFailed} className={styles.input}>
        <ChatInput
          ref={attachInput}
          compact
          commandHints={false}
          draftKey={savedSession?.id ?? tab.id}
          isStreaming={busy}
          onAbort={() => void agent.handleAbort()}
          onSend={(text) => { followRef.current = true; void send(sideChatQuestion(text)); }}
        />
        </fieldset>
        <p className={styles.hint}>{savedSession
          ? <a href={`?session=${encodeURIComponent(savedSession.id)}`} target="_blank" rel="noopener noreferrer">{t("sideChat.saved")}</a>
          : t("sideChat.chatOnly")}</p>
      </footer>
    </section>
  );
}
