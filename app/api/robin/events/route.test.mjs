import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { createJiti } from "jiti";
import { registerCalendarTools } from "../../../../extension/robin/calendar-tools.ts";
import { readEvents } from "../../../../extension/robin/store.ts";
import { resetTaskStore } from "../../../../extension/robin/task-store.test-support.mjs";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { POST, PATCH, DELETE } = await jiti.import("./route.ts");
const { eventFields } = await import("../../../../components/robin/calendar-edit.ts");
const previous = process.env.ROBIN_DATA_DIR;
const directory = mkdtempSync(join(tmpdir(), "robin-calendar-regression-"));
process.env.ROBIN_DATA_DIR = directory;
after(() => {
  rmSync(directory, { recursive: true, force: true });
  if (previous === undefined) delete process.env.ROBIN_DATA_DIR;
  else process.env.ROBIN_DATA_DIR = previous;
});
beforeEach(() => resetTaskStore(directory));
const tools = new Map();
registerCalendarTools({ registerTool: (tool) => tools.set(tool.name, tool) });
const create = (body) => tools.get("calendar_create_event").execute("test", body);
const request = (method, body, headers = {}) => new Request("http://localhost:30141/api/robin/events", {
  method, headers: { host: "localhost:30141", "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});
const event = { title: "Meeting", date: "2030-01-01", start: "15:00", end: "09:00" };

test("both calendar adapters reject reversed same-day times with an explicit endDate", async () => {
  for (const endDate of [undefined, event.date]) {
    const body = { ...event, endDate };
    assert.equal((await POST(request("POST", body))).status, 400);
    assert.match((await create(body)).content[0].text, /End .* before start/);
    assert.deepEqual(readEvents(), []);
  }
});

test("both adapters accept cross-day times, normalize same-day ranges and reject blank titles", async () => {
  const spanning = { ...event, endDate: "2030-01-02" };
  assert.equal((await POST(request("POST", spanning))).status, 200);
  assert.match((await create(spanning)).content[0].text, /Added/);
  assert.ok(readEvents().every((item) => item.endDate === "2030-01-02"));
  const sameDay = { ...event, end: "16:00", endDate: event.date };
  const response = await (await POST(request("POST", sameDay))).json();
  assert.equal(response.event.endDate, undefined);
  await create(sameDay);
  assert.equal(readEvents().at(-1).endDate, undefined);
  const count = readEvents().length;
  assert.equal((await POST(request("POST", { ...sameDay, title: " " }))).status, 400);
  assert.match((await create({ ...sameDay, title: " " })).content[0].text, /title is required/);
  assert.equal(readEvents().length, count);
});

test("calendar deletion preserves siblings and request security", async () => {
  await create({ title: "A", date: event.date });
  await create({ title: "B", date: event.date });
  const [a, b] = readEvents();
  assert.equal((await DELETE(request("DELETE", { id: a.id }, { origin: "https://evil.example" }))).status, 403);
  assert.equal((await POST(request("POST", event, { "content-type": "text/plain" }))).status, 415);
  assert.equal((await DELETE(request("DELETE", { id: a.id }))).status, 200);
  assert.deepEqual(readEvents(), [b]);
  assert.equal((await DELETE(request("DELETE", { id: a.id }))).status, 404);
});

test("calendar patch validates the merged event, preserves siblings/metadata, and clears optional fields", async () => {
  const { event: original } = await (await POST(request("POST", { title: "Trip", date: "2030-01-01", endDate: "2030-01-03", start: "15:00", end: "09:00", location: "Office" }))).json();
  await create({ title: "Sibling", date: "2030-01-01" });
  const patch = (changes, expected = eventFields(original)) => PATCH(request("PATCH", { id: original.id, changes, expected }));
  for (const changes of [{ date: "2030-01-04" }, { endDate: "" }, { start: "25:00" }, { title: " " }, { date: "2030-02-31" }, { start: null }, { location: 123 }]) {
    assert.equal((await patch(changes)).status, 400, JSON.stringify(changes));
    assert.deepEqual(readEvents()[0], original);
  }
  const response = await patch({ date: "2030-01-02", endDate: "2030-01-04" });
  assert.equal(response.status, 200);
  const updated = (await response.json()).event;
  assert.equal(updated.id, original.id);
  assert.equal(updated.createdAt, original.createdAt);
  assert.equal(updated.location, "Office");
  assert.equal(readEvents()[1].title, "Sibling");
  const cleared = await patch({ start: "", end: "", endDate: "", location: "" }, eventFields(updated));
  assert.equal(cleared.status, 200);
  assert.deepEqual(Object.keys((await cleared.json()).event).sort(), ["createdAt", "date", "id", "title"]);
});

test("calendar patch rejects stale snapshots, unknown ids, malformed input, and cross-origin writes", async () => {
  const { event: original } = await (await POST(request("POST", { title: "A", date: "2030-01-01" }))).json();
  const body = { id: original.id, expected: eventFields(original), changes: { date: "2030-01-02" } };
  assert.equal((await PATCH(request("PATCH", body, { origin: "https://evil.example" }))).status, 403);
  assert.equal((await PATCH(request("PATCH", body, { "content-type": "text/plain" }))).status, 415);
  for (const invalid of [null, {}, { ...body, expected: {} }, { ...body, changes: null }]) {
    assert.equal((await PATCH(request("PATCH", invalid))).status, 400);
  }
  assert.equal((await PATCH(request("PATCH", { ...body, id: "google:external" }))).status, 404);
  assert.equal((await PATCH(request("PATCH", body))).status, 200);
  assert.equal((await PATCH(request("PATCH", { ...body, changes: { date: "2030-01-03" } }))).status, 409);
  assert.equal(readEvents()[0].date, "2030-01-02");
  await DELETE(request("DELETE", { id: original.id }));
  assert.equal((await PATCH(request("PATCH", body))).status, 404);
  assert.equal(readEvents().length, 0);
});

test("retrying a calendar create after a lost response does not insert a duplicate", async () => {
  const body = { title: "Retry safely", date: "2030-01-01", requestId: "a".repeat(32) };
  const first = await POST(request("POST", body));
  const firstEvent = (await first.json()).event;
  const retry = await POST(request("POST", body));
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).event.id, firstEvent.id);
  assert.equal(readEvents().length, 1);
  assert.equal((await POST(request("POST", { ...body, title: "Changed after a lost response" }))).status, 400);
  assert.equal(readEvents()[0].title, "Retry safely");
  for (const requestId of ["", "google:1", 12, null]) {
    assert.equal((await POST(request("POST", { ...body, requestId }))).status, 400);
  }
});

test("legacy JSON concurrent calendar writers read inside the same lock as the write", { timeout: 15_000 }, async () => {
  // This pins the legacy lock regression; SQLite contention is tested separately.
  for (const name of ["task-storage.json", "tasks.sqlite", "tasks.sqlite-wal", "tasks.sqlite-shm"]) rmSync(join(directory, name), { force: true });
  const lock = join(directory, "events.json.lock");
  mkdirSync(lock);
  const worker = join(directory, "writer.mjs");
  // Signal the parent at the first lock contention, not after an arbitrary sleep.
  // Before the fix both writers already hold a stale [] snapshot at this point.
  writeFileSync(worker, `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const mkdir = fs.mkdirSync;
    let signalled = false;
    fs.mkdirSync = (...args) => {
      try { return mkdir(...args); } catch (error) {
        if (String(args[0]).endsWith('events.json.lock') && error.code === 'EEXIST' && !signalled) {
          signalled = true;
          process.send('waiting');
        }
        throw error;
      }
    };
    syncBuiltinESMExports();
    const { registerCalendarTools } = await import(${JSON.stringify(new URL("../../../../extension/robin/calendar-tools.ts", import.meta.url).href)});
    const tools = new Map();
    registerCalendarTools({ registerTool: tool => tools.set(tool.name, tool) });
    await tools.get('calendar_create_event').execute('test', { title: process.argv[2], date: '2030-01-01' });
    process.disconnect();
  `);
  const children = ["A", "B"].map((title) => fork(worker, [title], {
    execArgv: ["--experimental-strip-types"],
    env: { ...process.env, ROBIN_DATA_DIR: directory },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  }));
  try {
    const exits = children.map((child) => once(child, "exit"));
    await Promise.all(children.map(async (child) => {
      const [message] = await once(child, "message");
      assert.equal(message, "waiting");
    }));
    rmSync(lock, { recursive: true });
    for (const [code] of await Promise.all(exits)) assert.equal(code, 0);
    assert.deepEqual(readEvents().map((item) => item.title).sort(), ["A", "B"]);
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill();
    rmSync(lock, { recursive: true, force: true });
  }
});
