import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (name) => readFile(new URL(`./${name}`, import.meta.url), "utf8");
const source = await read("LearningHub.tsx");
const navigationSource = await read("RobinMargin.tsx");
const learnLayoutSource = await read("../../app/learn/layout.tsx");

/**
 * The track list, read out of the source rather than imported.
 *
 * Node's type stripping cannot load a .tsx file, so component modules are read
 * as text here — which still ties the assertion to the real list instead of a
 * copy of it that could quietly fall behind.
 */
const CODING_TRACKS = [...(await read("WorkspaceHeader.tsx"))
  .match(/CODING_TRACKS = \[([^\]]*)\]/)[1]
  .matchAll(/"([a-z]+)"/g)].map((match) => match[1]);

test("the hub links to every track of the workspace", async () => {
  assert.ok(CODING_TRACKS.length >= 2, "expected to find the track list");
  // The hub is the front door. A track with no entry here is a track nobody
  // finds, which is the whole failure mode a landing page exists to prevent.
  for (const track of CODING_TRACKS) {
    assert.match(source, new RegExp(`href: "/coding\\?track=${track}"`), `no entry for ${track}`);
  }
});

test("hub navigation lives in the shared shell and can challenge Basic Auth", () => {
  assert.match(learnLayoutSource, /<RobinShell>\{children\}<\/RobinShell>/);
  assert.doesNotMatch(navigationSource, /from ["']next\/link["']/);
  assert.match(navigationSource, /path: "\/dashboard"/);
  assert.match(navigationSource, /href: chatHref/);
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

test("only the practice entry carries a number", async () => {
  // The curriculum side keeps no progress, so the hub has nothing to fetch for
  // it and nothing to say about how far along it is. A poll appearing here
  // would mean the tracking came back somewhere.
  assert.match(source, /usePolledResource<PracticeResponse>\("\/api\/robin\/practice"/);
  assert.doesNotMatch(source, /usePolledResource<\w+>\("\/api\/robin\/study"/);

  const shelf = await read("LearningShelf.tsx");
  assert.doesNotMatch(shelf, /STATUS_MARK|records/, "the shelf must not mark rows read");
});

test("the workspace understands the track the hub sends it to", async () => {
  const board = await read("CodingBoard.tsx");

  assert.match(board, /searchParams\.get\("track"\)/);
  // Read during render, not in an effect: the parameter is in the request, so
  // the first paint can already be the right track instead of flipping to it.
  assert.match(board, /useState<CodingTrack>\(\s*isCodingTrack\(requestedTrack\)/);
});
