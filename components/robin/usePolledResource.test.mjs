import assert from "node:assert/strict";
import { test } from "node:test";
import { deferred, hookHarness, settle } from "../../scripts/react-hook-harness.mjs";

function resourceHarness() {
  const requests = [];
  let visibility = "visible";
  const events = new Map();
  const timers = new Set();
  const refreshes = new Set();
  const harness = hookHarness(new URL("./usePolledResource.ts", import.meta.url), {
    "./refreshBus": { onRefreshRequest(fn) { refreshes.add(fn); return () => refreshes.delete(fn); } },
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
    setInterval: (fn) => { timers.add(fn); return fn; },
    clearInterval: (fn) => timers.delete(fn),
  });
  return {
    ...harness, requests, timers, refreshes,
    render: (url = "/a") => harness.render(() => harness.exports.usePolledResource(url)),
    visibility(value) { visibility = value; events.get("visibilitychange")?.(); },
  };
}
const respond = (request, data) => request.resolve({ ok: true, json: async () => data });

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
