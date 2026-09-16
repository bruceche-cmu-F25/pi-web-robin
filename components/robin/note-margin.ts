/** What the Notes page reads out of a Markdown note for its margins. */

export interface OutlineEntry {
  level: 1 | 2 | 3;
  text: string;
  /** Zero-based line index in the note. */
  line: number;
}

export interface MarginItem {
  kind: "question" | "todo";
  text: string;
  line: number;
}

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^(#{1,3})\s+(.+?)\s*#*\s*$/;
const OPEN_TODO = /^\s*[-*+]\s+\[ \]\s+(.+)$/;
const LIST_MARKER = /^\s*(?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?/;
/** "question: …", "Q: …", "问题：…", "疑问：…" at the start of a line. */
const QUESTION_PREFIX = /^(?:question|q|问题|疑问)\s*[:：]\s*/i;

/** Headings outside code blocks, in order; these are also the headings a Markdown render produces. */
export function noteOutline(text: string): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  let fenced = false;
  text.split("\n").forEach((raw, line) => {
    if (FENCE.test(raw)) { fenced = !fenced; return; }
    if (fenced) return;
    const match = HEADING.exec(raw);
    if (match) entries.push({ level: match[1].length as 1 | 2 | 3, text: match[2], line });
  });
  return entries;
}

/**
 * Open to-dos and questions: a line marked "question:" (or 问题：), or one
 * that ends in a question mark. Headings are left to the outline, and a
 * checked-off task is no longer open.
 */
export function noteMarginItems(text: string): MarginItem[] {
  const items: MarginItem[] = [];
  let fenced = false;
  text.split("\n").forEach((raw, line) => {
    if (FENCE.test(raw)) { fenced = !fenced; return; }
    if (fenced || HEADING.test(raw) || !raw.trim()) return;
    const todo = OPEN_TODO.exec(raw);
    if (todo) {
      items.push({ kind: "todo", text: todo[1].trim(), line });
      return;
    }
    const body = raw.replace(LIST_MARKER, "").replace(/^\s*>\s?/, "").trim();
    const prefixed = QUESTION_PREFIX.test(body);
    if (prefixed || /[?？]$/.test(body)) {
      const question = body.replace(QUESTION_PREFIX, "").trim();
      if (question) items.push({ kind: "question", text: question, line });
    }
  });
  return items;
}

/** The heading a reader is in: the last one at or above the given line. */
export function currentHeading(outline: OutlineEntry[], line: number): number {
  let index = -1;
  outline.forEach((entry, position) => { if (entry.line <= line) index = position; });
  return index;
}

/**
 * Card tops for margin notes, each as close to its line's centre as the
 * cards above it allow. Heights are measured, so a long question pushes the
 * next card down instead of overlapping it.
 */
export function stackMarginCards(targets: Array<{ y: number; height: number }>, gap = 8, lift = 16): number[] {
  let floor = -Infinity;
  return targets.map(({ y, height }) => {
    const top = Math.max(y - lift, floor);
    floor = top + height + gap;
    return top;
  });
}
