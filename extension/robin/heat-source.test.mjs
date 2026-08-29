import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { HEAT_SOURCE_LINES } from "./heat-source.ts";
import { TOTAL_LINES, WALKTHROUGH } from "./heat-walkthrough.ts";

test("the embedded copy is exactly as long as the walkthrough claims", () => {
  // The walkthrough tiles 1..TOTAL_LINES. If the copy is a different length,
  // every block below the divergence is annotating the wrong code — which is
  // worse than showing no code at all, because it looks right.
  assert.equal(HEAT_SOURCE_LINES.length, TOTAL_LINES);
});

test("every block's range resolves to real lines", () => {
  for (const section of WALKTHROUGH) {
    for (const block of section.blocks) {
      const slice = HEAT_SOURCE_LINES.slice(block.from - 1, block.to);
      assert.equal(slice.length, block.to - block.from + 1, `block ${block.from}-${block.to} is short`);
    }
  }
});

test("blocks that name a function start inside or at that function", () => {
  // Cheap guard against the annotations sliding out of step with the source
  // after a resync: if a block says it is inside `vertex_generate`, that name
  // should appear at or above its first line.
  for (const section of WALKTHROUGH) {
    for (const block of section.blocks) {
      if (!block.fn || block.fn.includes("/")) continue;
      const upTo = HEAT_SOURCE_LINES.slice(0, block.to).join("\n");
      assert.ok(
        upTo.includes(`def ${block.fn}(`),
        `block ${block.from}-${block.to} claims to be in ${block.fn}(), which is not defined at or above line ${block.to}`,
      );
    }
  }
});

test("the embedded copy still matches ~/heat/visualize.py", (t) => {
  // Skipped rather than failed when the original is not on this machine: the
  // page must work without ~/heat, and a test that fails on a colleague's
  // laptop teaches people to ignore it.
  const original = path.join(homedir(), "heat", "visualize.py");
  let text;
  try {
    text = readFileSync(original, "utf8");
  } catch {
    t.skip(`${original} not present — cannot check for drift`);
    return;
  }
  const lines = text.replace(/\n$/, "").split("\n");
  assert.deepEqual(
    HEAT_SOURCE_LINES.slice(),
    lines,
    "visualize.py has changed — re-run `node scripts/sync-heat-source.mjs`, then re-check the walkthrough line ranges",
  );
});
