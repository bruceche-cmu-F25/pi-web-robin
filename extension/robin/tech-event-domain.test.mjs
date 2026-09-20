import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";

const previousDataDir = process.env.ROBIN_DATA_DIR;
const dataDir = mkdtempSync(join(tmpdir(), "robin-tech-events-"));
process.env.ROBIN_DATA_DIR = dataDir;

const { setTechEventFlags, techEventBoard, techEventScanStatus } =
  await import("./tech-event-domain.ts");
const { readTechEvents, writeTechEvents, writeTechEventScanState } = await import("./store.ts");
const { SCAN_INTERVAL_MS } = await import("./tech-events.ts");

after(() => {
  rmSync(dataDir, { recursive: true, force: true });
  if (previousDataDir === undefined) delete process.env.ROBIN_DATA_DIR;
  else process.env.ROBIN_DATA_DIR = previousDataDir;
});

const NOW = Date.parse("2026-09-15T12:00:00.000Z");
const at = (offsetMs) => new Date(NOW + offsetMs).toISOString();
const DAY = 24 * 60 * 60 * 1_000;

const event = (id, startAt, extra = {}) => ({
  id,
  title: `Event ${id}`,
  startAt,
  url: `https://example.com/${id}`,
  source: "test",
  topic: "ai",
  score: 1,
  discoveredAt: at(-DAY),
  ...extra,
});

beforeEach(() => {
  writeTechEvents([]);
  writeTechEventScanState({ startedAt: at(-DAY) });
});

test("the board drops events that have already happened and keeps the file in step", () => {
  writeTechEvents([
    event("past", at(-8 * DAY)),
    event("soon", at(2 * DAY)),
    event("later", at(9 * DAY)),
  ]);

  const board = techEventBoard({ autoScan: false, now: NOW });
  assert.deepEqual(board.events.map((e) => e.id), ["soon", "later"]);
  // Retention happens on read, so the stored file no longer carries the past one.
  assert.deepEqual(readTechEvents().map((e) => e.id), ["soon", "later"]);
});

test("a board with nothing expired leaves the file alone", () => {
  writeTechEvents([event("soon", at(2 * DAY))]);
  const before = JSON.stringify(readTechEvents());
  techEventBoard({ autoScan: false, now: NOW });
  assert.equal(JSON.stringify(readTechEvents()), before);
});

test("the board sorts soonest first, and the stronger match leads within a day", () => {
  const sameDay = at(3 * DAY);
  writeTechEvents([
    event("weak", sameDay, { score: 1 }),
    event("far", at(20 * DAY), { score: 9 }),
    event("strong", sameDay, { score: 5 }),
  ]);
  assert.deepEqual(
    techEventBoard({ autoScan: false, now: NOW }).events.map((e) => e.id),
    ["strong", "weak", "far"],
  );
});

test("saved and hidden are stored by presence, never as false", () => {
  writeTechEvents([event("one", at(2 * DAY))]);

  const saved = setTechEventFlags("one", { saved: true });
  assert.equal("error" in saved, false);
  assert.equal(saved.saved, true);
  assert.equal(readTechEvents()[0].saved, true);

  const cleared = setTechEventFlags("one", { saved: false });
  // Absent, not false — that is what lets a rescan tell "decided against"
  // from "never seen".
  assert.ok(!("saved" in cleared));
  assert.ok(!("saved" in readTechEvents()[0]));
});

test("one flag can be set without disturbing the other", () => {
  writeTechEvents([event("one", at(2 * DAY), { saved: true })]);
  const hidden = setTechEventFlags("one", { hidden: true });
  assert.equal(hidden.saved, true);
  assert.equal(hidden.hidden, true);
});

test("the flags never let a reader edit a fact the host published", () => {
  writeTechEvents([event("one", at(2 * DAY), { title: "Real title" })]);
  setTechEventFlags("one", { saved: true });
  assert.equal(readTechEvents()[0].title, "Real title");
  assert.equal(readTechEvents()[0].url, "https://example.com/one");
});

test("an unknown id is an error, not a silent no-op", () => {
  const missing = setTechEventFlags("nope", { saved: true });
  assert.equal(missing.error, 'No event with id "nope"');
  assert.equal(setTechEventFlags("", { saved: true }).error, "id is required");
});

test("autoScan:false reads without starting a sweep even when the week is up", () => {
  writeTechEventScanState({ startedAt: at(-SCAN_INTERVAL_MS - DAY) });
  const board = techEventBoard({ autoScan: false, now: NOW });
  assert.equal(board.scanning, false);
  assert.equal(techEventScanStatus().scanning, false);
});

test("the scan status is readable without touching the event list", () => {
  const startedAt = at(-2 * DAY);
  writeTechEventScanState({ startedAt });
  const status = techEventScanStatus();
  assert.equal(status.scan.startedAt, startedAt);
  assert.equal(status.scanning, false);
});
