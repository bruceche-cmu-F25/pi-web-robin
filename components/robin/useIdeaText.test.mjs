import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { deferred, hookHarness, settle } from "../../scripts/react-hook-harness.mjs";
import * as recovery from "../../lib/text-recovery.ts";

let entries, window, harnesses;
beforeEach(() => {
  entries = new Map();
  window = new EventTarget();
  window.localStorage = {
    get length() { return entries.size; }, key: i => [...entries.keys()][i] ?? null,
    getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key),
  };
  globalThis.window = window;
  harnesses = [];
});
afterEach(() => { for (const h of harnesses) h.unmount(); delete globalThis.window; });

function fixture(id = "idea") {
  const server = { id, name: "Initial name", note: "Initial note" };
  const requests = [], timers = new Map();
  let timerId = 0;
  const h = hookHarness(new URL("./useIdeaText.ts", import.meta.url), {
    "@/lib/text-recovery": recovery,
  }, {
    window,
    setTimeout: (callback, delay) => { assert.equal(delay, 1000); timers.set(++timerId, callback); return timerId; },
    clearTimeout: id => timers.delete(id),
  });
  harnesses.push(h);
  const persist = patch => {
    const pending = deferred();
    requests.push({ patch, ...pending });
    return pending.promise.then(ok => { if (ok) Object.assign(server, patch); return ok; });
  };
  return {
    server, requests, timers,
    view: () => h.render(() => h.exports.useIdeaText({ ...server }, persist)),
    async tick() { const ready = [...timers.values()]; timers.clear(); for (const callback of ready) callback(); await settle(); },
    async succeed(index = requests.length - 1) { requests[index].resolve(true); await settle(); },
    unmount: () => h.unmount(),
  };
}
const copies = (id = "idea") => recovery.readTextRecoveries("product", id, "observer").drafts;
const warned = () => !window.dispatchEvent(new Event("beforeunload", { cancelable: true }));
const patches = f => JSON.parse(JSON.stringify(f.requests.map(r => r.patch)));

test("editing backs up synchronously; notes debounce, names wait for blur, fields stay independent", async () => {
  const f = fixture();
  assert.equal(f.view().state, "saved");
  assert.equal(warned(), false);
  assert.equal(f.view().edit("name", "  New name  "), true);
  f.view().edit("note", "New note");
  assert.equal(copies().length, 2);
  assert.equal(f.requests.length, 0);
  assert.equal(f.view().state, "dirty");
  assert.equal(warned(), true);
  await f.tick();
  assert.deepEqual(patches(f), [{ note: "New note" }]);
  assert.equal(f.view().state, "saving");
  await f.succeed();
  assert.equal(f.view().name, "  New name  ");
  assert.equal(copies().length, 1, "note receipt must not clear the name backup");
  const nameSave = f.view().save("name"); await settle();
  assert.deepEqual(patches(f).at(-1), { name: "New name" });
  await f.succeed(); await nameSave;
  assert.equal(f.view().name, "New name");
  assert.equal(f.view().state, "saved");
  assert.equal(warned(), false);
  assert.equal(copies().length, 0);
});

test("blur flushes a note once and cancels its debounce", async () => {
  const f = fixture(); f.view().edit("note", "Blur");
  const save = f.view().save("note"); await settle();
  await f.tick();
  await f.view().save("note");
  assert.equal(f.requests.length, 1);
  await f.succeed(); await save;
  assert.equal(f.view().state, "saved");
});

test("both fields serialize; an obsolete failure neither resurrects text nor poisons newer success", async () => {
  const f = fixture(); f.view().edit("note", "Old"); await f.tick();
  f.view().edit("name", "New name"); const nameSave = f.view().save("name");
  f.view().edit("note", "Newest"); await f.tick();
  assert.equal(f.requests.length, 1);
  f.requests[0].reject(new Error("Offline")); await settle();
  assert.equal(f.view().state, "saving");
  assert.deepEqual(patches(f).at(-1), { name: "New name" });
  await f.succeed(); await nameSave;
  assert.deepEqual(patches(f).at(-1), { note: "Newest" });
  await f.succeed();
  assert.equal(f.view().note, "Newest");
  assert.equal(f.view().state, "saved");
  await f.view().save("note"); await f.tick();
  assert.equal(f.requests.length, 3);
});

test("A → B → A is a new revision even when an old receipt contains identical text", async () => {
  const f = fixture(); f.view().edit("note", "A"); await f.tick();
  f.view().edit("note", "B"); f.view().edit("note", "A");
  const key = copies()[0].key;
  await f.succeed(0);
  assert.equal(f.view().note, "A");
  assert.equal(f.view().state, "dirty");
  assert.equal(copies()[0].key, key);
  await f.tick(); await f.succeed();
  assert.equal(f.view().state, "saved");
  assert.equal(copies().length, 0);
});

test("reverting a name to the server snapshot still queues behind an older rename", async () => {
  const f = fixture(); f.view().edit("name", "Temporary");
  const first = f.view().save("name"); await settle();
  f.view().edit("name", "Initial name");
  const last = f.view().save("name"); await settle();
  assert.equal(f.requests.length, 1);
  await f.succeed(0); await first;
  assert.equal(f.view().name, "Initial name");
  assert.equal(copies()[0].fields.name, "Initial name");
  await f.succeed(1); await last;
  assert.equal(f.server.name, "Initial name");
  assert.equal(f.view().state, "saved");
});

test("latest failure retains text and backup; overlapping retry clicks send once", async () => {
  const f = fixture(); f.view().edit("note", "Retry"); await f.tick();
  f.requests[0].resolve(false); await settle();
  assert.equal(f.view().state, "error");
  assert.equal(copies()[0].fields.note, "Retry");
  const retry = f.view().retry(); await f.view().retry(); await settle();
  assert.equal(f.requests.length, 2);
  await f.succeed(); await retry;
  assert.equal(f.view().state, "saved");
  assert.equal(copies().length, 0);
});

test("empty names stay unsaved; Escape discards only the name", () => {
  const f = fixture(); f.view().edit("name", "   "); f.view().edit("note", "Keep");
  void f.view().save("name");
  assert.equal(f.requests.length, 0);
  assert.equal(f.view().state, "dirty");
  f.view().discardName();
  assert.equal(f.view().name, "Initial name");
  assert.equal(f.view().note, "Keep");
  assert.equal(copies().length, 1);
  assert.equal(copies()[0].fields.note, "Keep");
});

test("failed local backup preserves the prior copy and warns without blocking server save", async () => {
  const f = fixture(); f.view().edit("note", "Recoverable");
  window.localStorage.setItem = () => { throw new Error("Quota"); };
  assert.equal(f.view().edit("note", "Newest"), false);
  assert.equal(f.view().backupFailed, true);
  assert.equal(copies()[0].fields.note, "Recoverable");
  await f.tick(); await f.succeed();
  assert.equal(f.server.note, "Newest");
  assert.equal(f.view().backupFailed, false);
  assert.equal(copies().length, 0);
});

test("restoration uses normal edit semantics and acknowledges only this mount's receipts", async () => {
  const old = recovery.saveTextRecovery("product", "idea", "old:note", { note: "Old tab" });
  const f = fixture();
  assert.equal(f.view().note, "Initial note", "old backups never replay automatically");
  const writer = f.view().writer;
  f.view().edit("note", "Restored and edited"); await f.tick(); await f.succeed();
  assert.equal(f.view().writer, writer);
  assert.equal(entries.get(old.key), old.value, "save may clear only its own receipt");
});

test("unmount cancels unsent debounce and warning, preserving recovery for reopening", async () => {
  const f = fixture(); f.view().edit("note", "Unsent"); f.view();
  assert.equal(warned(), true);
  f.unmount(); await f.tick();
  assert.equal(f.requests.length, 0);
  assert.equal(warned(), false);
  assert.equal(copies()[0].fields.note, "Unsent");
});

test("different ideas have independent write queues", async () => {
  const a = fixture("a"), b = fixture("b");
  a.view().edit("note", "A"); await a.tick();
  b.view().edit("note", "B"); await b.tick(); await b.succeed();
  assert.equal(a.view().state, "saving");
  assert.equal(b.view().state, "saved");
  assert.equal(copies("a").length, 1);
  assert.equal(copies("b").length, 0);
  await a.succeed();
});

test("delete drains accepted writes, blocks all later text callbacks, and clears only this idea", async () => {
  const other = recovery.saveTextRecovery("product", "other", "tab:note", { note: "Keep" });
  const f = fixture();
  f.view().edit("name", "Queued name"); f.view().edit("note", "Unsent note");
  const retry = f.view().retry(); await settle();
  const destroy = deferred(); let calls = 0;
  const remove = f.view().remove(() => { calls++; return destroy.promise; });
  assert.equal(f.view().removing, true);
  assert.equal(calls, 0);
  assert.equal(f.view().edit("note", "Too late"), false);
  await f.view().save("name"); await f.view().save("note"); await f.view().retry();
  assert.equal(await f.view().remove(async () => { throw new Error("duplicate delete"); }), false);
  await f.succeed(); await retry; await settle();
  assert.equal(calls, 1);
  await f.tick();
  assert.equal(f.requests.length, 1, "retry's second field must not start past deletion");
  assert.equal(copies().length, 1, "unsent note survives until DELETE is acknowledged");
  destroy.resolve(true); assert.equal(await remove, true);
  assert.equal(copies().length, 0);
  assert.equal(entries.get(other.key), other.value);
  await f.view().retry(); await f.tick();
  assert.equal(f.requests.length, 1);
  assert.equal(f.view().state, "saved");
  assert.equal(warned(), false);
});

for (const throws of [false, true]) test(`failed delete (${throws ? "rejection" : "false"}) reopens the editor with unsent note and recovery`, async () => {
  const f = fixture(); f.view().edit("note", "Keep after delete fails");
  const removing = f.view().remove(async () => { if (throws) throw new Error("Offline"); return false; });
  if (throws) await assert.rejects(removing, /Offline/);
  else assert.equal(await removing, false);
  assert.equal(f.view().removing, false);
  assert.equal(f.view().note, "Keep after delete fails");
  assert.equal(copies().length, 1);
  await f.tick(); assert.equal(f.requests.length, 0, "failed deletion does not auto-replay");
  const retry = f.view().retry(); await settle(); await f.succeed(); await retry;
  assert.equal(f.server.note, "Keep after delete fails");
  assert.equal(f.view().state, "saved");
});
