"use client";

import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from "react";
import { MarkdownBody } from "@/components/MarkdownBody";
import { useI18n } from "@/hooks/useI18n";
import {
  MAX_AGENT_DOCUMENTS,
  MAX_AGENT_IMAGES,
  isAttachableFile,
  readAgentAttachment,
  type AgentAttachment,
} from "./agent-attachments";
import { requestRefresh } from "./refreshBus";

interface Turn {
  /** "reset" marks where the server started a new session under the panel. */
  role: "you" | "agent" | "reset";
  text: string;
  tools?: string[];
  /** Names of what was attached — never the data, which would overrun localStorage. */
  attachments?: string[];
}

/** What the model is told when files arrive with no words. */
const ATTACHMENT_ONLY_MESSAGE = "Please look at the attached files.";

const imageCount = (items: AgentAttachment[]) => items.reduce((total, item) => total + item.images.length, 0);

/** Matches ChatInput: some IMEs end composition just before the Enter lands. */
const COMPOSITION_END_ENTER_GRACE_MS = 100;

interface Props {
  /** Which assistant mode this panel talks to — its persona, tools, and session. */
  mode: string;
  /** i18n keys for the chrome, so the personas read as different people. */
  titleKey: string;
  placeholderKey: string;
  restartHintKey: string;
  /** Tool name → i18n key, for the line under a reply saying what it touched. */
  toolKeys: Record<string, string>;
  emptyHintKey?: string;
  /** Product agents use their own scoped-session route but keep this panel's UX. */
  endpoint?: string;
  requestBody?: Record<string, string>;
  /**
   * A message the page wants sent on the user's behalf — a research brief
   * assembled from a record, rather than something they typed.
   *
   * Keyed rather than a bare string: the same brief may be asked for twice,
   * and the id is what tells a repeat from a re-render.
   */
  pending?: { id: string; text: string };
  /** A per-reply action the page offers, e.g. keeping a mentor answer in your notes. */
  replyAction?: { labelKey: string; onReply: (text: string) => void };
  onClose?: () => void;
  /** Preserve the transcript/draft but do not dispatch against unconfirmed workspace context. */
  disabled?: boolean;
  /** Optional controls below the composer, such as a mode-specific model selector. */
  footer?: ReactNode;
  /** Keeps each data-driven conversation's visible transcript separate in this browser. */
  transcriptKey?: string;
  /** Compact workspaces may collapse the panel to its composer. */
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Hears whether the visible transcript has any turns, including a restored one. */
  onConversationChange?: (hasTurns: boolean) => void;
  /** Let the user attach images and PDFs; only for endpoints that accept `images` and `documents`. */
  attachments?: boolean;
}

/**
 * The agent panel, next to whatever the workspace has open.
 *
 * One component for both personas because everything here is the same problem
 * twice: an IME that must not have its composition torn down, a transcript
 * that scrolls, a restart that has to fail loudly. What differs is the mode it
 * posts to and the words on the chrome, and those are props. Forking the file
 * would mean maintaining the composition handling in two places, which is
 * exactly the kind of subtlety that gets fixed in one copy only.
 *
 * The transcript is client-side only: the conversation itself lives in a pi
 * session on the server and survives a reload, but re-rendering it in a side
 * panel would bury the exchange the user is actually in. Reloading the page
 * therefore gives a clean panel and an agent that still remembers.
 *
 * The server starts a new session after 30 idle minutes or a date change. The
 * panel cannot see that coming, so it watches the session id each reply
 * carries and draws a line where it changed: the turns above it are still on
 * screen but no longer in the agent's memory, and a follow-up that leans on
 * them would otherwise get an answer with no context and no explanation.
 */
export function AgentPanel({
  mode,
  titleKey,
  placeholderKey,
  restartHintKey,
  toolKeys,
  emptyHintKey,
  endpoint = "/api/robin/assistant",
  requestBody = {},
  pending,
  replyAction,
  onClose,
  disabled = false,
  footer,
  transcriptKey,
  collapsed = false,
  onCollapsedChange,
  onConversationChange,
  attachments = false,
}: Props) {
  const { t } = useI18n();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attached, setAttached] = useState<AgentAttachment[]>([]);
  const [attaching, setAttaching] = useState(0);
  const [attachNotice, setAttachNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const attachedRef = useRef<AgentAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);
  const lastCompositionEndAtRef = useRef(0);
  const dispatchedRef = useRef<string | null>(null);
  const sessionRef = useRef<string | null>(null);
  const activeTranscriptKeyRef = useRef<string | undefined>(undefined);
  const loadingTranscriptRef = useRef(false);

  useEffect(() => {
    if (activeTranscriptKeyRef.current === transcriptKey) return;
    activeTranscriptKeyRef.current = transcriptKey;
    loadingTranscriptRef.current = true;
    try {
      const raw = transcriptKey ? window.localStorage.getItem(`pi-robin-agent-transcript:${transcriptKey}`) : null;
      setTurns(raw ? JSON.parse(raw) as Turn[] : []);
    } catch {
      setTurns([]);
    }
    setMessage("");
    sessionRef.current = null;
  }, [transcriptKey]);

  useEffect(() => {
    if (!activeTranscriptKeyRef.current) return;
    if (loadingTranscriptRef.current) {
      loadingTranscriptRef.current = false;
      return;
    }
    try {
      window.localStorage.setItem(`pi-robin-agent-transcript:${activeTranscriptKeyRef.current}`, JSON.stringify(turns));
    } catch {
      // The server conversation still works when browser storage is unavailable.
    }
  }, [transcriptKey, turns]);

  useEffect(() => {
    const node = transcriptRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [turns, busy]);

  const hasTurns = turns.length > 0;
  const onConversationChangeRef = useRef(onConversationChange);
  useEffect(() => { onConversationChangeRef.current = onConversationChange; });
  useEffect(() => { onConversationChangeRef.current?.(hasTurns); }, [hasTurns, transcriptKey]);

  const replaceAttached = (next: AgentAttachment[]) => {
    attachedRef.current = next;
    setAttached(next);
  };

  const attachmentLabel = (item: AgentAttachment) => item.kind === "pdf" && item.pages
    ? `${item.name} · ${t(item.text ? "robin.agent.pdfPages" : "robin.agent.pdfScanned", { count: item.text ? item.pages : item.images.length })}`
    : item.name;

  /** Read files one at a time, so each sees how many image slots the earlier ones left. */
  const addFiles = async (files: File[]) => {
    if (!attachments || disabled) return;
    const accepted = files.filter(isAttachableFile);
    if (accepted.length === 0) return;
    // Attaching starts a conversation; the chips need the open panel to show.
    onCollapsedChange?.(false);
    setAttachNotice(null);
    setAttaching((count) => count + accepted.length);
    for (const file of accepted) {
      try {
        const current = attachedRef.current;
        const isPdf = !file.type.startsWith("image/");
        if (isPdf && current.filter((item) => item.kind === "pdf").length >= MAX_AGENT_DOCUMENTS) {
          throw new Error(t("robin.agent.documentLimit", { count: MAX_AGENT_DOCUMENTS }));
        }
        const item = await readAgentAttachment(file, MAX_AGENT_IMAGES - imageCount(current));
        replaceAttached([...attachedRef.current, item]);
        if (item.truncated) setAttachNotice(t("robin.agent.truncated", { name: item.name }));
      } catch (caught) {
        const reason = caught instanceof Error ? caught.message : String(caught);
        setAttachNotice(reason === "image-limit" ? t("robin.agent.imageLimit", { count: MAX_AGENT_IMAGES }) : reason);
      } finally {
        setAttaching((count) => count - 1);
      }
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files ?? []).filter(isAttachableFile);
    if (!attachments || files.length === 0) return;
    event.preventDefault();
    void addFiles(files);
  };

  const dropProps = attachments ? {
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!Array.from(event.dataTransfer.types).includes("Files")) return;
      event.preventDefault();
      setDragging(true);
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      setDragging(false);
      void addFiles(Array.from(event.dataTransfer.files));
    },
  } : {};

  const send = async (text: string) => {
    const trimmed = text.trim();
    const files = attachments ? attachedRef.current : [];
    if ((!trimmed && files.length === 0) || busy || disabled || attaching > 0) return;
    setTurns((previous) => [...previous, {
      role: "you",
      text: trimmed,
      ...(files.length > 0 ? { attachments: files.map(attachmentLabel) } : {}),
    }]);
    onCollapsedChange?.(false);
    setMessage("");
    replaceAttached([]);
    setAttachNotice(null);
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          ...requestBody,
          message: trimmed || ATTACHMENT_ONLY_MESSAGE,
          ...(files.length > 0 ? {
            images: files.flatMap((file) => file.images.map((image) => ({ type: "image", ...image }))),
            documents: files.filter((file) => file.text).map((file) => ({
              name: file.name,
              text: file.text,
              pages: file.pages,
              truncated: Boolean(file.truncated),
            })),
          } : {}),
        }),
      });
      const body = await response.json().catch(() => null) as
        { reply?: string; usedTools?: string[]; sessionId?: string; error?: string } | null;
      if (!response.ok || !body) throw new Error(body?.error ?? `Request failed (${response.status})`);
      const rotated = !!body.sessionId && !!sessionRef.current && body.sessionId !== sessionRef.current;
      if (body.sessionId) sessionRef.current = body.sessionId;
      setTurns((previous) => {
        const reply: Turn = { role: "agent", text: body.reply ?? "", tools: body.usedTools ?? [] };
        if (!rotated) return [...previous, reply];
        // The message just sent opened the new session, so the line goes above it.
        const reset: Turn = { role: "reset", text: "" };
        return [...previous.slice(0, -1), reset, ...previous.slice(-1), reply];
      });
      // Both personas write records through their tools; the rail is polling,
      // but the user is watching right now.
      if ((body.usedTools ?? []).length > 0) requestRefresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  // Held in a ref so dispatching a brief does not depend on `send`'s identity,
  // which changes every render and would re-run the effect each time.
  const sendRef = useRef(send);
  useEffect(() => { sendRef.current = send; });

  // A brief handed over by the page is sent once, and only when the panel is
  // free: `send` refuses while a turn is in flight, so marking it dispatched
  // before that would swallow it silently.
  useEffect(() => {
    if (!pending || busy || disabled || dispatchedRef.current === pending.id) return;
    dispatchedRef.current = pending.id;
    void sendRef.current(pending.text);
  }, [busy, disabled, pending]);

  const restart = async () => {
    setBusy(true);
    try {
      const response = await fetch(endpoint, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, ...requestBody }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? `Request failed (${response.status})`);
      }
      setTurns([]);
      if (activeTranscriptKeyRef.current) {
        try { window.localStorage.removeItem(`pi-robin-agent-transcript:${activeTranscriptKeyRef.current}`); }
        catch { /* The server session was still cleared. */ }
      }
      sessionRef.current = null;
      setError(null);
    } catch (caught) {
      // Clearing the panel on a failed restart would be a lie: the session on
      // the server is still there and the next message would continue it.
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="flex flex-1 flex-col"
      style={{ minHeight: 0, outline: dragging ? "2px dashed var(--accent)" : undefined, outlineOffset: -4 }}
      {...dropProps}
    >
      {!collapsed ? <header
        className="flex items-baseline gap-3 border-b px-3 py-2"
        style={{ borderColor: "var(--border)" }}
      >
        <h2 className="pi-label">{t(titleKey)}</h2>
        {onCollapsedChange ? (
          <button
            type="button"
            onClick={() => onCollapsedChange(true)}
            className="ui-action pi-chrome-label pi-bracket ml-auto"
            style={{ fontSize: 10 }}
            aria-label="Collapse agent"
            title="Collapse agent"
          >
            −
          </button>
        ) : null}
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="ui-action pi-chrome-label pi-bracket ml-auto"
            style={{ fontSize: 10 }}
          >
            {t("product.agent.close")}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void restart()}
          disabled={busy || disabled}
          className={`ui-action pi-chrome-label pi-bracket${onClose || onCollapsedChange ? "" : " ml-auto"}`}
          style={{ fontSize: 10 }}
          title={t(restartHintKey)}
        >
          {t("coding.agent.restart")}
        </button>
      </header> : null}

      {!collapsed ? <div ref={transcriptRef} className="flex-1 overflow-y-auto p-3" style={{ minHeight: 0 }}>
        <div className="flex flex-col gap-3">
          {turns.length === 0 && emptyHintKey && (
            <p className="text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>{t(emptyHintKey)}</p>
          )}
          {turns.map((turn, index) => turn.role === "reset" ? (
            <p key={index} role="note" className="border-t pt-2 text-xs" style={{ borderColor: "var(--border)", color: "var(--text-dim)" }}>
              {t("coding.agent.newSession")}
            </p>
          ) : (
            <article
              key={index}
              className={`flex flex-col gap-1${turn.role === "you" ? " border-l-2 px-3 py-2" : ""}`}
              style={turn.role === "you" ? {
                borderColor: "var(--accent)",
                background: "var(--accent-soft)",
              } : undefined}
            >
              <span
                className="pi-eyebrow"
                style={{ fontSize: 10, color: turn.role === "you" ? "var(--accent)" : undefined }}
              >
                {turn.role === "you" ? t("coding.agent.you") : t(titleKey)}
              </span>
              {turn.role === "you" ? (
                <>
                  {turn.text ? (
                    <p style={{ fontSize: 16, lineHeight: 1.55, fontWeight: 500, whiteSpace: "pre-wrap", color: "var(--text)" }}>
                      {turn.text}
                    </p>
                  ) : null}
                  {turn.attachments?.length ? (
                    <span className="pi-eyebrow" style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "none", letterSpacing: 0 }}>
                      {turn.attachments.map((name) => `📎 ${name}`).join("   ")}
                    </span>
                  ) : null}
                </>
              ) : (
                <MarkdownBody className="pi-prose" >{turn.text}</MarkdownBody>
              )}
              {turn.tools && turn.tools.length > 0 ? (
                <span className="pi-eyebrow" style={{ fontSize: 9, color: "var(--text-dim)" }}>
                  {[...new Set(turn.tools)]
                    .map((name) => (toolKeys[name] ? t(toolKeys[name]) : name))
                    .join(" · ")}
                </span>
              ) : null}
              {replyAction && turn.role === "agent" && turn.text.trim() ? (
                <button
                  type="button"
                  className="ui-action pi-chrome-label pi-bracket self-start"
                  style={{ fontSize: 9 }}
                  onClick={() => replyAction.onReply(turn.text)}
                >
                  {t(replyAction.labelKey)}
                </button>
              ) : null}
            </article>
          ))}
        </div>
        {busy ? (
          <p className="pi-eyebrow mt-3" style={{ fontSize: 10 }}>{t("robin.assistant.working")}</p>
        ) : null}
        {error ? (
          <p className="mt-3" style={{ fontSize: 12, color: "var(--danger)" }}>{error}</p>
        ) : null}
      </div> : null}

      <div
        className={`border-t p-3${collapsed ? " flex items-center gap-2" : ""}`}
        style={{ borderColor: "var(--border)" }}
      >
        {attachments ? (
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf,.pdf"
            multiple
            hidden
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              void addFiles(files);
            }}
          />
        ) : null}
        {!collapsed && attached.length > 0 ? (
          <ul className="mb-2 flex flex-wrap gap-2" aria-label={t("robin.agent.attached")}>
            {attached.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-2 border py-1 pl-1 pr-2"
                style={{ maxWidth: 260, borderColor: "var(--border-strong)", background: "var(--bg-panel)", fontSize: 12 }}
              >
                {item.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a local data: URL preview, not a remote asset.
                  <img src={item.previewUrl} alt="" style={{ width: 28, height: 28, objectFit: "cover" }} />
                ) : (
                  <span
                    aria-hidden="true"
                    className="grid shrink-0 place-items-center"
                    style={{ width: 28, height: 28, border: "1px solid var(--border)", fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--accent)" }}
                  >
                    PDF
                  </span>
                )}
                <span className="min-w-0 truncate" title={item.name}>{attachmentLabel(item)}</span>
                <button
                  type="button"
                  onClick={() => replaceAttached(attachedRef.current.filter((other) => other.id !== item.id))}
                  aria-label={t("robin.agent.remove", { name: item.name })}
                  title={t("robin.agent.remove", { name: item.name })}
                  className="ui-action shrink-0"
                  style={{ color: "var(--text-muted)" }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {collapsed ? (
          <button
            type="button"
            onClick={() => onCollapsedChange?.(false)}
            className="ui-action pi-label shrink-0"
            aria-label="Expand agent"
            title="Expand agent"
          >
            {t(titleKey)}
          </button>
        ) : null}
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
            lastCompositionEndAtRef.current = Date.now();
          }}
          onPaste={onPaste}
          onKeyDown={(event) => {
            // Enter sends; Shift+Enter is a newline. A coding question is
            // usually one line, and reaching for a button breaks the rhythm.
            if (event.key !== "Enter" || event.shiftKey) return;

            // …but Enter is also how an IME accepts a candidate. Sending then
            // would fire off half-typed Chinese and clear the box. Some IMEs
            // report the composition as already ended by the time this Enter
            // arrives, so a short grace window backs up the live flags — the
            // same three-part check ChatInput uses.
            const composing = composingRef.current
              || event.nativeEvent.isComposing
              || event.nativeEvent.keyCode === 229;
            const justComposed = Date.now() - lastCompositionEndAtRef.current
              < COMPOSITION_END_ENTER_GRACE_MS;
            if (composing || justComposed) {
              if (justComposed) event.preventDefault();
              return;
            }

            event.preventDefault();
            void send(message);
          }}
          rows={collapsed ? 1 : 3}
          // Never disabled, even while the agent is thinking — a turn can take
          // half a minute, and yanking `disabled` onto a focused textarea
          // mid-word tears down an in-flight IME composition, which is how
          // half-typed pinyin ends up committed as raw letters. `send` already
          // refuses to fire while busy, so nothing is lost by staying typable.
          aria-label={t(placeholderKey)}
          placeholder={t(placeholderKey)}
          className="pi-panel w-full resize-none p-2"
          style={{ fontSize: 13, background: "var(--bg-deep)", color: "var(--text)" }}
        />
        {!collapsed && attachments ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || attaching > 0}
              className="ui-action pi-chrome-label pi-bracket"
              style={{ fontSize: 10 }}
              title={t("robin.agent.attachHint")}
            >
              {attaching > 0 ? t("robin.agent.attaching") : t("robin.agent.attach")}
            </button>
            <span style={{ fontSize: 11, color: attachNotice ? "var(--warning)" : "var(--text-dim)" }} role={attachNotice ? "status" : undefined}>
              {attachNotice ?? t("robin.agent.attachHint")}
            </span>
          </div>
        ) : null}
        {!collapsed && footer ? <div className="mt-2">{footer}</div> : null}
        {collapsed && attachments ? (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || attaching > 0}
            className="ui-action pi-chrome-label pi-bracket shrink-0"
            style={{ fontSize: 10 }}
            aria-label={t("robin.agent.attach")}
            title={t("robin.agent.attachHint")}
          >
            {t("robin.agent.attach")}
          </button>
        ) : null}
        {collapsed ? (
          <button
            type="button"
            onClick={() => onCollapsedChange?.(false)}
            className="ui-action pi-chrome-label pi-bracket shrink-0"
            aria-label="Expand agent"
            title="Expand agent"
          >
            ↑
          </button>
        ) : null}
      </div>
    </section>
  );
}
