"use client";

import type { CSSProperties } from "react";

/**
 * Prose with `backtick spans` rendered as code.
 *
 * The research documents are about source, so they name identifiers and line
 * references constantly, and a paragraph where `_clean_generated_text` looks
 * the same as ordinary words is measurably harder to scan. This is the
 * smallest thing that fixes it: split on backticks, and every odd segment is
 * code. No markdown parser, because backticks are the only markup these notes
 * use — and an unbalanced one degrades to a literal backtick rather than
 * swallowing the rest of the paragraph.
 */
export function CodeProse({ text, style }: { text: string; style?: CSSProperties }) {
  const parts = text.split("`");
  return (
    <p style={style}>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <code
            key={index}
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.88em",
              color: "var(--text)",
              background: "var(--bg-hover)",
              padding: "0.05em 0.3em",
              overflowWrap: "anywhere",
            }}
          >
            {part}
          </code>
        ) : (
          part
        ),
      )}
    </p>
  );
}
