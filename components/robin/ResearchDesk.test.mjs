import assert from "node:assert/strict";
import { test } from "node:test";
import { findElement, hookHarness } from "../../scripts/react-hook-harness.mjs";

function desk() {
  return hookHarness(new URL("./ResearchDesk.tsx", import.meta.url), {
    "@/hooks/useI18n": { useI18n: () => ({ t: key => key }) },
    "./ResearchWorkspace.module.css": { default: new Proxy({}, { get: (_, key) => key }) },
  });
}

test("continue reading prioritises human reading state, excludes missing PDFs and read papers, and caps at three", () => {
  const h = desk(); const opened = []; let library = 0;
  const papers = [
    { id: "queued-1", status: "queued", hasAnalysis: true },
    { id: "read", status: "read" },
    { id: "missing", status: "reading", needsPdf: true },
    { id: "reading", status: "reading" },
    { id: "queued-2", status: "queued" },
    { id: "queued-3", status: "queued" },
  ].map(p => ({ ...p, title: p.id, authors: [], year: "" }));
  try {
    const tree = h.render(() => h.exports.ReadingQueue({ papers, loading: false, onOpen: id => opened.push(id), onLibrary: () => library++ }));
    const rows = findElement(tree, node => node.type === "ul").props.children;
    assert.deepEqual(Array.from(rows, row => row.props.children.props.children[1].props.children), ["reading", "queued-1", "queued-2"]);
    rows[0].props.children.props.onClick(); assert.deepEqual(opened, ["reading"]);
    findElement(tree, node => node.type === "button" && node.props.className === "queueLibrary").props.onClick();
    assert.equal(library, 1);
    assert.deepEqual(papers.map(p => p.id), ["queued-1", "read", "missing", "reading", "queued-2", "queued-3"], "view does not reorder or mutate the library");
  } finally { h.unmount(); }
});

test("empty and loading queues are explicit, without invented recommendations", () => {
  const h = desk();
  try {
    for (const loading of [true, false]) {
      const tree = h.render(() => h.exports.ReadingQueue({ papers: [], loading, onOpen() {}, onLibrary() {} }));
      assert.ok(findElement(tree, node => node.type === "p" && node.props.children === (loading ? "rw.loading" : "rw.desk.queueEmpty")));
      assert.equal(findElement(tree, node => node.type === "ul").props.children.length, 0);
    }
  } finally { h.unmount(); }
});
