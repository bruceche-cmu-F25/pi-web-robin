import assert from "node:assert/strict";
import { test } from "node:test";
import { jobsView, eventsView, eventReturnHref } from "./board-navigation.ts";
import { applyQueryPatch } from "../../lib/url-state.ts";

const params = text => new URLSearchParams(text);
test("jobs restore filters, query, order, expanded count and low-score disclosure", () => {
  assert.deepEqual(jobsView(params("status=shortlist&q=分布式+systems&sort=recent&shown=100&below=1")), {
    filter: "shortlist", query: "分布式 systems", order: "recent", shown: 100, showBelow: true,
  });
  assert.deepEqual(jobsView(params("")), { filter: "new", query: "", order: "priority", shown: 50, showBelow: false });
  for (const value of ["-50", "Infinity", "1.5", "NaN", "9007199254740992", "0", ""]) assert.equal(jobsView(params(`shown=${value}`)).shown, 50);
  assert.equal(jobsView(params("status=deleted&sort=random&below=true")).filter, "new");
  assert.equal(jobsView(params("status=deleted&sort=random&below=true")).order, "priority");
  assert.equal(jobsView(params("below=true")).showBelow, false);
});
test("events restore filters and reject impossible calendar dates without crashing", () => {
  assert.deepEqual(eventsView(params("q=Demo&topic=ai&day=2026-10-27&saved=1&hidden=1")), {
    query: "Demo", topic: "ai", day: "2026-10-27", savedOnly: true, showHidden: true,
  });
  for (const value of ["2026-02-29", "2026-02-31", "2026-13-01", "not-a-day", "2026-1-1", ""]) assert.equal(eventsView(params(`day=${value}`)).day, null);
  assert.equal(eventsView(params("day=2028-02-29")).day, "2028-02-29");
  assert.equal(eventsView(params("topic=unknown&saved=true")).topic, "all");
  assert.equal(eventsView(params("saved=true")).savedOnly, false);
});
test("changing one filter or clearing filters preserves unrelated URL context", () => {
  const changed = applyQueryPatch("session=keep&q=Demo&status=all&shown=100&below=1", { status: "shortlist", shown: null, below: null });
  assert.equal(params(changed).get("session"), "keep"); assert.equal(params(changed).get("q"), "Demo");
  assert.equal(params(changed).get("status"), "shortlist"); assert.equal(params(changed).has("shown"), false);
  assert.equal(applyQueryPatch("session=keep&q=Demo&topic=ai&day=2026-10-27&saved=1&hidden=1", { q: null, topic: null, day: null, saved: null, hidden: null }), "session=keep");
});
test("detail back links accept only the same-app Events list", () => {
  const href = "/dashboard/events?topic=ai&q=%E7%A0%94%E7%A9%B6&saved=1&session=keep";
  assert.equal(eventReturnHref(href), href);
  for (const value of [null, "", "//evil.example", "https://evil.example/dashboard/events", "javascript:alert(1)", "/dashboard/jobs", "/dashboard/events/x", "/dashboard/events\\@evil.example", "/dashboard/events\n/../jobs?x=1"]) assert.equal(eventReturnHref(value), "/dashboard/events");
});
