import assert from "node:assert/strict";
import { test } from "node:test";
import { researchHeadingTree } from "./research-outline.ts";

test("the notebook outline nests actual heading levels without inventing intermediate sections", () => {
  const headings = [
    { level: 2, title: "Question" },
    { level: 3, title: "Hypothesis" },
    { level: 6, title: "Evidence" },
    { level: 3, title: "Experiment" },
    { level: 2, title: "Results" },
    { level: 1, title: "Next week" },
  ];
  const before = JSON.stringify(headings);
  const tree = researchHeadingTree(headings);
  assert.deepEqual(tree.map(node => node.title), ["Question", "Results", "Next week"]);
  assert.deepEqual(tree[0].children.map(node => node.title), ["Hypothesis", "Experiment"]);
  assert.equal(tree[0].children[0].children[0].index, 2);
  assert.equal(tree[1].index, 4);
  assert.equal(JSON.stringify(headings), before, "a read-only view of the notebook");
});

test("repeated and non-Latin titles keep distinct document indexes", () => {
  const tree = researchHeadingTree([{ level: 2, title: "实验" }, { level: 2, title: "实验" }, { level: 3, title: "结果" }]);
  assert.deepEqual(tree.map(node => node.index), [0, 1]);
  assert.equal(tree[1].children[0].index, 2);
  assert.deepEqual(researchHeadingTree([]), []);
});
