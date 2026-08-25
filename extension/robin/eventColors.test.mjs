import assert from "node:assert/strict";
import { test } from "node:test";
import { EVENT_COLOR_KEYS, eventColorKey, seedColorKey } from "./eventColors.ts";

test("a colour seed is deterministic and in-palette", () => {
  const a = seedColorKey("series-123");
  const b = seedColorKey("series-123");
  assert.equal(a, b);
  assert.ok(EVENT_COLOR_KEYS.includes(a));
});

test("recurring occurrences share a colour despite different ids and titles", () => {
  const first = eventColorKey({ colorSeed: "series-123", id: "occurrence-1", title: "Standup" });
  const moved = eventColorKey({ colorSeed: "series-123", id: "occurrence-2", title: "Standup — moved" });
  assert.equal(first, moved);
});

test("standalone events use their stable ids, then fall back to title", () => {
  assert.equal(eventColorKey({ id: "event-1", title: "x" }), seedColorKey("event-1"));
  assert.equal(eventColorKey({ title: "x" }), seedColorKey("x"));
});
