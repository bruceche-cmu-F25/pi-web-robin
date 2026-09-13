import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_FOCUS_TIMER as idle, changeFocusTimer as change, focusRemaining, formatFocusTime, localDay, parseFocusTimer, todayFocus,
} from "./focus-timer.ts";

const start = (s = idle, now = 1000) => change(s, { type: "start", phase: "focus" }, now);

test("25/5 defaults, timestamp-based countdown, and reload", () => {
  assert.equal(idle.focusMinutes, 25);
  assert.equal(idle.breakMinutes, 5);
  const running = start();
  assert.equal(running.endsAt, 1_501_000);
  const restored = parseFocusTimer(JSON.stringify(running));
  assert.equal(focusRemaining(restored, 61_000), 24 * 60_000);
  assert.equal(formatFocusTime(focusRemaining(restored, 1500)), "25:00");
  assert.equal(formatFocusTime(1), "00:01");
  assert.equal(formatFocusTime(-1), "00:00");
});

test("pause preserves remaining time, resume uses the new wall clock", () => {
  const paused = change(start(), { type: "pause" }, 61_000);
  assert.equal(paused.endsAt, null);
  assert.equal(focusRemaining(paused, 10_000_000), 24 * 60_000);
  const resumed = change(paused, { type: "resume" }, 10_000_000);
  assert.equal(resumed.endsAt, 11_440_000);
  assert.equal(change(resumed, { type: "resume" }, 10_001_000), resumed);
});

test("settings apply to future phases, not a running or paused countdown", () => {
  const running = start();
  const changed = change(running, { type: "settings", focusMinutes: 50, breakMinutes: 10, sound: false }, 2000);
  assert.equal(changed.endsAt, running.endsAt);
  assert.equal(changed.sound, false);
  const paused = change(changed, { type: "pause" }, 61_000);
  const edited = change(paused, { type: "settings", focusMinutes: 90 }, 70_000);
  assert.equal(edited.remainingMs, paused.remainingMs);
  const complete = change(changed, { type: "expire" }, running.endsAt);
  const rest = change(complete, { type: "start", phase: "break" }, 2_000_000);
  assert.equal(rest.endsAt, 2_600_000);
  const end = change(rest, { type: "end" }, 2_001_000);
  assert.equal(focusRemaining(end, 2_001_000), 50 * 60_000);
});

test("expiry catches up after sleep, is idempotent, and never chains phases", () => {
  const running = start();
  assert.equal(change(running, { type: "expire" }, 2000), running);
  const complete = change(running, { type: "expire" }, 99_000_000);
  assert.equal(complete.status, "complete");
  assert.equal(complete.phase, "focus");
  assert.equal(complete.endsAt, null);
  assert.equal(change(complete, { type: "expire" }, 199_000_000), complete);
  const rest = change(complete, { type: "start", phase: "break" }, 199_000_000);
  assert.equal(rest.remainingMs, 5 * 60_000);
  const restComplete = change(rest, { type: "expire" }, rest.endsAt);
  assert.equal(restComplete.phase, "break");
  assert.equal(restComplete.status, "complete");
  assert.equal(change(restComplete, { type: "end" }, rest.endsAt).status, "idle");
});

test("pausing at the deadline finishes instead of creating a stuck zero-second timer", () => {
  const running = start();
  assert.equal(change(running, { type: "pause" }, running.endsAt).status, "complete");
  assert.equal(change(running, { type: "start", phase: "focus" }, 2000), running);
});

test("finished focus rounds count toward today; breaks do not", () => {
  const running = start();
  const done = change(running, { type: "expire" }, running.endsAt + 5000);
  assert.deepEqual(todayFocus(done, running.endsAt), { day: localDay(running.endsAt), rounds: 1, focusMs: 25 * 60_000 });
  const rest = change(done, { type: "start", phase: "break" }, running.endsAt + 5000);
  const rested = change(rest, { type: "expire" }, rest.endsAt);
  assert.deepEqual(rested.today, done.today);
  const second = change(change(rested, { type: "start", phase: "focus" }, rest.endsAt), { type: "expire" }, rest.endsAt + 25 * 60_000);
  assert.equal(second.today.rounds, 2);
  assert.equal(second.today.focusMs, 50 * 60_000);
});

test("a round is credited with the length it started with, on the day it ended", () => {
  const running = change(start(), { type: "settings", focusMinutes: 90 }, 2000);
  const done = change(running, { type: "expire" }, running.endsAt);
  assert.equal(done.today.focusMs, 25 * 60_000);
  // A tab asleep past midnight still credits the evening the round ended.
  const late = change(running, { type: "expire" }, running.endsAt + 48 * 3_600_000);
  assert.equal(late.today.day, localDay(running.endsAt));
  assert.equal(todayFocus(late, running.endsAt + 48 * 3_600_000).rounds, 0);
});

test("ending focus early records the minutes spent, excluding pauses, but no round", () => {
  const paused = change(start(), { type: "pause" }, 1000 + 10 * 60_000);
  const ended = change(paused, { type: "end" }, 1000 + 60 * 60_000);
  assert.equal(ended.today.rounds, 0);
  assert.equal(ended.today.focusMs, 10 * 60_000);
  assert.equal(ended.phaseMs, 25 * 60_000);
  const breakEnded = change(change(change(start(), { type: "expire" }, 1_501_000), { type: "start", phase: "break" }, 1_501_000), { type: "end" }, 1_600_000);
  assert.equal(breakEnded.today.focusMs, 25 * 60_000);
  assert.equal(change(idle, { type: "end" }, 1000).today, idle.today);
});

test("snapshots from before the daily record still restore", () => {
  const legacy = { ...start() };
  delete legacy.phaseMs;
  delete legacy.today;
  const restored = parseFocusTimer(JSON.stringify(legacy));
  assert.equal(restored.status, "running");
  assert.equal(restored.phaseMs, 25 * 60_000);
  assert.deepEqual(restored.today, idle.today);
  const corruptDay = parseFocusTimer(JSON.stringify({ ...start(), today: { day: "x", rounds: -1, focusMs: 1 } }));
  assert.deepEqual(corruptDay.today, idle.today);
});

test("corrupt storage and out-of-range settings cannot create broken timers", () => {
  for (const raw of [null, "{", "null", "[]", "{}", JSON.stringify({ ...idle, version: 2 }),
    JSON.stringify({ ...idle, focusMinutes: 0 }), JSON.stringify({ ...idle, breakMinutes: 61 }),
    JSON.stringify({ ...idle, remainingMs: -1 }), JSON.stringify({ ...idle, status: "running", endsAt: null }),
    JSON.stringify({ ...idle, sound: "true" }), JSON.stringify({ ...idle, status: "other" })]) {
    assert.equal(parseFocusTimer(raw), idle);
  }
  for (const focusMinutes of [NaN, Infinity, 0, -1, 1.5, 181]) {
    assert.equal(change(idle, { type: "settings", focusMinutes }, 0).focusMinutes, 25);
  }
  assert.equal(change(idle, { type: "settings", focusMinutes: 180 }, 0).focusMinutes, 180);
});
