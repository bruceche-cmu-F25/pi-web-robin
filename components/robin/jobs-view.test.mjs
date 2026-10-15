import assert from "node:assert/strict";
import test from "node:test";
import { groupJobRoles, jobBand, orderJobGroups, searchJobGroups } from "./jobs-view.ts";

const job = (id, extra = {}) => ({
  id, company: id, title: "Software Engineer", location: "Remote", status: "new",
  source: "greenhouse", url: `https://example.com/${id}`, discoveredAt: "2026-10-10T12:00:00Z", ...extra,
});

test("priority crosses days, keeps unknown scores separate and respects the configured floor", () => {
  const rows = [
    job("recent", { score: 3.9, discoveredAt: "2026-10-14T12:00:00Z" }),
    job("best", { score: 4.5 }), job("low", { score: 2 }), job("unknown"),
  ];
  const groups = groupJobRoles(rows);
  assert.deepEqual(orderJobGroups(groups, "priority", 3.75).map(({ job }) => job.id), ["best", "recent", "unknown", "low"]);
  assert.deepEqual(rows.map((row) => jobBand(row, 3.75)), ["consider", "high", "below", "unscored"]);
  assert.equal(jobBand(rows[0], 4), "below");
  assert.equal(jobBand(rows[1], 4.8), "below");
  assert.equal(orderJobGroups(groups, "recent", 3.75)[0].job.id, "recent");
  assert.equal(rows[0].id, "recent", "sorting never mutates the API response");
});

test("counts use cards, the strongest copy leads, and stages cannot overwrite each other", () => {
  const groups = groupJobRoles([
    job("mirror", { company: "Acme", score: 2 }),
    job("lead", { company: "ACME", score: 4.5 }),
    job("already-applied", { company: "Acme", status: "applied", score: 4 }),
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].job.id, "lead");
  assert.deepEqual(groups[0].also.map((copy) => copy.id), ["mirror"]);
  assert.equal(groups[1].job.status, "applied");
});

test("search finds a duplicate's location but retains every source for status changes", () => {
  const groups = groupJobRoles([
    job("lead", { company: "Acme", location: "Remote", score: 4.5 }),
    job("mirror", { company: "Acme", location: "San Francisco", score: 3.8 }),
    job("other", { score: 4 }),
  ]);
  const result = searchJobGroups(groups, " ACME francisco ");
  assert.equal(result.length, 1);
  assert.equal(result[0].job.id, "lead");
  assert.equal(result[0].also.length, 1);
  assert.equal(searchJobGroups(groups, "no such company").length, 0);
  assert.equal(searchJobGroups(groups, "  ").length, 2);
});

test("applied remains a log ordered by application time, not score", () => {
  const groups = groupJobRoles([
    job("older", { status: "applied", score: 5, appliedAt: "2026-10-10T12:00:00Z" }),
    job("latest", { status: "applied", score: 3, appliedAt: "2026-10-14T12:00:00Z" }),
    job("legacy", { status: "applied" }), job("not-applied", { score: 5 }),
  ], true);
  assert.deepEqual(groups.map(({ job }) => job.id), ["latest", "older", "legacy"]);
});
