import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "robin-product-map-"));
process.env.ROBIN_DATA_DIR = dir;
const { addIdea, getIdea, updateIdea, updateLaunchDecision, listIdeas } = await import("./product-domain.ts");
const { LAUNCH_MAP, LAUNCH_NODE_IDS, breakEvenCustomers } = await import("./product-launch.ts");
const { PRODUCT_CASES, caseIdeaDraft } = await import("./product-cases.ts");
const { saveCaseOpportunity } = await import("./product-opportunities.ts");
test.after(() => rmSync(dir, { recursive: true, force: true }));

const decision = (nodeId, note = "Checked", status = "doing", expectedUpdatedAt = null) => ({ nodeId, note, status, expectedUpdatedAt });

test("map covers delivery AND operations, and each branch has a concrete output, lean choice and risk", () => {
  assert.deepEqual(LAUNCH_MAP.map((entry) => entry.id), [...LAUNCH_NODE_IDS]);
  assert.equal(new Set(LAUNCH_NODE_IDS).size, 8);
  for (const branch of LAUNCH_MAP) {
    for (const lang of ["zh", "en"]) {
      for (const field of ["title", "question", "output", "lean", "risk"]) assert.ok(branch[field][lang].length > 3);
      assert.equal(branch.tasks.length, 3);
    }
    if (branch.caseId) assert.ok(PRODUCT_CASES.some((item) => item.id === branch.caseId));
  }
});

test("one-branch writes merge, survive ordinary notebook edits and never change the user's pipeline", () => {
  const idea = addIdea({ name: "My product", note: "Keep my words", step: "research" });
  updateIdea(idea.id, { parked: true, bet: { claim: "Someone pays", by: "2030-01-01" } });
  assert.equal(getIdea(idea.id).launchPlan, undefined, "browsing has no write side effect");
  updateLaunchDecision(idea.id, decision("billing", "Pricing notes", "done"));
  updateLaunchDecision(idea.id, decision("operations", "Restore rehearsal", "doing"));
  updateIdea(idea.id, { note: "My new words" });
  const result = getIdea(idea.id);
  assert.equal(result.launchPlan.billing.note, "Pricing notes");
  assert.equal(result.launchPlan.operations.note, "Restore rehearsal");
  assert.equal(result.step, "research");
  assert.equal(result.parked, true);
  assert.equal(result.bet.claim, "Someone pays");
  assert.equal(result.note, "My new words");
  const version = result.launchPlan.billing.updatedAt;
  updateLaunchDecision(idea.id, decision("billing", "Updated pricing", "doing", version));
  assert.throws(() => updateLaunchDecision(idea.id, decision("billing", "Stale overwrite", "done", version)), /changed elsewhere/);
  assert.equal(getIdea(idea.id).launchPlan.billing.note, "Updated pricing");
  assert.equal(updateLaunchDecision("missing", decision("market")), null);
});

test("invalid branch writes fail before touching user data", () => {
  const idea = addIdea({ name: "Validation" });
  for (const bad of [null, [], {}, decision("__proto__"), decision("market", "x", "finished"), decision("market", 42), decision("market", "x".repeat(20001)), { ...decision("market"), expectedUpdatedAt: undefined }]) {
    assert.throws(() => updateLaunchDecision(idea.id, bad));
  }
  assert.equal(getIdea(idea.id).launchPlan, undefined);
});

test("each source has two explicitly unvalidated angles; adopting either is idempotent and preserves edits", () => {
  for (const item of PRODUCT_CASES) {
    assert.match(item.source, /^https:\/\/www.starterstory.com\//);
    assert.match(item.checkedOn, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(item.sections.length, 4);
    assert.ok(item.sections.every((section) => /^\d\d:\d\d/.test(section.time)));
    for (const angle of ["improve", "transfer"]) {
      const draft = caseIdeaDraft(item, angle, "en");
      assert.match(draft.note, /unvalidated/);
      assert.ok(draft.note.includes(item.source));
      const before = listIdeas().length;
      const idea = saveCaseOpportunity(item.id, angle, "en");
      assert.equal(listIdeas().length, before + 1);
      updateIdea(idea.id, { name: "User renamed", note: "User edited", parked: true });
      const repeated = saveCaseOpportunity(item.id, angle, "zh");
      assert.equal(repeated.id, idea.id);
      assert.equal(repeated.name, "User renamed");
      assert.equal(repeated.note, "User edited");
      assert.equal(repeated.parked, true);
      assert.equal(repeated.links.length, 1);
      assert.equal(listIdeas().length, before + 1);
    }
  }
  assert.throws(() => saveCaseOpportunity("not-real", "improve", "en"));
  assert.throws(() => saveCaseOpportunity("papermark", "__proto__", "en"));
});

test("case previews explain the buyer, business model and illustrative workflow in both languages", () => {
  for (const item of PRODUCT_CASES) {
    assert.equal(item.flow.length, 3);
    for (const lang of ["zh", "en"]) {
      for (const field of [item.buyer, item.model, ...item.flow]) assert.ok(field[lang].trim().length > 3);
    }
  }
});

test("break-even uses contribution margin and refuses loss-making / invalid inputs", () => {
  assert.equal(breakEvenCustomers(100, 20, 5), 7);
  assert.equal(breakEvenCustomers(0, 20, 5), 0);
  assert.equal(breakEvenCustomers(100, 5, 5), null);
  assert.equal(breakEvenCustomers(100, 5, 6), null);
  assert.equal(breakEvenCustomers(-1, 20, 5), null);
  assert.equal(breakEvenCustomers(Infinity, 20, 5), null);
  assert.equal(breakEvenCustomers(NaN, 20, 5), null);
});
