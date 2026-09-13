import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (name) => readFile(new URL(`./${name}`, import.meta.url), "utf8");
const source = await read("LearningHub.tsx");
const navigationSource = await read("RobinMargin.tsx");
const learnLayoutSource = await read("../../app/learn/layout.tsx");

test("the hub links to both daily tracks", async () => {
  // The hub is the front door. A track with no entry here is a track nobody
  // finds, which is the whole failure mode a landing page exists to prevent.
  // Problems is reached through today's NeetCode track, which the hub renders,
  // rather than through a second card repeating the same count.
  const panel = await read("LearningPanel.tsx");
  assert.match(source, /<LearningPanel showCourseOutline \/>/);
  assert.match(source, /href: "\/learn\/fso"/);
  assert.match(panel, /href=\{`\/coding\?list=/);
  assert.match(panel, /\/learn\/fso\?step=/);
});

test("hub navigation lives in the shared shell and can challenge Basic Auth", () => {
  assert.match(learnLayoutSource, /<RobinShell>\{children\}<\/RobinShell>/);
  assert.doesNotMatch(navigationSource, /from ["']next\/link["']/);
  assert.match(navigationSource, /path: "\/dashboard"/);
  assert.match(navigationSource, /href: chatHref/);
});

test("product has its own navigation tone", () => {
  assert.match(navigationSource, /icon: DashboardIcon,[\s\S]*?tone: "clay"/);
  assert.match(navigationSource, /icon: ProductIcon,[\s\S]*?tone: "fern"/);
});

test("the hub stays a front door rather than a second dashboard", async () => {
  // It holds the ways in and the study links. Calendar, todos, the job
  // pipeline, and the saved-links collection live on the dashboard;
  // duplicating them here is how a landing page stops being shorter than what
  // it links to, which is the only reason to land on it.
  for (const panel of ["CalendarPanel", "TodoPanel", "JobsPanel", "AssistantBar", "LinksPanel"]) {
    assert.doesNotMatch(source, new RegExp(`<${panel}\\b`), `${panel} belongs on the dashboard`);
  }
  assert.match(source, /<LearningShelf \/>/);
});

test("the hub links to the focused GPT-2 walkthrough page", () => {
  assert.match(source, /id: "gpt2-walkthrough"/);
  assert.match(source, /href: "\/learn\/gpt2"/);
});

test("the GPT-2 page keeps the official video and companion repository links", async () => {
  const page = await read("GPT2Walkthrough.tsx");
  assert.match(page, /https:\/\/www\.youtube\.com\/watch\?v=l8pRSuU81PU/);
  assert.match(page, /https:\/\/github\.com\/karpathy\/build-nanogpt/);
  assert.match(page, /https:\/\/github\.com\/karpathy\/nn-zero-to-hero/);
});

test("the hub's numbers all come from today's panel", async () => {
  // The panel's learning snapshot already carries the practice count, so a
  // poll of the hub's own would fetch the same number twice. The curriculum
  // entry says what it is rather than how far along it is; a study poll here
  // would mean the tracking came back somewhere.
  assert.doesNotMatch(source, /usePolledResource/);
  assert.doesNotMatch(source, /\/api\/robin\/study/);

  const shelf = await read("LearningShelf.tsx");
  assert.doesNotMatch(shelf, /STATUS_MARK|records/, "the shelf must not mark rows read");
});

test("the workspace opens the problem the hub sends it to, and old curriculum links land on the course", async () => {
  const board = await read("CodingBoard.tsx");
  assert.match(board, /initialProblem=\{searchParams\.get\("problem"\)\}/);
  const page = await read("../../app/coding/page.tsx");
  assert.match(page, /track === "curriculum"\) redirect\("\/learn\/fso"\)/);
});
