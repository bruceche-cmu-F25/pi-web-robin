import assert from "node:assert/strict";
import { test } from "node:test";
import { FULLSTACK_STEPS, fullstackPlan } from "../../extension/robin/learning.ts";
import { deferred, findElement, hookHarness, settle } from "../../scripts/react-hook-harness.mjs";

function setup(completed = []) {
  const writes = []; let reads = 0;
  let write = async () => { throw new Error("Write refused"); };
  let read = async () => {};
  const resource = { data: { fullstack: fullstackPlan(completed) }, loading: false, error: null,
    refresh: async () => { reads++; await read(); } };
  const h = hookHarness(new URL("./LearningPanel.tsx", import.meta.url), {
    "@/hooks/useI18n": { useI18n: () => ({ locale: "en", t: (key, values) => values ? `${key} ${JSON.stringify(values)}` : key }) },
    "@/extension/robin/learning": { FULLSTACK_STEPS, practiceHref() {} },
    "./usePolledResource": { usePolledResource: () => resource, mutate: async (url, method, body) => { writes.push({ url, method, ...body }); await write(body); } },
    "./PracticeDailyPlan": { PracticeDailyPlan() {} },
    "./LearningPanel.module.css": { default: new Proxy({}, { get: (_, key) => key }) },
  }, { Error });
  const render = () => h.render(() => h.exports.LearningPanel({ showCourseOutline: true }));
  const button = key => { const node = findElement(render(), node => node.type === "button" && node.props.children === key); assert.ok(node, `missing ${key}`); return node.props; };
  const message = key => findElement(render(), node => typeof node.props?.children === "string" && node.props.children.startsWith(key));
  return { resource, writes, reads: () => reads, render, button, message, write: fn => { write = fn; }, read: fn => { read = fn; }, unmount: () => h.unmount() };
}

for (const completed of [true, false]) test(`retry preserves the original step and completed=${completed}, even after a poll changes the next step`, async () => {
  const step = FULLSTACK_STEPS[0].id;
  const h = setup(completed ? [] : [step]);
  try {
    h.button(completed ? "learn.daily.complete" : "learn.daily.undo").onClick(); await settle();
    assert.equal(h.writes.length, 1); assert.equal(h.reads(), 0);
    h.resource.data.fullstack = fullstackPlan([step, FULLSTACK_STEPS[1].id]);
    h.write(async () => {});
    h.button("learn.daily.retrySave").onClick(); await settle();
    assert.deepEqual(h.writes.map(({ step, completed }) => ({ step, completed })), [{ step, completed }, { step, completed }]);
    assert.equal(h.reads(), 1);
    assert.equal(h.message("learn.daily.writeError"), null);
    assert.ok(h.message("learn.daily.saved"));
  } finally { h.unmount(); }
});

test("read failure retries only GET and retains last known progress", async () => {
  const h = setup();
  try {
    h.resource.error = "Read refused";
    h.read(async () => { h.resource.error = null; });
    h.button("learn.daily.retry").onClick(); await settle();
    assert.equal(h.reads(), 1); assert.equal(h.writes.length, 0);
    assert.equal(h.resource.data.fullstack.next.id, FULLSTACK_STEPS[0].id);
  } finally { h.unmount(); }
});

test("refreshing successfully does not hide an unconfirmed write", async () => {
  const h = setup();
  try {
    h.button("learn.daily.complete").onClick(); await settle();
    h.resource.error = "Poll failed";
    h.read(async () => { h.resource.error = null; });
    h.button("learn.daily.retry").onClick(); await settle();
    assert.equal(h.writes.length, 1); assert.ok(h.message("learn.daily.writeError"));
    assert.ok(h.button("learn.daily.retrySave"));
  } finally { h.unmount(); }
});

test("acknowledged save followed by a failed read never offers another PATCH retry", async () => {
  const h = setup();
  try {
    h.write(async () => {});
    h.read(async () => { h.resource.error = "Refresh failed"; });
    h.button("learn.daily.complete").onClick(); await settle();
    assert.ok(h.message("learn.daily.saved")); assert.ok(h.message("Could not sync learning progress. Please retry."));
    assert.equal(h.message("learn.daily.writeError"), null);
    assert.equal(findElement(h.render(), node => node.type === "button" && node.props.children === "learn.daily.retrySave"), null);
    h.button("learn.daily.retry").onClick(); await settle();
    assert.equal(h.writes.length, 1); assert.equal(h.reads(), 2);
  } finally { h.unmount(); }
});

test("same-frame save/retry and refresh clicks are single-flight", async () => {
  const h = setup();
  try {
    const pending = deferred(); h.write(() => pending.promise);
    const complete = h.button("learn.daily.complete").onClick;
    complete(); complete(); assert.equal(h.writes.length, 1);
    assert.equal(h.button("learn.daily.saving").disabled, true);
    pending.reject(new Error("Still refused")); await settle();
    const retry = h.button("learn.daily.retrySave").onClick;
    const second = deferred(); h.write(() => second.promise);
    retry(); retry(); assert.equal(h.writes.length, 2);
    second.resolve(); await settle();
    h.resource.error = "Read refused";
    const reading = deferred(); h.read(() => reading.promise);
    const refresh = h.button("learn.daily.retry").onClick;
    refresh(); refresh(); assert.equal(h.reads(), 2);
    assert.equal(h.button("learn.daily.refreshing").disabled, true);
    reading.resolve(); await settle();
  } finally { h.unmount(); }
});

test("course-map checkbox retry uses that exact step, not today's next step", async () => {
  const h = setup();
  try {
    const target = FULLSTACK_STEPS[10].id;
    findElement(h.render(), node => node.type?.name === "CourseMap").props.onComplete(target, true); await settle();
    h.button("learn.daily.retrySave").onClick(); await settle();
    assert.deepEqual(h.writes.map(item => item.step), [target, target]);
    assert.ok(h.message("learn.daily.writeError"));
  } finally { h.unmount(); }
});
