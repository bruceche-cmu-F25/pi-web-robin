"use client";

import { useEffect, useRef, useState } from "react";
import { MarkdownBody } from "@/components/MarkdownBody";
import { useI18n } from "@/hooks/useI18n";
import { requestRefresh } from "./refreshBus";

interface Turn {
  /** "reset" marks where the server started a new session under the panel. */
  role: "you" | "agent" | "reset";
  text: string;
  tools?: string[];
}

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
}: Props) {
  const { t } = useI18n();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);
  const lastCompositionEndAtRef = useRef(0);
  const dispatchedRef = useRef<string | null>(null);
  const sessionRef = useRef<string | null>(null);

  useEffect(() => {
    const node = transcriptRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [turns, busy]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setTurns((previous) => [...previous, { role: "you", text: trimmed }]);
    setMessage("");
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, ...requestBody, message: trimmed }),
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
    if (!pending || busy || dispatchedRef.current === pending.id) return;
    dispatchedRef.current = pending.id;
    void sendRef.current(pending.text);
  }, [busy, pending]);

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
    <section className="flex flex-1 flex-col" style={{ minHeight: 0 }}>
      <header
        className="flex items-baseline gap-3 border-b px-3 py-2"
        style={{ borderColor: "var(--border)" }}
      >
        <h2 className="pi-label">{t(titleKey)}</h2>
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
          disabled={busy}
          className={`ui-action pi-chrome-label pi-bracket${onClose ? "" : " ml-auto"}`}
          style={{ fontSize: 10 }}
          title={t(restartHintKey)}
        >
          {t("coding.agent.restart")}
        </button>
      </header>

      <div ref={transcriptRef} className="flex-1 overflow-y-auto p-3" style={{ minHeight: 0 }}>
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
                <p style={{ fontSize: 16, lineHeight: 1.55, fontWeight: 500, whiteSpace: "pre-wrap", color: "var(--text)" }}>
                  {turn.text}
                </p>
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
      </div>

      <div className="border-t p-3" style={{ borderColor: "var(--border)" }}>
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
          rows={3}
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
      </div>
    </section>
  );
}
