import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NEETCODE_CATALOG,
  PATTERN_ORDER,
  dueForReview,
  embedUrl,
  findProblem,
  groupByPattern,
  isDue,
  leetcodeUrl,
  problemsInList,
  recordMap,
  reviewDateFor,
  statsFor,
  suggestNext,
} from "./practice.ts";

function record(slug, patch = {}) {
  return { slug, status: "todo", attempts: [], updatedAt: "2026-08-20T00:00:00.000Z", ...patch };
}

test("the catalog covers the lists the rail offers", () => {
  assert.equal(problemsInList("neetcode150").length, 150);
  assert.equal(problemsInList("blind75").length, 75);
  assert.equal(problemsInList("all").length, NEETCODE_CATALOG.length);
});

/**
 * The rail renders PATTERN_ORDER, so a catalog refresh that introduces or
 * renames a topic has to be noticed here rather than silently dropping a
 * section to the bottom of the page.
 */
test("every catalog pattern is in the roadmap order", () => {
  const known = new Set(PATTERN_ORDER);
  const unknown = [...new Set(NEETCODE_CATALOG.map((problem) => problem.pattern))]
    .filter((pattern) => !known.has(pattern));
  assert.deepEqual(unknown, []);
});

/**
 * The whole point of the deep links: every NeetCode 150 problem must have a
 * page that can actually be framed, because that list is the default view.
 */
test("all of NeetCode 150 can be embedded", () => {
  const missing = problemsInList("neetcode150").filter((problem) => embedUrl(problem) === null);
  assert.deepEqual(missing.map((problem) => problem.problem), []);
});

test("a problem without a NeetCode page still has a LeetCode link", () => {
  const orphan = NEETCODE_CATALOG.find((problem) => !problem.ncSlug);
  if (!orphan) return; // A future snapshot may cover everything.
  assert.equal(embedUrl(orphan), null);
  assert.equal(leetcodeUrl(orphan), `https://leetcode.com/problems/${orphan.link}/`);
});

test("findProblem accepts a slug, a title, and NeetCode's own slug", () => {
  assert.equal(findProblem("contains-duplicate")?.problem, "Contains Duplicate");
  assert.equal(findProblem("Contains Duplicate")?.link, "contains-duplicate");
  assert.equal(findProblem("duplicate-integer")?.link, "contains-duplicate");
  assert.equal(findProblem("nothing-like-this-exists"), null);
});

test("findProblem does not choose the first result for an ambiguous partial name", () => {
  assert.equal(findProblem("duplicate"), null);
});

test("groupByPattern counts progress per pattern in roadmap order", () => {
  const problems = problemsInList("blind75");
  const first = problems[0];
  const groups = groupByPattern(problems, recordMap([record(first.link, { status: "solved" })]));

  assert.equal(groups[0].pattern, "Arrays & Hashing");
  assert.equal(groups[0].solved, 1);
  const patterns = groups.map((group) => group.pattern);
  assert.deepEqual(patterns, PATTERN_ORDER.filter((pattern) => patterns.includes(pattern)));
});

test("review intervals stretch with confidence", () => {
  assert.equal(reviewDateFor(1, "2026-08-20"), "2026-08-21");
  assert.equal(reviewDateFor(3, "2026-08-20"), "2026-08-27");
  assert.equal(reviewDateFor(5, "2026-08-20"), "2026-10-19");
  // Out-of-range ratings are clamped rather than producing an invalid date.
  assert.equal(reviewDateFor(9, "2026-08-20"), reviewDateFor(5, "2026-08-20"));
  assert.equal(reviewDateFor(0, "2026-08-20"), reviewDateFor(1, "2026-08-20"));
});

test("only solved problems come due", () => {
  const solved = record("two-sum", { status: "solved", nextReviewOn: "2026-08-20" });
  const attempted = record("3sum", { status: "attempted", nextReviewOn: "2026-08-20" });

  assert.equal(isDue(solved, "2026-08-20"), true);
  assert.equal(isDue(solved, "2026-08-19"), false);
  assert.equal(isDue(attempted, "2026-08-21"), false);
  assert.equal(isDue(undefined, "2026-08-21"), false);

  const due = dueForReview([attempted, solved], "2026-08-21");
  assert.deepEqual(due.map((entry) => entry.slug), ["two-sum"]);
});

test("stats count solves by difficulty and reviews that are due", () => {
  const problems = problemsInList("blind75");
  const easy = problems.find((problem) => problem.difficulty === "Easy");
  const stats = statsFor(
    problems,
    recordMap([record(easy.link, { status: "solved", nextReviewOn: "2026-08-01" })]),
    "2026-08-20",
  );

  assert.equal(stats.total, 75);
  assert.equal(stats.solved, 1);
  assert.equal(stats.due, 1);
  assert.equal(stats.byDifficulty.Easy.solved, 1);
  assert.equal(stats.byDifficulty.Medium.solved, 0);
});

test("suggestNext puts a due review ahead of the next unsolved problem", () => {
  const problems = problemsInList("blind75");
  const [first, second] = problems;

  const fresh = suggestNext(problems, recordMap([]), "2026-08-20");
  assert.equal(fresh.link, first.link);

  const withReview = suggestNext(
    problems,
    recordMap([
      record(first.link, { status: "solved" }),
      record(second.link, { status: "solved", nextReviewOn: "2026-08-19" }),
    ]),
    "2026-08-20",
  );
  assert.equal(withReview.link, second.link);
});

test("suggestNext returns null once everything is solved and nothing is due", () => {
  const problems = problemsInList("blind75");
  const all = recordMap(problems.map((problem) => record(problem.link, { status: "solved" })));
  assert.equal(suggestNext(problems, all, "2026-08-20"), null);
});
