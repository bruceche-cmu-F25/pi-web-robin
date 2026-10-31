import { structuredPatch } from "diff";

export interface ResumeChangeLine {
  kind: "added" | "removed" | "context" | "note";
  oldLine: number | null;
  newLine: number | null;
  text: string;
}
export interface ResumeChangeHunk {
  oldStart: number;
  newStart: number;
  targetLine: number;
  lines: ResumeChangeLine[];
}

/** Compact context around actual edits; bounded work even for a wholesale rewrite. */
export function resumeChanges(before: string, after: string): { hunks: ResumeChangeHunk[]; added: number; removed: number } | null {
  // Bound rendered rows too: the diff library can fast-path an entirely new file.
  if (before.split("\n").length + after.split("\n").length > 10_000) return null;
  const patch = structuredPatch("before.tex", "after.tex", before, after, undefined, undefined,
    { context: 2, timeout: 100, maxEditLength: 2000 });
  if (!patch || patch.hunks.reduce((count, hunk) => count + hunk.lines.length, 0) > 5000) return null;
  let added = 0, removed = 0;
  const lastLine = after.split("\n").length;
  const hunks = patch.hunks.map((hunk) => {
    let oldLine = hunk.oldStart, newLine = hunk.newStart;
    let targetLine: number | undefined, firstChangedLine: number | undefined;
    const lines = hunk.lines.map((line): ResumeChangeLine => {
      const prefix = line[0], text = line.slice(1).replace(/\r$/, "");
      if (prefix === "\\") return { kind: "note", oldLine: null, newLine: null, text: line };
      if (prefix === "+" || prefix === "-") {
        const target = Math.max(1, Math.min(newLine, lastLine));
        firstChangedLine ??= target;
        if (text.trim()) targetLine ??= target;
      }
      if (prefix === "+") { added++; return { kind: "added", oldLine: null, newLine: newLine++, text }; }
      if (prefix === "-") { removed++; return { kind: "removed", oldLine: oldLine++, newLine: null, text }; }
      return { kind: "context", oldLine: oldLine++, newLine: newLine++, text };
    });
    return { oldStart: hunk.oldStart, newStart: hunk.newStart, targetLine: targetLine ?? firstChangedLine ?? Math.max(1, hunk.newStart), lines };
  });
  return { hunks, added, removed };
}

/** Call with the textarea's DOM value: it normalizes CRLF to LF for selection offsets. */
export function resumeLineRange(source: string, requestedLine: number): { line: number; start: number; end: number } {
  const lines = source.split("\n");
  const line = Math.max(1, Math.min(Number.isFinite(requestedLine) ? Math.floor(requestedLine) : 1, lines.length));
  let start = 0;
  for (let i = 0; i < line - 1; i++) start += lines[i].length + 1;
  return { line, start, end: start + lines[line - 1].replace(/\r$/, "").length };
}
