"use client";

import { useEffect, useRef, useState } from "react";
import { MarkdownBody } from "@/components/MarkdownBody";
import { useI18n } from "@/hooks/useI18n";
import { requestRefresh } from "./refreshBus";

interface Turn {
  role: "you" | "agent";
  text: string;
  tools?: string[];
}

/** Matches ChatInput: some IMEs end composition just before the Enter lands. */
const COMPOSITION_END_ENTER_GRACE_MS = 100;

interface Props {
  /** Which assistant mode this panel talks to — its persona, tools, and session. */
  mode: "coach" | "mentor";
  /** i18n keys for the chrome, so the two personas read as different people. */
  titleKey: string;
  placeholderKey: string;
  restartHintKey: string;
  /** Tool name → i18n key, for the line under a reply saying what it touched. */
  toolKeys: Record<string, string>;
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
 * session on the server and survives a reload, but re-rendering weeks of it in
 * a side panel would bury the exchange the user is actually in. Reloading the
 * page therefore gives a clean panel and an agent that still remembers — which
 * is the behaviour you want from someone sitting beside you.
 */
export function AgentPanel({ mode, titleKey, placeholderKey, restartHintKey, toolKeys }: Props) {
  const { t } = useI18n();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);
  const lastCompositionEndAtRef = useRef(0);

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
      const response = await fetch("/api/robin/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, message: trimmed }),
      });
      const body = await response.json().catch(() => null) as
        { reply?: string; usedTools?: string[]; error?: string } | null;
      if (!response.ok || !body) throw new Error(body?.error ?? `Request failed (${response.status})`);
      setTurns((previous) => [...previous, {
        role: "agent",
        text: body.reply ?? "",
        tools: body.usedTools ?? [],
      }]);
      // Both personas write records through their tools; the rail is polling,
      // but the user is watching right now.
      if ((body.usedTools ?? []).length > 0) requestRefresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const restart = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/robin/assistant", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? `Request failed (${response.status})`);
      }
      setTurns([]);
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
        <button
          type="button"
          onClick={() => void restart()}
          disabled={busy}
          className="ui-action pi-chrome-label pi-bracket ml-auto"
          style={{ fontSize: 10 }}
          title={t(restartHintKey)}
        >
          {t("coding.agent.restart")}
        </button>
      </header>

      <div ref={transcriptRef} className="flex-1 overflow-y-auto p-3" style={{ minHeight: 0 }}>
        <div className="flex flex-col gap-3">
          {turns.map((turn, index) => (
            <article key={index} className="flex flex-col gap-1">
              <span className="pi-eyebrow" style={{ fontSize: 9 }}>
                {turn.role === "you" ? t("coding.agent.you") : t(titleKey)}
              </span>
              {turn.role === "you" ? (
                <p style={{ fontSize: 13, whiteSpace: "pre-wrap", color: "var(--text-muted)" }}>
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
          placeholder={t(placeholderKey)}
          className="pi-panel w-full resize-none p-2"
          style={{ fontSize: 13, background: "var(--bg-deep)", color: "var(--text)" }}
        />
      </div>
    </section>
  );
}
