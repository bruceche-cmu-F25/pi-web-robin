import assert from "node:assert/strict";
import test from "node:test";
import {
  BITES,
  BRIEF_META,
  FIRST_WEEK,
  HABITS,
  HEADLINE,
  INPUTS,
  PEOPLE,
  TRUST_LEVELS,
  TRUST_MAP,
} from "./heat-brief.ts";

const bilinguals = [
  BRIEF_META.title, BRIEF_META.subtitle, BRIEF_META.readingOrder,
  HEADLINE.title, HEADLINE.body, HEADLINE.soWhat,
  ...TRUST_MAP.flatMap((r) => [r.item, r.why]),
  ...BITES.flatMap((b) => [b.symptom, b.cause, b.fix]),
  ...INPUTS.flatMap((i) => [i.triviaqa, i.squad, i.why]),
  ...PEOPLE.flatMap((p) => [p.who, p.holds, ...p.ask]),
  ...FIRST_WEEK.flatMap((f) => [f.what, f.why]),
  ...HABITS,
];

test("both languages are present everywhere", () => {
  for (const value of bilinguals) {
    assert.ok(value.en.trim().length > 0, `empty en: ${JSON.stringify(value).slice(0, 60)}`);
    assert.ok(value.zh.trim().length > 0, `empty zh: ${JSON.stringify(value).slice(0, 60)}`);
  }
});

test("ids are unique within each list", () => {
  for (const [name, list] of [["trust", TRUST_MAP], ["bites", BITES], ["inputs", INPUTS], ["people", PEOPLE], ["firstWeek", FIRST_WEEK]]) {
    const ids = list.map((row) => row.id);
    assert.equal(new Set(ids).size, ids.length, `duplicate id in ${name}`);
  }
});

test("every trust row uses a known verdict", () => {
  for (const row of TRUST_MAP) {
    assert.ok(TRUST_LEVELS.includes(row.verdict), `unknown verdict "${row.verdict}" on ${row.id}`);
  }
});

test("every bite points at a line of the file", () => {
  // A symptom without a location is a warning, not a briefing.
  for (const bite of BITES) {
    assert.match(bite.ref, /^visualize\.py:\d+$/, `${bite.id} has no usable reference`);
  }
});

test("every person has at least one question", () => {
  // The section exists to be acted on. A person with nothing to ask them is
  // an org chart entry, which is not what this page is for.
  for (const person of PEOPLE) {
    assert.ok(person.ask.length > 0, `${person.id} has nothing to ask`);
  }
});

test("week one fits in a week", () => {
  const hours = FIRST_WEEK.reduce((sum, item) => sum + item.hours, 0);
  assert.ok(hours > 0 && hours <= 15, `week one is ${hours}h, which is not a week at this workload`);
});
