import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EVENT_COLOR_KEYS,
  eventColorKey,
  orderSeriesColors,
  seedColorKey,
  seriesSeed,
} from "./eventColors.ts";

test("a colour seed is deterministic and in-palette", () => {
  const a = seedColorKey("series-123");
  const b = seedColorKey("series-123");
  assert.equal(a, b);
  assert.ok(EVENT_COLOR_KEYS.includes(a));
});

test("recurring occurrences share a colour despite different ids", () => {
  const first = eventColorKey({ colorSeed: "series-123", id: "occurrence-1", title: "Standup" });
  const moved = eventColorKey({ colorSeed: "series-123", id: "occurrence-2", title: "Standup \u2014 moved" });
  assert.equal(first, moved);
});

test("a local repeat is identified by its title, not by its row", () => {
  // Robin writes every repeat as its own row with its own random id. Seeding
  // on the id gave six Leetcode hours six unrelated colours; the title is what
  // actually repeats.
  const week = ["a3f9c1d2", "7b21e8fa", "0c4d9e77", "e1a20b56", "94ff3c08", "2d6e7a19"]
    .map((id) => eventColorKey({ id, title: "\u5237\u9898Leetcode" }));
  assert.equal(new Set(week).size, 1);
  assert.equal(week[0], seedColorKey("\u5237\u9898Leetcode"));
});

test("the id never decides a colour, however it varies", () => {
  const withId = eventColorKey({ id: "row-1", title: "Gym" });
  const otherId = eventColorKey({ id: "row-2", title: "Gym" });
  const noId = eventColorKey({ title: "Gym" });
  assert.equal(withId, otherId);
  assert.equal(withId, noId);
});

test("a provider's recurrence seed outranks the title", () => {
  // Two series sharing a title are coloured by their own seeds, not by the
  // title they have in common. Not asserted: that the two seeds land in
  // different buckets — with a finite palette that is luck, not behaviour.
  const a = eventColorKey({ colorSeed: "cal-a:14757", title: "14757" });
  const b = eventColorKey({ colorSeed: "cal-b:14757", title: "14757" });
  assert.equal(a, seedColorKey("cal-a:14757"));
  assert.equal(b, seedColorKey("cal-b:14757"));
});

test("a blank or whitespace-only seed falls through to the title", () => {
  assert.equal(eventColorKey({ colorSeed: "", title: "Gym" }), seedColorKey("Gym"));
  assert.equal(eventColorKey({ colorSeed: "   ", title: "Gym" }), seedColorKey("Gym"));
  assert.equal(eventColorKey({ title: "  Gym  " }), seedColorKey("Gym"));
});

test("the hash spreads evenly over the palette", () => {
  // The palette repeating within one busy week is the palette being small, not
  // the hash clumping. Over a realistic number of series the six buckets stay
  // within a few per cent of each other.
  const counts = new Map(EVENT_COLOR_KEYS.map((key) => [key, 0]));
  const total = 6000;
  for (let i = 0; i < total; i += 1) {
    const key = seedColorKey(`series-${i}-${(i * 2654435761) % 97}`);
    counts.set(key, counts.get(key) + 1);
  }
  const expected = total / EVENT_COLOR_KEYS.length;
  for (const [key, count] of counts) {
    assert.ok(
      Math.abs(count - expected) < expected * 0.15,
      `${key} took ${count} of ${total}, expected about ${expected}`,
    );
  }
});

const ev = (title, start, colorSeed) => ({ title, ...(start ? { start } : {}), ...(colorSeed ? { colorSeed } : {}) });

test("colours are dealt down the day, in palette order", () => {
  const dealt = orderSeriesColors([
    ev("Gym", "13:30"),
    ev("\u5237\u9898Leetcode", "10:00"),
    ev("14795", "11:00"),
    ev("18658", "13:00"),
    ev("14757", "16:00"),
  ]);
  // Earliest first, then the palette in its dealing order.
  assert.deepEqual(
    [...dealt.entries()].map(([seed, key]) => `${seed}:${key}`),
    ["\u5237\u9898Leetcode:clay", "14795:teal", "18658:plum", "Gym:sage", "14757:slate"],
  );
});

test("every occurrence of a series is one colour, ranked by its earliest start", () => {
  const dealt = orderSeriesColors([
    ev("Gym", "20:00"),
    ev("Gym", "07:00"),
    ev("Standup", "09:30"),
  ]);
  assert.equal(dealt.size, 2);
  // Gym's 07:00 outranks Standup even though a later Gym was listed first.
  assert.equal(dealt.get("Gym"), "clay");
  assert.equal(dealt.get("Standup"), "teal");
});

test("all-day series are dealt after everything with a clock", () => {
  // The time grid is what is read down the day, so it gets the front of the
  // palette; the all-day band takes what is left.
  const dealt = orderSeriesColors([ev("Trip"), ev("Leetcode", "08:00"), ev("Gym", "19:00")]);
  assert.deepEqual([...dealt.keys()], ["Leetcode", "Gym", "Trip"]);
  assert.equal(dealt.get("Leetcode"), "clay");
  assert.equal(dealt.get("Trip"), "plum");
});

test("the deal is stable against the order events arrive in", () => {
  const events = [ev("c", "12:00"), ev("a", "09:00"), ev("b", "10:00")];
  const forward = orderSeriesColors(events);
  const reversed = orderSeriesColors([...events].reverse());
  assert.deepEqual([...forward.entries()], [...reversed.entries()]);
  // Two series at the same minute are ordered by seed, not by arrival.
  const tied = orderSeriesColors([ev("zebra", "09:00"), ev("apple", "09:00")]);
  assert.deepEqual([...tied.keys()], ["apple", "zebra"]);
});

test("all nine colours are used before any repeats", () => {
  const many = Array.from({ length: 9 }, (_, i) => ev(`s${i}`, `${String(i + 8).padStart(2, "0")}:00`));
  const dealt = orderSeriesColors(many);
  assert.equal(new Set(dealt.values()).size, EVENT_COLOR_KEYS.length);
  // The tenth wraps to the front of the deal rather than inventing a hue.
  const ten = orderSeriesColors([...many, ev("s9", "17:30")]);
  assert.equal(ten.get("s9"), ten.get("s0"));
});

test("a provider recurrence seed still groups a series in the deal", () => {
  const dealt = orderSeriesColors([
    ev("14757", "16:00", "cal:14757"),
    ev("14757 \u2014 moved", "16:00", "cal:14757"),
    ev("Standup", "09:30"),
  ]);
  assert.equal(dealt.size, 2);
  assert.equal(seriesSeed(ev("14757 \u2014 moved", "16:00", "cal:14757")), "cal:14757");
});
