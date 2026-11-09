import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiti } from "jiti";
const { parsePlannerReply } = await createJiti(import.meta.url).import("./study-planner-reply.ts");

test("conversation remains readable; only a valid bounded plan gets an apply action", () => {
  assert.deepEqual(parsePlannerReply("What part of Python feels rusty?"), { reply: "What part of Python feels rusty?" });
  const result = parsePlannerReply('Try 30 minutes a day.\n<study_plan>{"objective":"Review Python","milestones":[{"title":"Finish two exercises"}]}</study_plan>');
  assert.equal(result.reply, "Try 30 minutes a day.");
  assert.deepEqual(result.proposal, { objective: "Review Python", milestones: [{ title: "Finish two exercises", done: false }] });
  assert.equal(parsePlannerReply('A possible plan <study_plan>{"objective":"X","milestones":[]}</study_plan>').proposal, undefined);
  assert.equal(parsePlannerReply(`Plan <study_plan>${JSON.stringify({ objective: "X".repeat(161), milestones: [{ title: "Y" }] })}</study_plan>`).proposal, undefined);
});
