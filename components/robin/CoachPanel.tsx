"use client";

import { useEffect, useRef, useState } from "react";
import { MarkdownBody } from "@/components/MarkdownBody";
import { useI18n } from "@/hooks/useI18n";
import { requestRefresh } from "./refreshBus";

interface Turn {
  role: "you" | "coach";
  text: string;
  tools?: string[];
}

/** Matches ChatInput: some IMEs end composition just before the Enter lands. */
const COMPOSITION_END_ENTER_GRACE_MS = 100;

/** Tool names the coach can use, in the language the page is in. */
const TOOL_KEYS: Record<string, string> = {
  practice_current: "coding.tool.current",
  practice_list: "coding.tool.list",
  practice_record: "coding.tool.record",
  practice_status: "coding.tool.status",
  practice_note: "coding.tool.note",
  practice_due: "coding.tool.due",
};

/**
 * The coach, next to the problem.
 *
 * The transcript is client-side only: the conversation itself lives in a pi
 * session on the server and survives a reload, but re-rendering weeks of it in
 * a side panel would bury the exchange the user is actually in. Reloading the
 * page therefore gives a clean panel and a coach that still remembers — which
 * is the behaviour you want from someone sitting beside you.
 */
export function CoachPanel() {
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
        body: JSON.stringify({ mode: "coach", message: trimmed }),
      });
      const body = await response.json().catch(() => null) as
        { reply?: string; usedTools?: string[]; error?: string } | null;
      if (!response.ok || !body) throw new Error(body?.error ?? `Request failed (${response.status})`);
      setTurns((previous) => [...previous, {
        role: "coach",
        text: body.reply ?? "",
        tools: body.usedTools ?? [],
      }]);
      // The coach writes practice records through its tools; the rail is
      // polling, but the user is watching right now.
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
        body: JSON.stringify({ mode: "coach" }),
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
        <h2 className="pi-label">{t("coding.coach.title")}</h2>
        <button
          type="button"
          onClick={() => void restart()}
          disabled={busy}
          className="ui-action pi-chrome-label pi-bracket ml-auto"
          style={{ fontSize: 10 }}
          title={t("coding.coach.restartHint")}
        >
          {t("coding.coach.restart")}
        </button>
      </header>

      <div ref={transcriptRef} className="flex-1 overflow-y-auto p-3" style={{ minHeight: 0 }}>
        <div className="flex flex-col gap-3">
          {turns.map((turn, index) => (
            <article key={index} className="flex flex-col gap-1">
              <span className="pi-eyebrow" style={{ fontSize: 9 }}>
                {turn.role === "you" ? t("coding.coach.you") : t("coding.coach.title")}
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
                    .map((name) => (TOOL_KEYS[name] ? t(TOOL_KEYS[name]) : name))
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
          // Never disabled, even while the coach is thinking — a turn can take
          // half a minute, and yanking `disabled` onto a focused textarea
          // mid-word tears down an in-flight IME composition, which is how
          // half-typed pinyin ends up committed as raw letters. `send` already
          // refuses to fire while busy, so nothing is lost by staying typable.
          placeholder={t("coding.coach.placeholder")}
          className="pi-panel w-full resize-none p-2"
          style={{ fontSize: 13, background: "var(--bg-deep)", color: "var(--text)" }}
        />
      </div>
    </section>
  );
}
