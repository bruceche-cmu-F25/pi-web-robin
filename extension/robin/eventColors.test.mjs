import assert from "node:assert/strict";
import { test } from "node:test";
import { EVENT_COLOR_KEYS, eventColorKey, seedColorKey, seriesSeed, todoSpanColorKey } from "./eventColors.ts";

test("a series color is deterministic and in-palette", () => {
  assert.equal(seedColorKey("series-123"), seedColorKey("series-123"));
  assert.ok(EVENT_COLOR_KEYS.includes(seedColorKey("series-123")));
});

test("provider recurrence identity survives moved/renamed occurrences", () => {
  const first = { colorSeed: "cal:series", id: "a", title: "Class", start: "10:00" };
  assert.equal(eventColorKey(first), eventColorKey({ ...first, id: "b", title: "Moved class", start: "08:00" }));
  assert.equal(seriesSeed(first), "cal:series");
});

test("local repeats use the trimmed title, not occurrence ids or time", () => {
  const repeat = ["a", "b", "c"].map((id) => eventColorKey({ id, title: "刷题 Leetcode" }));
  assert.equal(new Set(repeat).size, 1);
  assert.equal(eventColorKey({ title: " Gym ", start: "07:00" }), eventColorKey({ title: "Gym", start: "19:00" }));
  assert.equal(seriesSeed({ colorSeed: "  ", title: " Gym " }), "Gym");
  assert.equal(seriesSeed({ colorSeed: "provider:Gym", title: "Gym" }), "provider:Gym");
});

test("adding/removing earlier series, changing views and changing input order cannot redeal colors", () => {
  const series = { title: "Class", colorSeed: "fixture:class", start: "10:00" };
  const early = { title: "Early meeting", colorSeed: "fixture:early", start: "06:00" };
  const expected = eventColorKey(series);
  for (const window of [[series], [early, series], [series, early], [{ ...series, start: undefined }]]) {
    assert.equal(window.map((event) => [seriesSeed(event), eventColorKey(event)]).find(([seed]) => seed === "fixture:class")[1], expected);
  }
});

test("a provider seed outranks equal titles; finite palettes may still collide", () => {
  assert.equal(eventColorKey({ colorSeed: "cal-a:series", title: "Class" }), seedColorKey("cal-a:series"));
  assert.equal(eventColorKey({ colorSeed: "cal-b:series", title: "Class" }), seedColorKey("cal-b:series"));
});

test("the shared hash spreads over all nine keys without changing todo picks", () => {
  const counts = new Map(EVENT_COLOR_KEYS.map((key) => [key, 0]));
  for (let i = 0; i < 6000; i++) {
    const key = seedColorKey(`series-${i}-${(i * 2654435761) % 97}`);
    counts.set(key, counts.get(key) + 1);
  }
  for (const count of counts.values()) assert.ok(Math.abs(count - 6000 / 9) < 6000 / 9 * .15);
  assert.equal(todoSpanColorKey({ title: "Write report", color: "plum" }), "plum");
  assert.equal(todoSpanColorKey({ title: " Write report " }), seedColorKey("Write report"));
});
