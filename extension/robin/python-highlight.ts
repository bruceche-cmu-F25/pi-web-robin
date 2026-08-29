/**
 * A small Python lexer, just good enough to read code by.
 *
 * It exists because the walkthrough shows 1,623 lines of Python and the two
 * things that most help a reader find their place in that are comments and
 * string literals — this file is a third prose by volume, between the docstring
 * that defines the pipeline, the eight few-shot demonstrations, and 300 lines
 * of HTML written as f-strings. Undifferentiated monospace makes all of it look
 * like logic.
 *
 * The whole file is scanned in one pass rather than per displayed block,
 * because the demonstrations live inside one triple-quoted string spanning 67
 * lines: a lexer started in the middle of that would read the prose as code and
 * the code after it as string. State has to carry across lines, so the input is
 * the file and the output is per-line.
 *
 * It is deliberately not a parser. Decorators, walrus operators and nested
 * f-string expressions all come out as plain text, which is the correct failure
 * mode for something whose only job is to make a page readable.
 */

export const PY_TOKEN_KINDS = ["plain", "comment", "string", "keyword", "number"] as const;
export type PyTokenKind = (typeof PY_TOKEN_KINDS)[number];

export interface PyToken {
  text: string;
  kind: PyTokenKind;
}

const KEYWORDS = new Set([
  "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del",
  "elif", "else", "except", "False", "finally", "for", "from", "global", "if", "import",
  "in", "is", "lambda", "None", "nonlocal", "not", "or", "pass", "raise", "return",
  "True", "try", "while", "with", "yield", "self",
]);

/** Splits a run of non-string, non-comment source into words, numbers and the rest. */
function classifyCode(text: string, out: PyToken[]): void {
  if (!text) return;
  // One regex pass: identifiers and numbers are the only things pulled out, so
  // everything between them survives verbatim, spacing included.
  const pattern = /[A-Za-z_][A-Za-z0-9_]*|\d+\.?\d*/g;
  let last = 0;
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    if (match.index > last) out.push({ text: text.slice(last, match.index), kind: "plain" });
    const word = match[0];
    const kind: PyTokenKind = KEYWORDS.has(word)
      ? "keyword"
      : /^\d/.test(word)
        ? "number"
        : "plain";
    out.push({ text: word, kind });
    last = match.index + word.length;
  }
  if (last < text.length) out.push({ text: text.slice(last), kind: "plain" });
}

/** Finds the end of a quoted literal starting at `start`, honouring backslash escapes. */
function closeQuote(line: string, start: number, delim: string): number {
  let i = start + delim.length;
  while (i < line.length) {
    if (line[i] === "\\") {
      i += 2;
      continue;
    }
    if (line.startsWith(delim, i)) return i + delim.length;
    i += 1;
  }
  return -1;
}

/**
 * Tokenises a whole Python file.
 *
 * @param lines the file, one entry per line
 * @returns one token array per input line; concatenating a line's token texts
 *   reproduces that line exactly
 */
export function highlightPython(lines: readonly string[]): PyToken[][] {
  const result: PyToken[][] = [];
  /** The triple-quote delimiter we are inside, or null at top level. */
  let openDelim: string | null = null;

  for (const line of lines) {
    const tokens: PyToken[] = [];
    let i = 0;

    if (openDelim) {
      const end = line.indexOf(openDelim);
      if (end === -1) {
        result.push(line ? [{ text: line, kind: "string" }] : []);
        continue;
      }
      tokens.push({ text: line.slice(0, end + openDelim.length), kind: "string" });
      i = end + openDelim.length;
      openDelim = null;
    }

    let plainFrom = i;
    while (i < line.length) {
      const ch = line[i];

      if (ch === "#") {
        classifyCode(line.slice(plainFrom, i), tokens);
        tokens.push({ text: line.slice(i), kind: "comment" });
        plainFrom = line.length;
        i = line.length;
        break;
      }

      if (ch === '"' || ch === "'") {
        const triple = line.startsWith(ch.repeat(3), i) ? ch.repeat(3) : null;
        const delim = triple ?? ch;
        classifyCode(line.slice(plainFrom, i), tokens);
        const end = closeQuote(line, i, delim);
        if (end === -1) {
          tokens.push({ text: line.slice(i), kind: "string" });
          // An unterminated single quote is a syntax error, not an open block;
          // only a triple quote carries state to the next line.
          if (triple) openDelim = triple;
          plainFrom = line.length;
          i = line.length;
          break;
        }
        tokens.push({ text: line.slice(i, end), kind: "string" });
        i = end;
        plainFrom = i;
        continue;
      }

      i += 1;
    }

    if (plainFrom < line.length) classifyCode(line.slice(plainFrom), tokens);
    result.push(tokens);
  }

  return result;
}
