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

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { POST, DELETE } = await jiti.import("./route.ts");
const previous = process.env.ROBIN_DATA_DIR;
const directory = mkdtempSync(join(tmpdir(), "robin-calendar-regression-"));
process.env.ROBIN_DATA_DIR = directory;
after(() => {
  rmSync(directory, { recursive: true, force: true });
  if (previous === undefined) delete process.env.ROBIN_DATA_DIR;
  else process.env.ROBIN_DATA_DIR = previous;
});
beforeEach(() => writeFileSync(join(directory, "events.json"), "[]"));
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

test("concurrent calendar writers read inside the same lock as the write", { timeout: 15_000 }, async () => {
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
