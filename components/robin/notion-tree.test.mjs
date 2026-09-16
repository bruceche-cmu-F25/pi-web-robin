import assert from "node:assert/strict";
import { test } from "node:test";
import { buildNotionTree, filterNotionTree } from "./notion-tree.ts";

test("Notion pages form a sorted tree while orphans and cycles remain reachable", () => {
  const tree = buildNotionTree([
    { id: "child", title: "Child", parentId: "root" },
    { id: "root", title: "Root" },
    { id: "orphan", title: "Orphan", parentId: "missing" },
    { id: "b", title: "Cycle B", parentId: "a" },
    { id: "a", title: "Cycle A", parentId: "b" },
  ]);

  assert.deepEqual(tree.map((node) => node.id), ["a", "b", "orphan", "root"]);
  assert.deepEqual(tree.at(-1).children.map((node) => node.id), ["child"]);
  assert.deepEqual(filterNotionTree(tree, "child").map((node) => ({
    id: node.id,
    children: node.children.map((child) => child.id),
  })), [{ id: "root", children: ["child"] }]);
});
