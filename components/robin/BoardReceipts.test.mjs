import assert from "node:assert/strict";
import { test } from "node:test";
import { deferred, findElement, hookHarness, settle } from "../../scripts/react-hook-harness.mjs";

function resourceHarness() {
  const requests = [];
  const h = hookHarness(new URL("./usePolledResource.ts", import.meta.url), {
    "./refreshBus": { onRefreshRequest: () => () => {} },
    "@/hooks/useI18n": { useI18n: () => ({ t: String }) },
  }, {
    Error,
    fetch(url, init = {}) {
      const p = deferred(); requests.push({ ...p, url, method: init.method ?? "GET", body: init.body && JSON.parse(init.body), signal: init.signal }); return p.promise;
    },
    document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
    setInterval: () => 1, clearInterval() {},
  });
  let current;
  return {
    requests,
    module: { ...h.exports, usePolledResource: (...args) => (current = h.render(() => h.exports.usePolledResource(...args))) },
    current: () => current,
    reply(request, body, status = 200) { request.resolve({ ok: status < 400, status, text: async () => JSON.stringify(body), json: async () => body }); },
    async offline() { await settle(); this.reply(requests.at(-1), { error: "Read offline" }, 503); await settle(); },
    unmount: () => h.unmount(),
  };
}
const i18n = { useI18n: () => ({ t: key => key, locale: "en" }) };
const event = { id: "event", title: "Original", saved: false, hidden: false, startAt: "2030-01-01T18:00:00Z", topics: [], matched: [] };
function eventsHarness() {
  const resource = resourceHarness();
  const h = hookHarness(new URL("./EventsBoard.tsx", import.meta.url), {
    "next/link": { default: "a" }, "next/navigation": { useSearchParams: () => new URLSearchParams() },
    "./board-navigation": { eventsView: () => ({ query: "", topic: "all", day: null, savedOnly: false, showHidden: false }) },
    "./useBoardNavigation": { useBoardNavigation: () => ({ scrollRef: {}, updateView() {} }) },
    "@/extension/robin/tech-events": { TECH_EVENT_TOPICS: [], rateTechEventForFullStackAi: () => ({ overall: 4, conflicts: [] }) },
    "@/hooks/useI18n": i18n,
    "./techEventView": { localDay: e => e.startAt.slice(0, 10), formatDay: d => d },
    "./EventsBoard.module.css": { default: {} },
    "./usePolledResource": { ...resource.module, usePolledResource: (...args) => args[0] === "/api/robin/events" ? { data: { events: [] } } : resource.module.usePolledResource(...args) },
  });
  const render = () => h.render(() => h.exports.EventsBoard());
  return {
    ...resource, render,
    row: () => findElement(render(), n => n.type?.name === "EventRow")?.props,
    snapshot: () => { render(); return resource.current().data; },
    async load() { render(); resource.reply(resource.requests[0], { events: [event], scan: null, scanning: false, today: "2030-01-01" }); await settle(); render(); },
    unmount() { h.unmount(); resource.unmount(); },
  };
}
for (const flag of ["saved", "hidden"]) test(`event ${flag} adopts the full receipt despite stale and failed reads`, async () => {
  const h = eventsHarness();
  try {
    await h.load(); const staleRead = h.current().refresh(), stale = h.requests.at(-1);
    const row = h.row(); const act = flag === "saved" ? row.onSave : row.onHide;
    act(); act(); assert.equal(h.requests.filter(r => r.method === "PATCH").length, 1);
    assert.equal(h.snapshot().events[0][flag], false, "not optimistic");
    h.reply(h.requests.at(-1), { event: { ...event, title: "Canonical", [flag]: true } }); await settle();
    assert.equal(h.snapshot().events[0].title, "Canonical");
    await h.offline();
    h.reply(stale, { events: [event] }); await staleRead;
    assert.equal(h.snapshot().events[0][flag], true);
    assert.equal(h.snapshot().today, "2030-01-01");
    assert.equal(stale.signal.aborted, true);
  } finally { h.unmount(); }
});
test("failed event mutations leave the row unchanged and retryable", async () => {
  const h = eventsHarness();
  try {
    await h.load(); h.row().onSave();
    h.reply(h.requests.at(-1), { error: "Write refused" }, 503); await settle();
    assert.equal(h.row().event.saved, false); assert.equal(h.row().busy, false);
    h.row().onSave(); h.reply(h.requests.at(-1), { event: { ...event, saved: true } }); await h.offline();
    assert.equal(h.row().event.saved, true);
  } finally { h.unmount(); }
});

function linksHarness() {
  const resource = resourceHarness();
  const h = hookHarness(new URL("./JobLinks.tsx", import.meta.url), {
    "@/hooks/useI18n": i18n, "@/extension/robin/links": {}, "./usePolledResource": resource.module,
  });
  const render = () => h.render(() => h.exports.JobLinks({ group: "Job hunt" }));
  const button = key => findElement(render(), n => n.type === "button" && n.props.children === key)?.props;
  return {
    ...resource, render, button,
    input: () => findElement(render(), n => n.type === "input")?.props,
    submit: () => findElement(render(), n => n.type === "form").props.onSubmit({ preventDefault() {} }),
    shown: id => findElement(render(), n => n.type === "a" && n.props.href === id),
    async load() { render(); resource.reply(resource.requests[0], { links: [] }); await settle(); render(); },
    unmount() { h.unmount(); resource.unmount(); },
  };
}
const link = { id: "link", url: "https://example.com/normalized", title: "Canonical link", group: "Job hunt" };
test("JobLinks keeps confirmed normalized links through stale/offline reads", async () => {
  const h = linksHarness();
  try {
    await h.load(); const pending = h.current().refresh(), stale = h.requests.at(-1);
    h.button("robin.common.add").onClick(); h.input().onChange({ target: { value: "example.com" } });
    h.submit(); h.submit(); assert.equal(h.requests.filter(r => r.method === "POST").length, 1);
    assert.equal(h.input().disabled, true);
    h.reply(h.requests.at(-1), { link }); await settle();
    assert.ok(h.shown(link.url)); assert.equal(h.button("robin.common.add").disabled, false);
    await h.offline(); h.reply(stale, { links: [] }); await pending;
    assert.ok(h.shown(link.url)); assert.equal(h.input(), undefined);
  } finally { h.unmount(); }
});
test("JobLinks retains failed input and supports retry", async () => {
  const h = linksHarness();
  try {
    await h.load(); h.button("robin.common.add").onClick(); h.input().onChange({ target: { value: "example.com" } });
    h.submit(); h.reply(h.requests.at(-1), { error: "Write refused" }, 503); await settle();
    assert.equal(h.input().value, "example.com"); assert.equal(h.input().disabled, false);
    h.submit(); h.reply(h.requests.at(-1), { link }); await h.offline();
    assert.ok(h.shown(link.url));
  } finally { h.unmount(); }
});
test("JobLinks retains earlier seed receipts when a later seed fails", async () => {
  const h = linksHarness();
  try {
    await h.load(); h.button("robin.jobs.linksSeed").onClick();
    h.reply(h.requests.at(-1), { link }); await settle();
    assert.ok(h.shown(link.url), "publish each accepted seed before starting the next");
    h.reply(h.requests.at(-1), { error: "Second seed failed" }, 503); await settle();
    assert.ok(h.shown(link.url)); assert.equal(h.requests.filter(r => r.method === "POST").length, 2);
  } finally { h.unmount(); }
});
