"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { HEAT_SOURCE_LINES } from "@/extension/robin/heat-source";
import { highlightPython, type PyTokenKind } from "@/extension/robin/python-highlight";

/**
 * The source of visualize.py, sliced to a line range.
 *
 * Tokenised once for the whole file at module scope rather than per block: the
 * lexer has to carry state across lines — the eight few-shot demonstrations are
 * one 67-line string literal — and doing it per block would both re-scan the
 * file ninety times and get that literal wrong.
 *
 * Long lines wrap instead of scrolling sideways. That is a reading decision,
 * not a layout convenience: on a phone the code column is about 39 characters
 * wide, so half of visualize.py sat behind a horizontal scrollbar that shares a
 * gesture with the page's own scrolling. Wrapping also deletes a whole class of
 * problem — with nothing scrolling horizontally the line numbers cannot slide
 * out of view, so they need neither a sticky position nor an opaque backing to
 * survive being scrolled under.
 *
 * The cost is that a wrapped line no longer reflects Python's indentation
 * exactly. The hanging indent below is what keeps that legible: a continuation
 * is offset by 2ch, which reads as neither a new statement nor a deeper block.
 */
const HIGHLIGHTED = highlightPython(HEAT_SOURCE_LINES);

const TOKEN_COLOR: Readonly<Record<PyTokenKind, string>> = {
  plain: "var(--text)",
  comment: "var(--text-dim)",
  string: "var(--todo-sage)",
  keyword: "var(--todo-iris)",
  number: "var(--todo-honey)",
};

/** Wide enough for four digits — visualize.py ends at 1623. */
const GUTTER = "4.5ch";

/** Longer than this and the code buries the note it belongs to. */
const COLLAPSE_ABOVE = 24;
const COLLAPSED_LINES = 16;

export function PythonSource({ from, to }: { from: number; to: number }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);

  const lines = useMemo(
    () => HIGHLIGHTED.slice(from - 1, to).map((tokens, index) => ({ number: from + index, tokens })),
    [from, to],
  );

  const total = lines.length;
  const collapsible = total > COLLAPSE_ABOVE;
  const visible = collapsible && !expanded ? lines.slice(0, COLLAPSED_LINES) : lines;
  const hidden = total - visible.length;

  return (
    <div
      className="flex flex-col"
      style={{
        border: "1px solid var(--border)",
        background: "var(--bg-hover)",
        // Without this the box reports its widest line upward and stretches
        // its own container — which on a phone pushed the note off-screen
        // instead of wrapping it.
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11.5,
          lineHeight: 1.65,
          padding: "8px 0",
        }}
      >
        {visible.map((line) => (
          // One grid per line, so a wrapped line keeps its number at its own
          // first row rather than drifting a line or two down the page.
          <div
            key={line.number}
            style={{ display: "grid", gridTemplateColumns: `${GUTTER} minmax(0, 1fr)`, alignItems: "start" }}
          >
            <span
              aria-hidden
              style={{
                // Not selectable, so the source can be copied straight into an
                // editor without dragging the numbering along with it.
                userSelect: "none",
                color: "var(--text-dim)",
                opacity: 0.65,
                textAlign: "right",
                paddingInlineEnd: "0.75ch",
                // Rows touch, so a border per row draws one continuous rule.
                borderInlineEnd: "1px solid var(--border)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {line.number}
            </span>
            <code
              style={{
                whiteSpace: "pre-wrap",
                // Code has few break opportunities; without this a long string
                // literal would push the column wide again.
                overflowWrap: "anywhere",
                // Hanging indent: the first visual row starts flush, and any
                // continuation is inset so it reads as the same statement.
                paddingInlineStart: "2.75ch",
                textIndent: "-2ch",
              }}
            >
              {/* An empty line still needs a row, or the numbering skips. */}
              {line.tokens.length === 0
                ? " "
                : line.tokens.map((token, index) => (
                    <span key={index} style={{ color: TOKEN_COLOR[token.kind] }}>
                      {token.text}
                    </span>
                  ))}
            </code>
          </div>
        ))}
      </div>

      {collapsible && (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="ui-action pi-eyebrow"
          style={{
            fontSize: 9,
            padding: "5px 10px",
            textAlign: "start",
            borderTop: "1px solid var(--border)",
          }}
        >
          {expanded
            ? t("research.code.source.collapse", { total })
            : t("research.code.source.expand", { hidden })}
        </button>
      )}
    </div>
  );
}
