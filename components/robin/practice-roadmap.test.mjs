import assert from "node:assert/strict";
import test from "node:test";
import { PRACTICE_TREE, TOPIC_FAMILIES, TREE_WIDTH, TREE_HEIGHT, NODE_HEIGHT, nodeTop, ancestorsOf, neighbourOf } from "./practice-roadmap.ts";
import { EVENT_COLOR_KEYS } from "../../extension/robin/eventColors.ts";
import { PRACTICE_LISTS, problemsInList } from "../../extension/robin/practice.ts";

test("the roadmap covers every catalog topic, with only forward, non-overlapping branches", () => {
  const byName = new Map(PRACTICE_TREE.map((node) => [node.pattern, node]));
  assert.equal(byName.size, PRACTICE_TREE.length);
  for (const list of PRACTICE_LISTS) {
    for (const problem of problemsInList(list)) assert.ok(byName.has(problem.pattern), `${list}: ${problem.pattern}`);
  }
  for (const node of PRACTICE_TREE) {
    // Chips are 176px on a tree at least 920px wide: centres need 10% clearance.
    assert.ok(node.x >= TREE_WIDTH * 0.1 && node.x <= TREE_WIDTH * 0.9, `${node.pattern} is clipped`);
    assert.ok(node.label.length <= 16, `${node.label} is too long for a chip`);
    assert.ok(nodeTop(node.row) + NODE_HEIGHT <= TREE_HEIGHT);
    for (const parent of node.from) assert.ok(byName.get(parent)?.row < node.row, `${parent} → ${node.pattern}`);
    for (const sibling of PRACTICE_TREE.filter((other) => other !== node && other.row === node.row)) {
      assert.ok(Math.abs(sibling.x - node.x) >= TREE_WIDTH * 0.2, `${sibling.pattern} overlaps ${node.pattern}`);
    }
  }
});

test("a topic's route walks every suggested predecessor back to the root", () => {
  assert.deepEqual([...ancestorsOf("Trees")].sort(), ["Arrays & Hashing", "Binary Search", "Linked List", "Two Pointers"]);
  assert.equal(ancestorsOf("Arrays & Hashing").size, 0);
  assert.equal(ancestorsOf("JavaScript").size, 0);
  // Hidden topics (e.g. outside Blind 75) drop out of the route instead of dangling.
  const withoutLinkedList = PRACTICE_TREE.filter((node) => node.pattern !== "Linked List");
  assert.ok(!ancestorsOf("Trees", withoutLinkedList).has("Linked List"));
});

test("arrow keys move spatially between visible topics", () => {
  assert.equal(neighbourOf("Arrays & Hashing", "ArrowDown", PRACTICE_TREE), "Two Pointers");
  assert.equal(neighbourOf("Two Pointers", "ArrowRight", PRACTICE_TREE), "Stack");
  assert.equal(neighbourOf("Stack", "ArrowRight", PRACTICE_TREE), null);
  assert.equal(neighbourOf("Trees", "ArrowUp", PRACTICE_TREE), "Sliding Window");
  assert.equal(neighbourOf("Arrays & Hashing", "ArrowUp", PRACTICE_TREE), null);
  assert.equal(neighbourOf("Backtracking", "ArrowDown", PRACTICE_TREE), "Graphs");
});

test("every topic belongs to a family, and each family has its own calendar hue", () => {
  const hues = TOPIC_FAMILIES.map((family) => family.hue);
  assert.equal(new Set(hues).size, hues.length);
  for (const hue of hues) assert.ok(EVENT_COLOR_KEYS.includes(hue), hue);
  assert.ok(!hues.includes("clay"), "clay is the light accent, reserved for the open problem");
  for (const node of PRACTICE_TREE) assert.ok(TOPIC_FAMILIES.some((family) => family.id === node.family), node.pattern);
});
