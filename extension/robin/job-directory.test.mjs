import assert from "node:assert/strict";
import { test } from "node:test";
import { DIRECTORIES, directoryById, isDeadBoardError, isParked, prettifySlug, recordBoardOutcome } from "./job-directory.ts";

test("dataset slugs are refused unless they are safe to put in a URL", () => {
  // The board list is third-party crowd-sourced input that ends up
  // interpolated into a request URL. This is the guard that makes that safe.
  const greenhouse = directoryById("greenhouse");
  assert.ok(greenhouse.toCompany("acme-corp"));
  assert.ok(greenhouse.toCompany("0x"));
  assert.equal(greenhouse.toCompany("../../etc/passwd"), null);
  assert.equal(greenhouse.toCompany("acme/../evil"), null);
  assert.equal(greenhouse.toCompany("acme?x=1"), null);
  assert.equal(greenhouse.toCompany("acme#frag"), null);
  assert.equal(greenhouse.toCompany("evil.com/acme"), null);
  assert.equal(greenhouse.toCompany(""), null);
});

/** A dataset entry each directory accepts — Workday's are triples, not slugs. */
const SAMPLE_ENTRY = {
  greenhouse: "acme",
  lever: "acme",
  ashby: "acme",
  icims: "acme",
  workday: "acme|wd5|External",
};

test("a constructed board URL always lands on that ATS's own host", () => {
  for (const directory of DIRECTORIES) {
    const entry = SAMPLE_ENTRY[directory.id];
    assert.ok(entry, `no sample entry for ${directory.id}`);
    const company = directory.toCompany(entry);
    assert.ok(company, directory.id);
    const { hostname, protocol } = new URL(company.url);
    assert.equal(protocol, "https:", directory.id);
    assert.match(hostname, /greenhouse\.io$|lever\.co$|ashbyhq\.com$|icims\.com$|myworkdayjobs\.com$/, directory.id);
  }
});

test("a Workday dataset entry is a triple, and every part of it is checked", () => {
  const workday = DIRECTORIES.find((directory) => directory.id === "workday");
  assert.ok(workday);
  assert.equal(
    workday.toCompany("23andme|wd5|23")?.url,
    "https://23andme.wd5.myworkdayjobs.com/23",
  );
  // The dataset is third-party input that ends up interpolated into a
  // hostname, so a malformed or hostile triple must produce nothing at all.
  for (const bad of [
    "acme", "acme|wd5", "acme|wd5|", "|wd5|External",
    "acme|wd5|External|extra".replace("extra", "ev/il"),
    "acme.evil.com|wd5|External", "acme|wd5|../../etc", "acme|wd 5|External",
  ]) {
    assert.equal(workday.toCompany(bad), null, bad);
  }
});

test("only the directory whose tenants are separate hosts runs wider than the shared limit", () => {
  for (const directory of DIRECTORIES) {
    if (directory.id === "workday") assert.ok((directory.concurrency ?? 0) > 6, directory.id);
    else assert.equal(directory.concurrency, undefined, directory.id);
  }
});

test("board slugs are tidied for display without pretending to be real names", () => {
  assert.equal(prettifySlug("acme-corp"), "Acme Corp");
  assert.equal(prettifySlug("scale_ai"), "Scale Ai");
  assert.equal(prettifySlug("openai"), "Openai");
  // Nothing recovers a name from a run-together slug, and inventing one would
  // be worse than showing what the directory actually said.
  assert.equal(prettifySlug("8thlightrebuild"), "8thlightrebuild");
});

test("large directories are budgeted across nights", () => {
  for (const id of ["workday", "icims"]) {
    const directory = DIRECTORIES.find((entry) => entry.id === id);
    assert.ok(directory.nightlyLimit > 0, id);
  }
  // The shared-host directories finish in minutes, so they run whole.
  for (const directory of DIRECTORIES.filter((entry) => !["workday", "icims"].includes(entry.id))) {
    assert.equal(directory.nightlyLimit, undefined, directory.id);
  }
});

test("a board that said it does not exist is parked a week per miss, and one good answer clears it", () => {
  const now = Date.parse("2026-09-24T00:00:00.000Z");
  const day = 86_400_000;
  const dead = {};
  recordBoardOutcome(dead, "greenhouse:gone", "dead", now);
  assert.ok(isParked(dead, "greenhouse:gone", now + 6 * day));
  assert.ok(!isParked(dead, "greenhouse:gone", now + 8 * day));

  recordBoardOutcome(dead, "greenhouse:gone", "dead", now);
  assert.ok(isParked(dead, "greenhouse:gone", now + 13 * day));
  for (let miss = 0; miss < 10; miss += 1) recordBoardOutcome(dead, "greenhouse:gone", "dead", now);
  // Capped: a board that comes back is found within a month.
  assert.ok(!isParked(dead, "greenhouse:gone", now + 29 * day));

  // A bad night on the server is not a verdict on the board.
  recordBoardOutcome(dead, "lever:flaky", "error", now);
  assert.ok(!isParked(dead, "lever:flaky", now));

  recordBoardOutcome(dead, "greenhouse:gone", "ok", now);
  assert.equal(dead["greenhouse:gone"], undefined);
});

test("only a definite not-found counts as a dead board", () => {
  assert.ok(isDeadBoardError(new Error("HTTP 404")));
  assert.ok(isDeadBoardError(new Error("HTTP 422")));
  assert.ok(isDeadBoardError(new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } })));
  assert.ok(!isDeadBoardError(new Error("HTTP 429")));
  assert.ok(!isDeadBoardError(new Error("HTTP 503")));
  assert.ok(!isDeadBoardError(new TypeError("fetch failed", { cause: { code: "ECONNRESET" } })));
  assert.ok(!isDeadBoardError(new Error("The operation was aborted due to timeout")));
});
