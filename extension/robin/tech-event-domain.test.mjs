import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";

const previousDataDir = process.env.ROBIN_DATA_DIR;
const dataDir = mkdtempSync(join(tmpdir(), "robin-tech-events-"));
process.env.ROBIN_DATA_DIR = dataDir;

const { setTechEventFlags, techEventBoard, techEventPage, techEventScanStatus } =
  await import("./tech-event-domain.ts");
const { readTechEventDetails, readTechEvents, writeTechEvents, writeTechEventScanState } = await import("./store.ts");
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

/** A fetch context that serves one Luma event page and records what it was asked for. */
function stubPage(body = "Build night.") {
  const calls = [];
  const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { initialData: { data: {
      event: {},
      hosts: [{ name: "Ada" }],
      description_mirror: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: body }] }] },
    } } } },
  })}</script>`;
  return {
    calls,
    ctx: {
      fetchJson: async () => ({}),
      fetchText: async (url) => {
        calls.push(url);
        if (body === null) throw new Error("HTTP 503");
        return html;
      },
    },
  };
}

test("an event page reads the stored Luma URL once, then serves the cached copy", async () => {
  writeTechEvents([event("luma:a", at(DAY), { url: "https://luma.com/abc" })]);
  const first = stubPage();
  const page = await techEventPage("luma:a", { now: NOW, ctx: first.ctx });
  assert.deepEqual(first.calls, ["https://luma.com/abc"]);
  assert.equal(page.detail.hosts[0].name, "Ada");

  const second = stubPage("Changed.");
  const cached = await techEventPage("luma:a", { now: NOW + 60_000, ctx: second.ctx });
  assert.equal(second.calls.length, 0, "a fresh copy is not refetched");
  assert.equal(cached.detail.description[0].inlines[0].text, "Build night.");
});

test("a failed read keeps the last good copy and says why", async () => {
  writeTechEvents([event("luma:b", at(DAY), { url: "https://luma.com/b" })]);
  await techEventPage("luma:b", { now: NOW, ctx: stubPage().ctx });
  const failed = await techEventPage("luma:b", { now: NOW, refresh: true, ctx: stubPage(null).ctx });
  assert.match(failed.detailError, /503/);
  assert.equal(failed.detail.hosts[0].name, "Ada");
});

test("only events on the board can be opened, and only on Luma's host", async () => {
  writeTechEvents([event("luma:c", at(DAY), { url: "https://evil.example/c" })]);
  assert.deepEqual(await techEventPage("luma:missing", { now: NOW, ctx: stubPage().ctx }), {
    error: 'No event with id "luma:missing"',
  });
  const stub = stubPage();
  const page = await techEventPage("luma:c", { now: NOW, ctx: stub.ctx });
  assert.equal(stub.calls.length, 0);
  assert.match(page.detailError, /untrusted hostname/);
});

test("the detail cache is pruned to what is still on the board", async () => {
  writeTechEvents([event("luma:d", at(DAY), { url: "https://luma.com/d" }), event("luma:e", at(DAY), { url: "https://luma.com/e" })]);
  await techEventPage("luma:d", { now: NOW, ctx: stubPage().ctx });
  writeTechEvents([event("luma:e", at(DAY), { url: "https://luma.com/e" })]);
  await techEventPage("luma:e", { now: NOW, ctx: stubPage().ctx });
  assert.deepEqual(Object.keys(readTechEventDetails()), ["luma:e"]);
});
