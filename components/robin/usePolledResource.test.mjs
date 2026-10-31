import assert from "node:assert/strict";
import { test } from "node:test";
import { deferred, hookHarness, settle } from "../../scripts/react-hook-harness.mjs";

function resourceHarness() {
  const requests = [];
  let visibility = "visible";
  const events = new Map();
  const timers = new Set();
  const intervals = new Map();
  const refreshes = new Set();
  const deadlines = new Set();
  const translate = key => key;
  const harness = hookHarness(new URL("./usePolledResource.ts", import.meta.url), {
    "./refreshBus": { onRefreshRequest(fn) { refreshes.add(fn); return () => refreshes.delete(fn); } },
    "@/hooks/useI18n": { useI18n: () => ({ t: translate }) },
  }, {
    fetch(url, options) {
      const pending = deferred();
      requests.push({ ...pending, url, signal: options?.signal });
      return pending.promise; // Deliberately ignores abort: stale transports must be harmless too.
    },
    document: {
      get visibilityState() { return visibility; },
      addEventListener: (name, fn) => events.set(name, fn),
      removeEventListener: (name) => events.delete(name),
    },
    setTimeout: fn => { deadlines.add(fn); return fn; },
    clearTimeout: fn => deadlines.delete(fn),
    setInterval: (fn, ms) => { timers.add(fn); intervals.set(fn, ms); return fn; },
    clearInterval: (fn) => { timers.delete(fn); intervals.delete(fn); },
  });
  return {
    ...harness, requests, timers, refreshes, intervals, deadlines,
    render: (url = "/a", enabled = true, interval = 60_000) => harness.render(() => harness.exports.usePolledResource(url, interval, enabled)),
    visibility(value) { visibility = value; events.get("visibilitychange")?.(); },
  };
}
const respond = (request, data) => request.resolve({ ok: true, text: async () => JSON.stringify(data), json: async () => data });

test("a timed-out read releases loading, preserves data, fences late bodies and can retry", async () => {
  const h = resourceHarness();
  try {
    h.render();
    respond(h.requests[0], { version: 1 }); await settle();
    const pending = h.render().refresh();
    assert.equal(h.render().loading, false, 'background reads must not hide existing rows');
    const body = deferred();
    h.requests[1].resolve({ ok: true, text: () => body.promise }); await settle();
    assert.equal(h.deadlines.size, 1);
    [...h.deadlines][0]();
    assert.equal(h.requests[1].signal.aborted, true);
    assert.equal(h.render().loading, false);
    assert.equal(h.render().error, "robin.common.readTimeout");
    assert.equal(h.render().data.version, 1);
    body.resolve(JSON.stringify({ version: "too late" })); await pending;
    assert.equal(h.render().data.version, 1);
    const retry = h.render().refresh(); respond(h.requests[2], { version: 2 }); await retry;
    assert.equal(h.render().error, null);
    assert.equal(h.render().data.version, 2);
    assert.equal(h.deadlines.size, 0);
    void h.render().refresh(); h.unmount();
    assert.equal(h.deadlines.size, 0, "unmount clears even a stalled request's deadline");
  } finally { h.unmount(); }
});

test("hidden workspace context pauses reads and refresh subscriptions without discarding data", async () => {
  const h = resourceHarness();
  try {
    h.render(); respond(h.requests[0], { version: 1 }); await settle();
    h.exports.ResourceActivity.value = false;
    assert.equal(h.render().data.version, 1);
    assert.equal(h.timers.size, 0);
    assert.equal(h.refreshes.size, 0);
    h.exports.ResourceActivity.value = true;
    h.render();
    assert.equal(h.requests.length, 2);
    assert.equal(h.timers.size, 1);
  } finally { h.unmount(); }
});

test("older responses and failures cannot overwrite the newest refresh", async () => {
  const h = resourceHarness();
  try {
    const resource = h.render();
    const newer = resource.refresh();
    respond(h.requests[1], { version: 2 });
    await newer;
    respond(h.requests[0], { version: 1 });
    await settle();
    assert.equal(h.render().data.version, 2);
    const stale = resource.refresh();
    const latest = resource.refresh();
    respond(h.requests[3], { version: 3 });
    await latest;
    h.requests[2].reject(new Error("old failure"));
    await stale;
    assert.equal(h.render().error, null);
    assert.equal(h.render().data.version, 3);
  } finally { h.unmount(); }
});

test("an unchanged poll keeps the same data object", async () => {
  const h = resourceHarness();
  try {
    const resource = h.render();
    respond(h.requests[0], { rows: [{ id: 1 }] });
    await settle();
    const first = h.render().data;
    const again = resource.refresh();
    respond(h.requests[1], { rows: [{ id: 1 }] });
    await again;
    assert.equal(h.render().data, first);
    const changed = resource.refresh();
    respond(h.requests[2], { rows: [{ id: 2 }] });
    await changed;
    assert.equal(h.render().data.rows[0].id, 2);
  } finally { h.unmount(); }
});

test("URL changes and unmount cancel requests without leaking data or subscriptions", async () => {
  const h = resourceHarness();
  h.render();
  respond(h.requests[0], { version: "a" });
  await settle();
  h.render("/b");
  assert.equal(h.render("/b").data, null);
  assert.equal(h.render("/b").loading, true);
  const stale = h.requests[1];
  h.render("/c");
  assert.equal(stale.signal.aborted, true);
  respond(stale, { version: "b" });
  await settle();
  assert.equal(h.render("/c").data, null);
  h.unmount();
  assert.equal(h.requests[2].signal.aborted, true);
  assert.equal(h.timers.size, 0);
  assert.equal(h.refreshes.size, 0);
});

test("a confirmed write updates the view even if refresh fails and fences older polls", async () => {
  const h = resourceHarness();
  try {
    const resource = h.render();
    respond(h.requests[0], { version: 1 });
    await settle();
    const old = resource.refresh();
    resource.updateData((current) => ({ ...current, version: 2 }));
    assert.equal(h.requests[1].signal.aborted, true);
    respond(h.requests[1], { version: 1 });
    await old;
    assert.equal(h.render().data.version, 2);
    const refresh = resource.refresh();
    h.requests[2].reject(new Error("offline"));
    await refresh;
    assert.equal(h.render().data.version, 2);
    // Clearing the old text cache matters: a later real rollback to version 1 must not be skipped.
    const rollback = resource.refresh();
    respond(h.requests[3], { version: 1 });
    await rollback;
    assert.equal(h.render().data.version, 1);
  } finally { h.unmount(); }
});

test("inactive panels retain data without automatic requests and fence cancelled responses", async () => {
  const h = resourceHarness();
  try {
    h.render("/a", false);
    assert.equal(h.requests.length, 0);
    assert.equal(h.timers.size, 0);
    h.render();
    respond(h.requests[0], { version: 1 });
    await settle();
    const data = h.render().data;
    const pending = h.render().refresh();
    h.render("/a", false);
    assert.equal(h.requests[1].signal.aborted, true);
    assert.equal(h.timers.size, 0);
    assert.equal(h.refreshes.size, 0);
    h.visibility("visible");
    assert.equal(h.requests.length, 2);
    respond(h.requests[1], { version: "stale" });
    await pending;
    assert.equal(h.render("/a", false).data, data);
    h.render();
    assert.equal(h.requests.length, 3, "returning refreshes immediately");
    assert.equal(h.render().data, data, "no loading flash on return");
    respond(h.requests[2], { version: 2 });
    await settle();
    assert.equal(h.render().data.version, 2);
  } finally { h.unmount(); }
});

test("adaptive polling is slow at rest, fast while running, and ignores callback identity", async () => {
  const h = resourceHarness();
  const render = () => h.render("/a", true, (data) => data?.running ? 4000 : 60_000);
  try {
    render();
    assert.deepEqual([...h.intervals.values()], [60_000]);
    render(); render();
    assert.equal(h.requests.length, 1);
    respond(h.requests[0], { running: true });
    await settle(); render();
    assert.deepEqual([...h.intervals.values()], [4000]);
    respond(h.requests.at(-1), { running: false });
    await settle(); render();
    assert.deepEqual([...h.intervals.values()], [60_000]);
    const count = h.requests.length;
    render();
    assert.equal(h.requests.length, count);
    h.visibility("hidden");
    assert.equal(h.timers.size, 0);
    h.visibility("visible");
    assert.equal(h.requests.length, count + 1);
  } finally { h.unmount(); }
});

test("hidden tabs stop polling, and visibility recovery refreshes immediately", () => {
  const h = resourceHarness();
  try {
    h.render();
    assert.equal(h.timers.size, 1);
    h.visibility("hidden");
    assert.equal(h.timers.size, 0);
    h.visibility("visible");
    assert.equal(h.requests.length, 2);
    assert.equal(h.timers.size, 1);
  } finally { h.unmount(); }
});
