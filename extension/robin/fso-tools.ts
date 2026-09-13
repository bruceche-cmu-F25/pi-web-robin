/**
 * The mentor's tools: what the Full Stack Open workspace has open, and the
 * user's notes.
 *
 * Read-only. The ticks and notes are the user's own writing — the mentor reads
 * them to know where they are and what they think they understood, and never
 * writes either.
 *
 * Server-only (loaded by the extension).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { FSO_PARTS, findChapter, nextChapter, type FsoChapter } from "./fso.ts";
import { fsoSnapshot, type FsoNote } from "./fso-domain.ts";
import { learningSnapshot } from "./learning-domain.ts";
import { text } from "./toolkit.ts";

function chapterLabel(chapter: FsoChapter): string {
  return `${chapter.part}${chapter.letter} ${chapter.title}`;
}

function noteBlock(note: FsoNote | undefined): string[] {
  return note
    ? ["Their notes for this chapter (their words, not course text):", "<notes>", note.text.trim(), "</notes>"]
    : ["They have not written notes for this chapter yet."];
}

function describeChapter(chapter: FsoChapter, note: FsoNote | undefined, completed: Set<string>): string {
  const part = FSO_PARTS.find((entry) => entry.part === chapter.part);
  const next = nextChapter(chapter);
  const lines = [
    `Full Stack Open — Part ${chapter.part}: ${part?.title ?? ""}`,
    `Chapter ${chapterLabel(chapter)}`,
    `URL: ${chapter.url}`,
  ];
  if (chapter.external) {
    lines.push("This part has moved to courses.mooc.fi and opens in a separate tab, so they may be anywhere inside it.");
  }
  lines.push(`Reading ticked as done: ${completed.has(chapter.id) ? "yes" : "no"}`);
  if (chapter.exercises.length) {
    lines.push("Exercises in this chapter ([x] = they ticked it; * = optional in the course):");
    for (const step of chapter.exercises) lines.push(`  [${completed.has(step.id) ? "x" : " "}] ${step.title}`);
  }
  if (next) lines.push(`Next chapter: ${chapterLabel(next)}`);
  lines.push(...noteBlock(note));
  return lines.join("\n");
}

/** The chapter the workspace has open, or null when none has been opened. */
export function describeOpenFsoChapter(): string | null {
  const snapshot = fsoSnapshot();
  const chapter = findChapter(snapshot.openChapterId);
  if (!chapter) return null;
  const completed = new Set(learningSnapshot().fullstack.completedIds);
  return describeChapter(chapter, snapshot.notes[chapter.id], completed);
}

export function registerFsoTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "fso_current",
    label: "Current chapter",
    description:
      "Read the Full Stack Open chapter the workspace has open: its part, its exercises with the user's own ticks, and their notes on it. Call this first whenever they ask about \"this\", \"this page\", \"this chapter\", or start asking about a topic without naming a source.",
    promptSnippet: "fso_current — the Full Stack Open chapter on screen, with ticks and notes",
    promptGuidelines: [
      "The workspace frames the chapter but cannot see into a cross-origin page, so it records which chapter was opened. fso_current is the only way to know what they are looking at — never guess it from the conversation, and never assume it is still what was discussed earlier in the session. If they followed links inside the page they may be further on; ask if the question does not fit the chapter.",
      "Explain properly, with a concrete example, and check it landed by asking them to apply it once. Then take the idea up a level to where it decides something in a real system — what breaks at scale, where a boundary belongs, what a trade-off costs.",
      "The ticks are the ones they set themselves; you may refer to them as theirs (\"you've ticked 3.1–3.3\"), but you cannot tick anything and must never claim to have recorded anything.",
      "For exercises, help them get unstuck — point at the concept or the bug — rather than writing the submission for them.",
      "Keep it short — this is a side panel next to what they are reading. Reply in the language they write in.",
    ],
    parameters: Type.Object({}),
    async execute() {
      return text(describeOpenFsoChapter()
        ?? "No Full Stack Open chapter is open. Ask what they are working on; the course runs Part 0 (web fundamentals) through Part 14 (Next.js).");
    },
  });

  pi.registerTool({
    name: "fso_notes",
    label: "Course notes",
    description:
      "Read the user's Full Stack Open notebook: every chapter they have written notes for, in course order. Use it when they ask you to review, quiz, or connect what they have learned across chapters.",
    promptSnippet: "fso_notes — the user's own notes on Full Stack Open chapters",
    promptGuidelines: [
      "Notes are their understanding in their own words. Correct what is wrong and point out what is missing; do not rewrite them into your prose.",
      "For the chapter on screen, fso_current already includes its note — only reach for this when the question spans chapters.",
    ],
    parameters: Type.Object({
      part: Type.Optional(Type.Number({ description: "Only this part's chapters (0–14). Defaults to every part." })),
    }),
    async execute(_toolCallId, params) {
      const { notes } = fsoSnapshot();
      const chapters = FSO_PARTS
        .filter((part) => params.part === undefined || part.part === params.part)
        .flatMap((part) => part.chapters)
        .filter((chapter) => notes[chapter.id]);
      if (!chapters.length) return text("No Full Stack Open notes yet.");
      return text(chapters.map((chapter) => [
        `## ${chapterLabel(chapter)} (updated ${notes[chapter.id].updatedAt.slice(0, 10)})`,
        notes[chapter.id].text.trim(),
      ].join("\n")).join("\n\n"));
    },
  });
}
