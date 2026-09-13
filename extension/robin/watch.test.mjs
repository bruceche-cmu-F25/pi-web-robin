import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { WATCH_COURSES, WATCH_ITEM_IDS, watchPlan, watchUrl } from "./watch.ts";

const previous = process.env.ROBIN_DATA_DIR;
const directory = mkdtempSync(join(tmpdir(), "robin-watch-"));
process.env.ROBIN_DATA_DIR = directory;
const { setWatched, watchSnapshot } = await import("./watch-domain.ts");
after(() => {
  rmSync(directory, { recursive: true, force: true });
  if (previous === undefined) delete process.env.ROBIN_DATA_DIR;
  else process.env.ROBIN_DATA_DIR = previous;
});

const cs50w = WATCH_COURSES.find((course) => course.id === "cs50w");

test("every lecture id is unique across the list, so one tick never lands twice", () => {
  const all = WATCH_COURSES.flatMap((course) => course.items.map((item) => item.id));
  assert.equal(new Set(all).size, all.length);
  assert.equal(WATCH_ITEM_IDS.size, all.length);
});

test("a lecture opens inside its playlist; a series opens the series", () => {
  assert.equal(watchUrl(cs50w, cs50w.items[0]), `https://www.youtube.com/watch?v=${cs50w.items[0].id}&list=${cs50w.playlist}`);
  const ninja = WATCH_COURSES.find((course) => course.series);
  assert.match(watchUrl(ninja, ninja.items[0]), /^https:\/\/www\.youtube\.com\/playlist\?list=PL/);
});

test("next skips optional lectures and up next follows the course last ticked", () => {
  const [html, git, python, django, sql] = cs50w.items;
  assert.ok(python.optional && django.optional);
  const plan = watchPlan([html.id, git.id]);
  assert.equal(plan.courses.find((course) => course.id === "cs50w").nextId, sql.id);
  assert.deepEqual(plan.upNext, { courseId: "cs50w", itemId: sql.id });

  const missing = WATCH_COURSES.find((course) => course.id === "missing");
  const switched = watchPlan([html.id, missing.items[0].id]);
  assert.deepEqual(switched.upNext, { courseId: "missing", itemId: missing.items[1].id });
  assert.equal(watchPlan(["not-a-lecture"]).watched, 0);
});

test("with nothing to resume, up next is the first course with a lecture left", () => {
  assert.deepEqual(watchPlan([]).upNext, { courseId: "cs50w", itemId: cs50w.items[0].id });
  const required = cs50w.items.filter((item) => !item.optional).map((item) => item.id);
  const ninja = WATCH_COURSES.find((course) => course.id === "netninja");
  assert.deepEqual(watchPlan(required).upNext, { courseId: "netninja", itemId: ninja.items[0].id });
});

test("ticks persist in order, undo removes, and unknown ids are refused", () => {
  const [first, second] = cs50w.items;
  setWatched(second.id, true);
  setWatched(first.id, true);
  setWatched(first.id, true);
  assert.deepEqual(watchSnapshot().watchedIds, [second.id, first.id]);
  setWatched(second.id, false);
  assert.deepEqual(watchSnapshot().watchedIds, [first.id]);
  assert.throws(() => setWatched("nope", true), /Unknown lecture/);
});
