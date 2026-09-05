import assert from "node:assert/strict";
import test from "node:test";

const { PLAYBOOK, PLAYBOOK_STEPS, nextStep, playbookStep } = await import("./product-playbook.ts");

test("every step tells you what it is for, what to do, and when it is finished", () => {
  // A step that cannot state its purpose is a step you skip; a step without a
  // definition of done is a step you never leave.
  assert.deepEqual(PLAYBOOK.map((step) => step.id), [...PLAYBOOK_STEPS]);
  for (const step of PLAYBOOK) {
    for (const field of ["name", "question", "done"]) {
      for (const lang of ["en", "zh"]) {
        assert.ok(step[field][lang]?.trim(), `${step.id}.${field}.${lang} is empty`);
      }
    }
    assert.ok(step.does.length >= 2 && step.does.length <= 4, `${step.id} has ${step.does.length} instructions`);
    for (const item of step.does) {
      for (const lang of ["en", "zh"]) assert.ok(item[lang]?.trim(), `${step.id} instruction missing ${lang}`);
    }
    assert.ok(step.categories.length > 0, `${step.id} has no shelf`);
  }
});

test("the walk is linear and ends", () => {
  assert.equal(nextStep("spot"), "research");
  assert.equal(nextStep("launch"), null, "the last step has nowhere to advance to");
  assert.equal(playbookStep("research").action, "research", "research is the step the agent can run");
  // Only one step claims an action, and it is the one that is wired.
  assert.deepEqual(PLAYBOOK.filter((step) => step.action).map((step) => step.id), ["research"]);
});

test("every library shelf is reachable from some step", () => {
  // Otherwise a category exists that nothing ever offers you.
  const used = new Set(PLAYBOOK.flatMap((step) => step.categories));
  assert.deepEqual([...used].sort(), ["distribution", "source", "stack", "test", "tool"]);
});
