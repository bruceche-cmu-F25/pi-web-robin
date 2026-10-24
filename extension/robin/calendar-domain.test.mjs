import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { resetTaskStore } from "./task-store.test-support.mjs";

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
  resetTaskStore(dataDir);
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

test("explicit navigation windows are validated even without a Google connection", async () => {
  for (const options of [{ from: "2030-05-01" }, { to: "2030-05-31" },
    { from: "2030-02-31", to: "2030-03-03" }, { from: "2030-06-01", to: "2030-05-01" },
    { from: "2030-01-01", to: "2032-01-01" }]) await assert.rejects(calendarBoard(options));
  assert.equal((await calendarBoard({ from: "2030-05-01", to: "2030-05-31" })).today, localDate());
});
test("Google is fetched for the visible month, not a fixed window around today", async (t) => {
  connect();
  write("google.json", { refreshToken: "refresh", accessToken: "fixture", accessTokenExpiresAt: Date.now() + 3_600_000 });
  const urls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    urls.push(new URL(url));
    return Response.json({ items: [], summary: "Calendar" });
  });
  await calendarBoard({ from: "2034-12-25", to: "2035-02-04" });
  const request = urls.find((url) => url.pathname.endsWith("/events"));
  assert.ok(request);
  assert.equal(request.searchParams.get("timeMin"), new Date("2034-12-25T00:00:00").toISOString());
  assert.equal(request.searchParams.get("timeMax"), new Date("2035-02-04T23:59:59").toISOString());
});

test("repeated creation reuses the same occurrence, even with a fresh request id", () => {
  const input = { title: "Tech talk", date: "2030-03-04", start: "09:00", end: "10:00", location: "Room A" };
  const first = createCalendarEvent(input);
  const requestId = "b".repeat(32);
  const duplicate = createCalendarEvent({ ...input, title: "  TECH   talk ", start: "9:00", endDate: input.date }, requestId);
  assert.equal(duplicate.id, first.id);
  assert.equal(createCalendarEvent(input, requestId).id, first.id);
  assert.equal(readEvents().length, 1);
  assert.throws(() => createCalendarEvent({ ...input, date: "2030-03-05" }, requestId), /already saved/,
    "a reused request still cannot change its saved appointment");
  for (const changes of [{ date: "2030-03-05" }, { start: "09:30" }, { end: "10:30" }, { location: "Room B" }, { title: "Different talk" }]) {
    assert.notEqual(createCalendarEvent({ ...input, ...changes }).id, first.id);
  }
  assert.equal(readEvents().length, 6, "same title is not sufficient to collapse separate appointments");
});

test("an event created through the domain shows up on the next board read", async () => {
  assert.deepEqual((await calendarBoard()).events, []);
  const event = createCalendarEvent({ title: "Dentist", date: "2030-03-04", start: "10:00", end: "11:00" });
  const board = await calendarBoard();
  assert.deepEqual(board.events.map((e) => e.id), [event.id]);
});
