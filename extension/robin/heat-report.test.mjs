import assert from "node:assert/strict";
import test from "node:test";
import {
  CLAIM_LEDGER,
  CLAIM_STATUSES,
  REPORT,
  REPORT_META,
  REPRODUCTION,
} from "./heat-report.ts";

test("sections are numbered 1..n with unique ids", () => {
  const ids = REPORT.map((section) => section.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate section id");
  REPORT.forEach((section, index) => {
    assert.equal(section.number, index + 1, `section "${section.id}" is numbered out of order`);
  });
});

test("every section has prose", () => {
  for (const section of REPORT) {
    assert.ok(section.body.length > 0, `section "${section.id}" has no body`);
  }
});

test("every claim has a known status, a basis, and something that would move it", () => {
  // A row nothing could change is not a claim, it is an opinion — and the
  // whole point of the ledger is that a reader can argue with it.
  const ids = CLAIM_LEDGER.map((claim) => claim.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate claim id");
  for (const claim of CLAIM_LEDGER) {
    assert.ok(CLAIM_STATUSES.includes(claim.status), `unknown status "${claim.status}" on ${claim.id}`);
    assert.ok(claim.basis.en.trim().length > 0, `${claim.id} has no basis`);
    assert.ok(claim.moves.en.trim().length > 0, `${claim.id} names nothing that would change it`);
  }
});

test("both languages are present throughout", () => {
  const bilinguals = [
    REPORT_META.title,
    REPORT_META.subtitle,
    REPORT_META.scope,
    ...REPORT.flatMap((section) => [section.heading, ...section.body]),
    ...CLAIM_LEDGER.flatMap((claim) => [claim.claim, claim.basis, claim.moves]),
    ...REPRODUCTION.flatMap((check) => [check.question, check.result]),
  ];
  for (const value of bilinguals) {
    assert.ok(value.en.trim().length > 0, `empty en: ${JSON.stringify(value).slice(0, 60)}`);
    assert.ok(value.zh.trim().length > 0, `empty zh: ${JSON.stringify(value).slice(0, 60)}`);
  }
});

test("reproduction commands are runnable as written", () => {
  // These are pasted, not read. A command wrapped for display would fail on
  // the first line and quietly discredit the finding it supports.
  for (const check of REPRODUCTION) {
    assert.ok(check.command.trim().length > 0, `${check.id} has no command`);
    assert.ok(
      !check.command.includes("…") && !check.command.includes("..."),
      `${check.id} contains an ellipsis, so it cannot be pasted`,
    );
  }
});
