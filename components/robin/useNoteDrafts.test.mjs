import assert from "node:assert/strict";
import { beforeEach, afterEach, test } from "node:test";
import { deferred, hookHarness, settle } from "../../scripts/react-hook-harness.mjs";
import * as recovery from "../../lib/text-recovery.ts";

let storage, window, document, f;
const draft = id => ({ id, title: id, text: "Initial", notionParentId: "", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" });
const ok = () => new Response("{}", { status: 200 });
beforeEach(() => {
  storage = new Map();
  window = new EventTarget(); document = new EventTarget(); document.visibilityState = "visible";
  window.localStorage = {
    get length() { return storage.size; }, key: i => [...storage.keys()][i] ?? null,
    getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key),
  };
  globalThis.window = window;
  const timers = new Map(), requests = [];
  let timerId = 0, mounted = true;
  window.setTimeout = (callback, delay) => { assert.equal(delay, 400); timers.set(++timerId, callback); return timerId; };
  window.clearTimeout = id => timers.delete(id);
  const h = hookHarness(new URL("./useNoteDrafts.ts", import.meta.url), { "@/lib/text-recovery": recovery }, {
    window, document,
    fetch: (url, options) => {
      assert.equal(url, "/api/robin/notes");
      const request = { ...deferred(), ...options, data: JSON.parse(options.body) };
      requests.push(request); return request.promise;
    },
  });
  f = {
    requests, timers,
    view: () => h.render(() => h.exports.useNoteDrafts("Save not confirmed")),
    unmount() { if (mounted) { mounted = false; h.unmount(); } },
    async tick() { const ready = [...timers.values()]; timers.clear(); for (const callback of ready) callback(); await settle(); },
    async succeed(index = requests.length - 1) { requests[index].resolve(ok()); await settle(); },
    async fail(index = requests.length - 1) { requests[index].resolve(new Response(JSON.stringify({ error: "Fixture failed" }), { status: 503 })); await settle(); },
  };
  f.view().replaceDrafts([draft("a"), draft("b")]);
});
afterEach(async () => {
  f.unmount(); await settle();
  for (const request of f.requests) request.resolve(ok());
  await settle();
  for (const request of f.requests) request.resolve(ok());
  await settle();
  delete globalThis.window;
});
const copies = (id = "a") => recovery.readTextRecoveries("notes", id, "observer").drafts;
const texts = () => f.requests.filter(r => r.method === "PATCH").map(r => r.data.text);

test("edits synchronously back up merged title/text/destination before the debounce", async () => {
  assert.equal(f.view().status("a").state, "idle");
  assert.equal(f.view().patchDraft("a", { title: "Title" }), true);
  f.view().patchDraft("a", { text: "Text", notionParentId: "parent" });
  assert.deepEqual(copies()[0].fields, { title: "Title", text: "Text", notionParentId: "parent" });
  assert.equal(f.requests.length, 0);
  assert.equal(f.view().getDrafts()[0].text, "Text", "synchronous readers see the latest edit");
  assert.equal(f.view().status("a").state, "dirty");
  await f.tick();
  assert.equal(f.requests[0].keepalive, false);
  await f.succeed();
  assert.equal(f.view().status("a").state, "saved");
  assert.equal(copies().length, 0);
});

test("an older success cannot mark a queued or in-flight newer write saved", async () => {
  f.view().patchDraft("a", { text: "Older" }); await f.tick();
  f.view().patchDraft("a", { text: "Newer" }); await f.tick();
  assert.deepEqual(texts(), ["Older"]);
  await f.succeed(0);
  assert.deepEqual(texts(), ["Older", "Newer"]);
  assert.equal(f.view().status("a").state, "saving");
  assert.equal(copies()[0].fields.text, "Newer");
  await f.succeed(1);
  assert.equal(f.view().status("a").state, "saved");
});

test("obsolete failures neither requeue old text nor leave an obsolete alert", async () => {
  f.view().patchDraft("a", { text: "Old" }); await f.tick();
  f.view().patchDraft("a", { text: "New" }); await f.tick();
  await f.fail(0);
  assert.equal(f.view().status("a").error, null);
  await f.succeed(1);
  assert.equal(await f.view().flushSaves(), true);
  assert.deepEqual(texts(), ["Old", "New"]);
  assert.equal(f.view().status("a").error, null);
});

test("save state and failures belong to the note, not whichever note is open", async () => {
  f.view().patchDraft("a", { text: "A" }); await f.tick(); await f.fail();
  assert.equal(f.view().status("a").state, "error");
  assert.equal(f.view().status("b").state, "idle");
  assert.equal(f.view().status("b").error, null);
  f.view().patchDraft("b", { text: "B" }); await f.tick(); await f.succeed();
  assert.equal(f.view().status("b").state, "saved");
  assert.equal(f.view().status("a").state, "error");
  const retry = f.view().flushSaves("a"); await settle(); await f.succeed();
  assert.equal(await retry, true);
  assert.equal(f.view().status("a").error, null);
});

test("A → B → A retains its new recovery receipt when the first A is acknowledged", async () => {
  f.view().patchDraft("a", { text: "A" }); await f.tick();
  f.view().patchDraft("a", { text: "B" }); f.view().patchDraft("a", { text: "A" });
  const key = copies()[0].key;
  await f.succeed();
  assert.equal(f.view().status("a").state, "dirty");
  assert.equal(copies()[0].key, key);
  await f.tick(); await f.succeed();
  assert.equal(copies().length, 0);
});

test("network rejection is retryable and never strands the write queue", async () => {
  f.view().patchDraft("a", { text: "Retry" });
  const flush = f.view().flushSaves("a"); await settle();
  f.requests[0].reject(new Error("Network lost"));
  assert.equal(await flush, false);
  assert.match(f.view().status("a").error, /Network lost/);
  assert.equal(copies().length, 1);
  const retry = f.view().flushSaves("a"); const again = f.view().flushSaves("a"); await settle();
  assert.equal(f.requests.length, 2);
  await f.succeed(); assert.equal(await retry, true); assert.equal(await again, true);
});

test("failed backup warns, retains the previous copy, and does not block server saving", async () => {
  f.view().patchDraft("a", { text: "Prior backup" });
  window.localStorage.setItem = () => { throw new Error("Quota"); };
  assert.equal(f.view().patchDraft("a", { text: "Newest" }), false);
  assert.equal(f.view().status("a").backupFailed, true);
  assert.equal(copies()[0].fields.text, "Prior backup");
  await f.tick(); await f.succeed();
  assert.equal(f.view().status("a").backupFailed, false);
  assert.equal(copies().length, 0);
});

test("older tabs are offered, never automatically replayed or cleared by this tab's receipt", async () => {
  const prior = recovery.saveTextRecovery("notes", "a", "old:text", { text: "Old tab" });
  assert.equal(f.view().drafts[0].text, "Initial");
  f.view().patchDraft("a", { text: "Current tab" }); await f.tick(); await f.succeed();
  assert.equal(storage.get(prior.key), prior.value);
});

for (const lifecycle of ["pagehide", "hidden", "unmount"]) test(`${lifecycle} flushes once, with bounded keepalive and no delayed duplicate`, async () => {
  f.view().patchDraft("a", { text: "Last keystrokes" });
  if (lifecycle === "unmount") f.unmount();
  else if (lifecycle === "pagehide") window.dispatchEvent(new Event("pagehide"));
  else { document.visibilityState = "hidden"; document.dispatchEvent(new Event("visibilitychange")); }
  await settle();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].keepalive, true);
  await f.tick(); assert.equal(f.requests.length, 1);
  await f.succeed();
});

test("keepalive size is UTF-8 serialized bytes, never truncated characters", async () => {
  const text = "界".repeat(22_000);
  f.view().patchDraft("a", { text });
  window.dispatchEvent(new Event("pagehide")); await settle();
  assert.equal(f.requests[0].keepalive, false);
  assert.equal(f.requests[0].data.text, text);
  await f.succeed();
});

test("delete waits for accepted writes and fences edits, retries and background flushes", async () => {
  f.view().patchDraft("a", { text: "Failing in flight" }); await f.tick();
  const removal = f.view().deleteDraft("a");
  assert.equal(f.view().removing, true);
  assert.equal(f.view().patchDraft("a", { text: "Too late" }), false);
  assert.equal(await f.view().deleteDraft("a"), null);
  await f.fail(0); // Must not requeue this failure after removal began.
  assert.deepEqual(f.requests.map(r => r.method), ["PATCH", "DELETE"]);
  window.dispatchEvent(new Event("pagehide")); void f.view().flushSaves(); await f.tick();
  assert.equal(f.requests.length, 2);
  assert.equal(copies().length, 1, "wait for confirmed deletion before clearing backups");
  await f.succeed(1); assert.equal(await removal, true);
  assert.deepEqual(f.view().drafts.map(d => d.id), ["b"]);
  assert.equal(f.view().removing, false);
  assert.equal(copies().length, 0);
  assert.equal(f.view().patchDraft("a", { text: "Deleted" }), false);
  await f.view().flushSaves(); await f.tick(); assert.equal(f.requests.length, 2);
});

for (const reject of [false, true]) test(`failed delete (${reject ? "network" : "HTTP"}) restores unsent text for retry`, async () => {
  f.view().patchDraft("a", { text: "Keep me" });
  const removal = f.view().deleteDraft("a"); const rejected = assert.rejects(removal, /failed|offline/);
  await settle();
  assert.equal(f.requests[0].method, "DELETE", "discard a debounce only for this confirmed delete");
  if (reject) f.requests[0].reject(new Error("offline")); else await f.fail(0);
  await rejected;
  assert.equal(f.view().drafts[0].text, "Keep me");
  assert.equal(f.view().status("a").state, "dirty");
  assert.equal(f.view().removing, false);
  assert.equal(copies()[0].fields.text, "Keep me");
  const retry = f.view().flushSaves("a"); await settle(); await f.succeed();
  assert.equal(await retry, true);
});

test("archive publishes only after the latest save, then returns its receipt and removes the draft", async () => {
  f.view().patchDraft("a", { text: "Archive me" });
  const published = deferred(); let calls = 0;
  const archive = f.view().archiveDraft("a", () => { calls++; return published.promise; });
  await settle(); assert.equal(calls, 0);
  assert.equal(f.view().patchDraft("a", { text: "Too late" }), false);
  await f.succeed(); assert.equal(calls, 1);
  window.dispatchEvent(new Event("pagehide")); await f.tick();
  assert.equal(f.requests.length, 1);
  assert.equal(f.view().drafts.length, 2, "retain draft until destination acknowledges");
  published.resolve({ url: "obsidian://fixture" });
  assert.deepEqual(await archive, { url: "obsidian://fixture" });
  assert.deepEqual(f.view().drafts.map(d => d.id), ["b"]);
});

test("an unconfirmed last edit blocks archive publication and stays retryable", async () => {
  f.view().patchDraft("a", { text: "Not saved" }); let published = false;
  const archive = f.view().archiveDraft("a", async () => { published = true; return {}; });
  const rejected = assert.rejects(archive, /Save not confirmed/);
  await settle(); await f.fail(); await rejected;
  assert.equal(published, false);
  assert.equal(f.view().removing, false);
  assert.equal(f.view().status("a").state, "error");
  assert.equal(copies().length, 1);
  const retry = f.view().flushSaves("a"); await settle(); await f.succeed(); assert.equal(await retry, true);
});

test("failed archive keeps the saved draft editable and never clears another note's recovery", async () => {
  const other = recovery.saveTextRecovery("notes", "b", "old:text", { text: "B" });
  f.view().patchDraft("a", { text: "Saved first" });
  const archive = f.view().archiveDraft("a", async () => { throw new Error("Destination failed"); });
  const rejected = assert.rejects(archive, /Destination failed/);
  await settle(); await f.succeed(); await rejected;
  assert.equal(f.view().drafts[0].text, "Saved first");
  assert.equal(f.view().status("a").state, "saved");
  assert.equal(f.view().patchDraft("a", { text: "Can edit again" }), true);
  assert.equal(storage.get(other.key), other.value);
});
