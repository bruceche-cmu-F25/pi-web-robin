import assert from "node:assert/strict";
import { test } from "node:test";
import { findElement, hookHarness } from "../../scripts/react-hook-harness.mjs";

function shelf() {
  return hookHarness(new URL("./ResearchShelf.tsx", import.meta.url), {
    "@/hooks/useI18n": { useI18n: () => ({ t: key => key }) },
    "./ResearchNotebook": { ResearchNotebook() {} },
    "./research-client": {},
    "./ResearchDesk": { ResearchMark() {} },
    "./ResearchWorkspace.module.css": { default: new Proxy({}, { get: (_, key) => key }) },
  });
}

test("reading filters use the person's status, not whether an AI reading exists", () => {
  const h = shelf();
  const papers = [
    { id: "queued", title: "AI already explained this", status: "queued", hasAnalysis: true, coverage: "pdf", authors: [] },
    { id: "reading", title: "In progress", status: "reading", authors: [] },
    { id: "read", title: "Finished", status: "read", authors: [] },
    { id: "missing", title: "Needs a PDF", status: "queued", authors: [], needsPdf: true },
  ];
  const props = { papers, loading: false, onOpen() {} };
  const render = () => h.render(() => h.exports.ReadingList(props));
  const contains = title => !!findElement(render(), node => node.props?.children === title);
  try {
    assert.equal(contains("AI already explained this"), true);
    assert.equal(contains("Needs a PDF"), false, "missing sources stay in the separate action list");
    for (const status of ["queued", "reading", "read"]) {
      findElement(render(), node => node.type === "button" && node.props.children === `rw.paper.status.${status}`).props.onClick();
      for (const paper of papers.filter(paper => !paper.needsPdf)) assert.equal(contains(paper.title), paper.status === status);
    }
    findElement(render(), node => node.type === "button" && node.props.children === "rw.library.all").props.onClick();
    assert.equal(contains("AI already explained this"), true);
  } finally { h.unmount(); }
});

test("the optional experiment outline prepends without rewriting existing notes or goals", () => {
  const h = shelf(); const changes = [];
  const notes = { loaded: true, capturing: false, saveState: "saved", note: "My existing notes\n\n## Kept answer\nEvidence", objective: "My weekly goal",
    captureState: { vaultId: "", vaults: [] }, setNote: value => changes.push(value), saveSoon() {} };
  const render = () => h.render(() => h.exports.Notebook({ notes, projectName: "Research", planning: true }));
  try {
    render(); assert.deepEqual(changes, [], "opening the overview never writes an outline");
    const add = () => findElement(render(), node => node.type === "button" && node.props.children === "rw.plan.addTemplate");
    add().props.onClick();
    assert.equal(changes[0], `rw.plan.template\n\n${notes.note}`);
    assert.equal(notes.objective, "My weekly goal");
    assert.ok(findElement(render(), node => node.type === "textarea"), "the outline opens for human editing");
    notes.capturing = true; assert.equal(add().props.disabled, true);
    notes.capturing = false; notes.note = "x".repeat(100_000); assert.equal(add().props.disabled, true);
  } finally { h.unmount(); }
});
