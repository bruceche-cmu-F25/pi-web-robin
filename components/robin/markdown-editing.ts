/** A replacement of `value.slice(start, end)`, plus where the selection lands afterwards. */
export interface TextEdit {
  start: number;
  end: number;
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

const LIST_ITEM = /^(\s*)(?:([-*+])\s+(\[[ xX]\]\s+)?|(\d{1,9})([.)])\s+|>\s?)/;
const INDENT = "  ";

function lineBounds(value: string, index: number): { start: number; end: number } {
  const start = value.lastIndexOf("\n", index - 1) + 1;
  const newline = value.indexOf("\n", index);
  return { start, end: newline === -1 ? value.length : newline };
}

/** A caret after an odd number of fence lines is inside a code block, where markers are just text. */
function insideCodeFence(value: string, index: number): boolean {
  return ((value.slice(0, index).match(/^\s*(```|~~~)/gm) ?? []).length % 2) === 1;
}

/**
 * Enter inside a list item or quote: carry the marker onto the next line, or,
 * on an item with nothing after its marker, drop the marker and end the list.
 * Returns null wherever a plain newline is right.
 */
export function continueMarkdownBlock(value: string, selectionStart: number, selectionEnd = selectionStart): TextEdit | null {
  const line = lineBounds(value, selectionStart);
  if (selectionEnd > line.end || insideCodeFence(value, selectionStart)) return null;
  const match = LIST_ITEM.exec(value.slice(line.start, line.end));
  if (!match || selectionStart - line.start < match[0].length) return null;

  if (!value.slice(line.start + match[0].length, line.end).trim()) {
    return { start: line.start, end: line.end, text: "", selectionStart: line.start, selectionEnd: line.start };
  }

  const [, indent, bullet, task, number, delimiter] = match;
  const marker = bullet ? `${bullet} ${task ? "[ ] " : ""}`
    : number ? `${Number(number) + 1}${delimiter} `
      : "> ";
  const text = `\n${indent}${marker}`;
  const caret = selectionStart + text.length;
  return { start: selectionStart, end: selectionEnd, text, selectionStart: caret, selectionEnd: caret };
}

/**
 * Tab / Shift+Tab on list lines: nest or un-nest every line the selection
 * touches. Only claims the key when the first line is a list item, so Tab
 * still moves focus out of the editor everywhere else.
 */
export function indentMarkdownList(value: string, selectionStart: number, selectionEnd: number, outdent: boolean): TextEdit | null {
  const first = lineBounds(value, selectionStart);
  const last = lineBounds(value, Math.max(selectionStart, selectionEnd - (selectionEnd > selectionStart && value[selectionEnd - 1] === "\n" ? 1 : 0)));
  if (insideCodeFence(value, selectionStart) || !LIST_ITEM.test(value.slice(first.start, first.end))) return null;

  const lines = value.slice(first.start, last.end).split("\n");
  let startShift = 0;
  let total = 0;
  const next = lines.map((line, index) => {
    const removed = outdent ? (/^ {1,2}|^\t/.exec(line)?.[0].length ?? 0) : 0;
    const shift = outdent ? -removed : INDENT.length;
    if (index === 0) startShift = shift;
    total += shift;
    return outdent ? line.slice(removed) : `${INDENT}${line}`;
  });
  if (total === 0) return null;

  const clamp = (position: number) => Math.max(first.start, position);
  return {
    start: first.start,
    end: last.end,
    text: next.join("\n"),
    selectionStart: clamp(selectionStart + startShift),
    selectionEnd: clamp(selectionEnd + total),
  };
}

/** Latin words and CJK characters, so a Chinese note is not counted as one word. */
export function countWords(text: string): number {
  return text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)?.length ?? 0;
}
