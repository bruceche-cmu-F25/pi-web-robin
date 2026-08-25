import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import {
  currentItem,
  currentTrack,
  setCurrentItem,
  setStudyTrack,
  trackOutline,
} from "./study-domain.ts";
import { writeStudyState } from "./store.ts";

const previousDataDir = process.env.ROBIN_DATA_DIR;
const dataDir = mkdtempSync(join(tmpdir(), "robin-study-"));
process.env.ROBIN_DATA_DIR = dataDir;

after(() => {
  rmSync(dataDir, { recursive: true, force: true });
  if (previousDataDir === undefined) delete process.env.ROBIN_DATA_DIR;
  else process.env.ROBIN_DATA_DIR = previousDataDir;
});

beforeEach(() => {
  writeStudyState({ currentItemId: undefined, track: undefined });
});

test("opening a resource remembers which one, and nothing else", () => {
  const opened = setCurrentItem("fastapi-tutorial");

  assert.equal("error" in opened, false);
  assert.equal(opened.item.id, "fastapi-tutorial");
  assert.equal(currentItem()?.item.id, "fastapi-tutorial");
});

/**
 * The whole point of the curriculum side: opening, re-opening, and reading are
 * not events the app has an opinion about. Only one file is ever written, and
 * it holds a pointer, not a history.
 */
test("nothing is recorded about the reading itself", () => {
  setCurrentItem("fastapi-tutorial");
  setCurrentItem("ddia");
  setCurrentItem("fastapi-tutorial");

  assert.deepEqual(readdirSync(dataDir), ["study-state.json"]);
});

test("opening a resource remembers the track it belongs to", () => {
  // This is how the mentor's default matches the page: the track comes from
  // the item itself when the caller does not say.
  setCurrentItem("ddia");

  assert.equal(currentTrack().id, "architecture");
});

test("the current item carries the module outcome it serves", () => {
  setCurrentItem("cosmic-python");
  const location = currentItem();

  assert.equal(location?.module.id, "architecture-in-the-small");
  assert.match(location.module.outcome, /domain logic/);
  assert.equal(location.track.id, "architecture");
});

test("a milestone opens like anything else", () => {
  setCurrentItem("js-core-milestone");

  assert.equal(currentItem()?.item.kind, "milestone");
});

test("unknown items and tracks come back as errors, not exceptions", () => {
  assert.match(setCurrentItem("no such thing").error, /No curriculum item/);
  assert.match(setStudyTrack("astrology").error, /No curriculum track/);
  assert.match(trackOutline("astrology").error, /No curriculum track/);
});

test("the outline is structure and outcomes, with no count in it", () => {
  const outline = trackOutline("python");

  assert.equal("error" in outline, false);
  assert.equal(outline.track.id, "python");

  const fastapi = outline.modules.find((entry) => entry.moduleId === "fastapi");
  assert.match(fastapi.outcome, /typed request and response models/);
  assert.deepEqual(
    fastapi.items.map((item) => item.id),
    ["fastapi-tutorial", "fastapi-milestone"],
  );
  // Nothing that could be read as progress: no status, no counts, no "left".
  assert.deepEqual(Object.keys(fastapi).sort(), ["items", "moduleId", "outcome", "title"]);
  assert.deepEqual(Object.keys(fastapi.items[0]).sort(), ["id", "kind", "title"]);
});

test("a state pointing at an item that no longer exists reads as nothing open", () => {
  // Curricula get edited. A dangling id must leave the workspace empty rather
  // than throwing on every poll.
  writeStudyState({ currentItemId: "a-resource-that-was-removed" });

  assert.equal(currentItem(), null);
});
