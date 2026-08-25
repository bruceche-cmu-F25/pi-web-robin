/**
 * The coding-practice tools.
 *
 * Deliberately absent: anything that hands over a solution. The coach has no
 * tool for fetching a reference implementation, because a model that can reach
 * one will reach for it, and a coach that answers the problem is not coaching.
 * Reference solutions are linked on the page, where opening one is the user's
 * decision and is visible as such.
 *
 * Server-only (loaded by the extension).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { localDate } from "./dates.ts";
import {
  ATTEMPT_OUTCOMES,
  PRACTICE_STATUSES,
  dueForReview,
  findProblem,
  leetcodeUrl,
  problemsInList,
  recordMap,
  type CatalogProblem,
  type PracticeList,
  type PracticeRecord,
} from "./practice.ts";
import {
  currentList,
  currentProblem,
  logAttempt,
  setNote,
  setStatus,
  type PracticeSnapshot,
} from "./practice-domain.ts";
import { readPracticeRecords } from "./store.ts";
import { text } from "./toolkit.ts";

function describe(problem: CatalogProblem, record: PracticeRecord | null): string {
  const marks = [
    problem.difficulty,
    problem.pattern,
    ...(problem.neetcode150 ? ["NeetCode 150"] : []),
    ...(problem.blind75 ? ["Blind 75"] : []),
  ];
  const history = record
    ? `${record.status}, ${record.attempts.length} attempt(s)`
      + (record.confidence ? `, confidence ${record.confidence}/5` : "")
      + (record.nextReviewOn ? `, review on ${record.nextReviewOn}` : "")
    : "no attempts yet";
  return `${problem.problem} [${marks.join(" · ")}] — ${history}`;
}

function describeSnapshot(snapshot: PracticeSnapshot): string {
  const lines = [
    describe(snapshot.problem, snapshot.record),
    `LeetCode: ${leetcodeUrl(snapshot.problem)}`,
  ];
  if (snapshot.due) lines.push("This one is due for review today.");
  if (snapshot.record?.note) lines.push(`Their note: ${snapshot.record.note}`);
  if (snapshot.record?.attempts.length) {
    const recent = snapshot.record.attempts.slice(-3).map((attempt) =>
      `  ${attempt.at.slice(0, 10)} ${attempt.outcome}`
        + (attempt.minutes ? `, ${attempt.minutes}min` : "")
        + (attempt.hintLevel ? `, hint level ${attempt.hintLevel}` : ""));
    lines.push("Recent attempts:", ...recent);
  }
  return lines.join("\n");
}

export function registerPracticeTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "practice_current",
    label: "Current problem",
    description:
      "Read the problem the coding workspace currently has open, with the user's history on it. Call this first when they ask anything about \"this problem\", \"this one\", or start talking about an approach without naming a problem.",
    promptSnippet: "practice_current — which problem the workspace has open",
    promptGuidelines: [
      "The coding workspace embeds NeetCode in a frame you cannot see into. practice_current is the only way to know which problem the user is looking at — never guess it from the conversation, and never assume it is still the one discussed earlier in the session.",
      "You are coaching, not answering. Work up the hint ladder and stop at the lowest rung that unblocks them: (0) ask what they have tried and what they think the bottleneck is; (1) name the pattern or the question to ask about the input; (2) give the key invariant or data structure; (3) sketch the algorithm in prose or pseudocode; (4) only on an explicit request, write the code. Never open above rung 1 unprompted.",
      "After a problem is finished, record it with practice_record, including the highest hint rung the conversation reached. A solve that took four rungs and a solve that took none are different facts and the review schedule depends on the difference.",
      "Talk about complexity every time — theirs, then the target — and prefer asking them to derive it over stating it.",
      "You are a senior Python and full-stack engineer: idiomatic Python, honest naming, and the same standards you would apply in review. When their approach would be wrong in production for reasons the puzzle hides, say so briefly after the problem is solved, not instead of solving it.",
    ],
    parameters: Type.Object({}),
    async execute() {
      const snapshot = currentProblem();
      if (!snapshot) {
        return text("No problem is open in the workspace right now. Ask the user which one they mean, or suggest one from practice_list.");
      }
      return text(describeSnapshot(snapshot));
    },
  });

  pi.registerTool({
    name: "practice_list",
    label: "List practice problems",
    description:
      "List problems from the NeetCode catalog with the user's progress on them. Filter by pattern, list, or status.",
    promptSnippet: "practice_list — browse the problem catalog and the user's progress",
    parameters: Type.Object({
      pattern: Type.Optional(Type.String({
        description: 'Roadmap group, e.g. "Two Pointers". Partial matches are fine.',
      })),
      list: Type.Optional(Type.String({
        description: "neetcode150 | blind75 | all. Defaults to the list the workspace is showing.",
      })),
      status: Type.Optional(Type.String({ description: PRACTICE_STATUSES.join(" | ") })),
      limit: Type.Optional(Type.Number({ description: "How many to return (default 25, max 80)" })),
    }),
    async execute(_toolCallId, params) {
      const list = (["neetcode150", "blind75", "all"] as PracticeList[])
        .find((candidate) => candidate === params.list) ?? currentList();
      const records = recordMap(readPracticeRecords());
      const needle = params.pattern?.trim().toLowerCase();

      let problems = problemsInList(list);
      if (needle) {
        problems = problems.filter((problem) => problem.pattern.toLowerCase().includes(needle));
      }
      if (params.status) {
        problems = problems.filter((problem) =>
          (records.get(problem.link)?.status ?? "todo") === params.status);
      }

      const limit = Math.min(Math.max(Math.round(params.limit ?? 25), 1), 80);
      const shown = problems.slice(0, limit);
      if (shown.length === 0) return text("No problems match that filter.");

      const header = `${problems.length} problem(s) match; showing ${shown.length}.`;
      return text([header, ...shown.map((problem) => describe(problem, records.get(problem.link) ?? null))].join("\n"));
    },
  });

  pi.registerTool({
    name: "practice_record",
    label: "Record an attempt",
    description:
      "Record how a sitting with a problem went. Call this when the user says they solved it, gave up, or got partway — not at the start of one.",
    promptSnippet: "practice_record — log how an attempt went and schedule the review",
    parameters: Type.Object({
      problem: Type.String({ description: "Problem name or LeetCode slug. Omit nothing — pass what practice_current returned." }),
      outcome: Type.String({ description: ATTEMPT_OUTCOMES.join(" | ") }),
      minutes: Type.Optional(Type.Number({ description: "Roughly how long it took" })),
      hintLevel: Type.Optional(Type.Number({
        description: "Highest hint rung the conversation reached, 0 (none) to 4 (you wrote the code)",
      })),
      confidence: Type.Optional(Type.Number({
        description: "Their self-rating 1 (lost) to 5 (could teach it). Ask rather than invent; omitted means it is inferred from the outcome and hints.",
      })),
      note: Type.Optional(Type.String({ description: "One or two lines on what the sticking point was" })),
    }),
    async execute(_toolCallId, params) {
      const result = logAttempt({
        problem: params.problem,
        outcome: params.outcome as (typeof ATTEMPT_OUTCOMES)[number],
        ...(params.minutes !== undefined ? { minutes: params.minutes } : {}),
        ...(params.hintLevel !== undefined ? { hintLevel: params.hintLevel } : {}),
        ...(params.confidence !== undefined ? { confidence: params.confidence } : {}),
        ...(params.note !== undefined ? { note: params.note } : {}),
      });
      if ("error" in result) return text(result.error);
      const { problem, record } = result;
      const review = record.nextReviewOn ? ` Next review ${record.nextReviewOn}.` : "";
      return text(`Recorded ${params.outcome} on "${problem.problem}" (confidence ${record.confidence}/5).${review}`);
    },
  });

  pi.registerTool({
    name: "practice_status",
    label: "Set problem status",
    description: `Set a problem's status directly: ${PRACTICE_STATUSES.join(", ")}. Use practice_record instead when a sitting just happened.`,
    promptSnippet: "practice_status — mark a problem todo/attempted/solved",
    parameters: Type.Object({
      problem: Type.String({ description: "Problem name or LeetCode slug" }),
      status: Type.String({ description: PRACTICE_STATUSES.join(" | ") }),
    }),
    async execute(_toolCallId, params) {
      const result = setStatus(params.problem, params.status as (typeof PRACTICE_STATUSES)[number]);
      if ("error" in result) return text(result.error);
      return text(`"${result.problem.problem}" is now ${result.record.status}.`);
    },
  });

  pi.registerTool({
    name: "practice_note",
    label: "Write a problem note",
    description:
      "Save the user's takeaway on a problem — the insight, the trap, the thing they want to see again next time. Replaces any existing note.",
    promptSnippet: "practice_note — save the takeaway on a problem",
    promptGuidelines: [
      "A good note is the one sentence that would have unblocked them 20 minutes earlier. Write it in their own framing and in the language they are speaking, not as a summary of the solution.",
    ],
    parameters: Type.Object({
      problem: Type.String({ description: "Problem name or LeetCode slug" }),
      note: Type.String({ description: "The takeaway. Empty string clears it." }),
    }),
    async execute(_toolCallId, params) {
      const result = setNote(params.problem, params.note);
      if ("error" in result) return text(result.error);
      return text(
        params.note.trim()
          ? `Noted on "${result.problem.problem}".`
          : `Cleared the note on "${result.problem.problem}".`,
      );
    },
  });

  pi.registerTool({
    name: "practice_due",
    label: "Review queue",
    description:
      "List solved problems whose review date has arrived, soonest first. Use this when the user asks what to work on, or wants a warm-up.",
    promptSnippet: "practice_due — problems due for review today",
    parameters: Type.Object({}),
    async execute() {
      const today = localDate();
      const records = readPracticeRecords();
      const due = dueForReview(records, today);
      if (due.length === 0) {
        const scheduled = records.filter((record) => record.nextReviewOn).length;
        return text(
          scheduled === 0
            ? `Nothing scheduled yet (today is ${today}). Reviews appear once problems are recorded as solved.`
            : `Nothing due today (${today}); ${scheduled} problem(s) are scheduled for later.`,
        );
      }
      const lines = due.map((record) => {
        const problem = findProblem(record.slug);
        const name = problem ? problem.problem : record.slug;
        return `${record.nextReviewOn}  ${name}`
          + (record.confidence ? ` (confidence ${record.confidence}/5)` : "")
          + (record.note ? ` — ${record.note}` : "");
      });
      return text([`${due.length} due for review as of ${today}:`, ...lines].join("\n"));
    },
  });
}
