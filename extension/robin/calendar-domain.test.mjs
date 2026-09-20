import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";

const previousDataDir = process.env.ROBIN_DATA_DIR;
const dataDir = mkdtempSync(join(tmpdir(), "robin-calendar-domain-"));
process.env.ROBIN_DATA_DIR = dataDir;

const { calendarBoard, createCalendarEvent } = await import("./calendar-domain.ts");
const { localDate } = await import("./dates.ts");
const { readEvents } = await import("./store.ts");

after(() => {
  rmSync(dataDir, { recursive: true, force: true });
  if (previousDataDir === undefined) delete process.env.ROBIN_DATA_DIR;
  else process.env.ROBIN_DATA_DIR = previousDataDir;
});

const write = (name, value) => writeFileSync(join(dataDir, name), JSON.stringify(value));
const connect = () => {
  write("secrets.json", { google: { clientId: "test-client", clientSecret: "test-secret" } });
  write("google.json", { refreshToken: "refresh", accessToken: "", expiresAt: 0 });
};
const disconnect = () => write("google.json", {});

beforeEach(() => {
  write("events.json", []);
  disconnect();
});

test("without Google the board is the local store, dated by the server", async () => {
  createCalendarEvent({ title: "Standup", date: "2030-01-02", start: "09:00" });

  const board = await calendarBoard();
  assert.deepEqual(board.events, readEvents());
  assert.equal(board.events[0].title, "Standup");
  assert.equal(board.google.connected, false);
  assert.equal(board.google.error, undefined);
  // Resolved here, not by the browser — the agent wrote its dates against it.
  assert.equal(board.today, localDate());
});

test("a Google failure degrades to local-only instead of throwing", async (t) => {
  createCalendarEvent({ title: "Standup", date: "2030-01-02" });
  connect();
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("getaddrinfo ENOTFOUND oauth2.googleapis.com");
  });

  const board = await calendarBoard();
  // The dashboard staying up with the user's own events beats an error page.
  assert.equal(board.events.length, 1);
  assert.equal(board.events[0].title, "Standup");
  assert.equal(board.google.connected, true);
  // …but the caller is still told what went wrong.
  assert.match(board.google.error, /ENOTFOUND/);
});

test("a board that cannot be read at all still reports connected", async (t) => {
  connect();
  t.mock.method(globalThis, "fetch", async () => new Response("nope", { status: 500 }));

  const board = await calendarBoard({ before: 0, after: 6 });
  assert.equal(board.google.connected, true);
  assert.ok(board.google.error);
  assert.deepEqual(board.events, []);
});

test("an event created through the domain shows up on the next board read", async () => {
  assert.deepEqual((await calendarBoard()).events, []);
  const event = createCalendarEvent({ title: "Dentist", date: "2030-03-04", start: "10:00", end: "11:00" });
  const board = await calendarBoard();
  assert.deepEqual(board.events.map((e) => e.id), [event.id]);
});
