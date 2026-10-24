import assert from "node:assert/strict";
import { test } from "node:test";
import { deferred, findElement, hookHarness, settle } from "../../scripts/react-hook-harness.mjs";

const style = { default: new Proxy({}, { get: (_, name) => String(name) }) };
function editorHarness(component = "PaperSheet", options = {}) {
  const values = new Map(), calls = [], sent = [];
  let stored = { id: "p", title: "Paper", note: "", tags: "", revision: 1, abstract: "", authors: [], exports: [], url: "https://example.org/p", projectIds: ["test"], access: { links: [], attempts: [] } };
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const question = hookHarness(new URL("./useResearchThread.ts", import.meta.url), { "./research-client": {} }, { localStorage: storage });
  const props = { paper: stored, project: { id: "test", name: "Test" }, projects: [{ id: "test", name: "Test" }],
    projectId: "test", projectName: "Test", paperTitles: new Map(),
    thread: { ready: true, busy: false, elsewhere: false, state: { messages: [] }, send: async (...args) => { sent.push(args); return options.send ? options.send(...args) : true; } },
    onChange(next) { props.paper = next; }, onClose() {}, onNavigate() {}, onRemoved() {}, onSelectConversation() {},
  };
  const mutate = (url, value) => {
    calls.push({ url, ...value });
    if (options.failSave) throw new Error("Save refused");
    if (value.revision !== stored.revision) throw new Error("Revision conflict");
    stored = { ...stored, ...value.patch, revision: stored.revision + 1 };
    return { paper: stored };
  };
  const h = hookHarness(new URL(`./${component}.tsx`, import.meta.url), {
    "@/hooks/useI18n": { useI18n: () => ({ t: (key) => key }) }, "@/components/MarkdownBody": { MarkdownBody() {} },
    "./ResearchPdfUpload": { ResearchPdfUpload() {} },
    "./PaperExport": { PaperExport() {} }, "./PaperPdf": { PaperPdf() {} }, "./ResearchSessions": { ResearchSessions() {} },
    "./ResearchThread": { RunStatus() {}, ThreadMessage() {}, submitsOnEnter() {} },
    "./useResearchThread": { useResearchQuestion: (key) => question.render(() => question.exports.useResearchQuestion(key)) },
    "./ResearchWorkspace.module.css": style,
    "./research-client": { researchJson: (method, value) => ({ method, value }),
      researchRequest: async (url, { value }) => mutate(url, value),
      uploadPaperPdf: async (paper) => {
        if (options.uploading) await options.uploading.promise;
        return mutate("upload", { id: paper.id, revision: stored.revision }).paper;
      },
    },
  }, { localStorage: storage, URL, Error });
  const render = () => h.render(() => h.exports[component](props));
  const element = (predicate) => { const found = findElement(render(), predicate); assert.ok(found); return found.props; };
  render();
  return { props, values, calls, sent, render, element,
    editNote: (value) => element((node) => node.props?.["aria-label"] === "rw.paper.myNotes" && node.type === "textarea").onChange({ target: { value } }),
    question: () => element((node) => node.type === "textarea" && (node.props.placeholder === "rw.placeholder" || node.props.placeholder === "rw.paper.askPlaceholder")),
    async supply(kind) {
      if (kind === "pdf") element((node) => node.type === "input" && node.props.type === "file").onChange({ target: { files: [{ name: "paper.pdf" }], value: "" } });
      else {
        element((node) => node.props?.placeholder === "rw.paper.pastePlaceholder").onChange({ target: { value: "Source text" } });
        element((node) => node.type === "button" && node.props.children === "rw.paper.useText").onClick();
      }
      await settle(); await settle();
    },
    unmount() { h.unmount(); question.unmount(); },
  };
}

for (const component of ["ResearchThread", "PaperSheet"]) {
  for (const changed of [false, true]) test(`${component}: acceptance ${changed ? "preserves a newer" : "clears the submitted"} composer draft`, async () => {
    const pending = deferred();
    const h = editorHarness(component, { send: () => pending.promise });
    try {
      h.question().onChange({ target: { value: "First question" } });
      h.element((node) => node.type === "form").onSubmit({ preventDefault() {} }); await settle();
      if (changed) h.question().onChange({ target: { value: "Second question" } });
      pending.resolve(true); await settle();
      const expected = changed ? "Second question" : "";
      assert.equal(h.question().value, expected);
      const key = [...h.values.keys()].find((key) => key.includes("question"));
      assert.equal(h.values.get(key), expected);
    } finally { h.unmount(); }
  });
}

test("only the exact automatic PDF request is condensed; its original instructions remain expandable", () => {
  const automatic = "Read the uploaded PDF in full, including methods, evidence and limitations.";
  const h = hookHarness(new URL("./ResearchThread.tsx", import.meta.url), {
    "@/hooks/useI18n": { useI18n: () => ({ t: key => key === "rw.home.readUploaded" ? automatic : key }) },
    "@/components/MarkdownBody": { MarkdownBody() {} }, "./useResearchThread": {}, "./ResearchPdfUpload": {}, "./ResearchWorkspace.module.css": style,
  });
  try {
    const props = { message: { role: "user", paperId: "p", text: automatic }, paperTitle: "A PDF", onNavigate() {} };
    const condensed = h.render(() => h.exports.ThreadMessage(props));
    const details = findElement(condensed, node => node.type === "details");
    assert.ok(details); assert.ok(findElement(details, node => node.props?.children === automatic));
    props.message.text = "My own question, which must not be condensed";
    assert.equal(findElement(h.render(() => h.exports.ThreadMessage(props)), node => node.type === "details"), null);
  } finally { h.unmount(); }
});

test("ResearchThread stays mounted across conversations without clearing the new draft on late acceptance", async () => {
  const pending = deferred(); const h = editorHarness("ResearchThread", { send: () => pending.promise });
  try {
    h.question().onChange({ target: { value: "Question in the first conversation" } });
    h.element(node => node.type === "form").onSubmit({ preventDefault() {} }); await settle();
    h.props.thread.state.conversation = { id: "topic-two", default: false };
    h.render(); h.render();
    assert.equal(h.question().value, "");
    h.question().onChange({ target: { value: "Draft in the second conversation" } });
    pending.resolve(true); await settle();
    assert.equal(h.question().value, "Draft in the second conversation");
  } finally { h.unmount(); }
});

test("ResearchThread blocks competing text sends while a PDF is being prepared", async () => {
  const h = editorHarness("ResearchThread");
  try {
    h.props.onUpload = async () => null;
    h.question().onChange({ target: { value: "Keep this question" } });
    h.element(node => typeof node.props?.onBusyChange === "function").onBusyChange(true);
    h.element(node => node.type === "form").onSubmit({ preventDefault() {} }); await settle();
    assert.equal(h.sent.length, 0); assert.equal(h.question().value, "Keep this question");
    h.element(node => typeof node.props?.onBusyChange === "function").onBusyChange(false);
    h.element(node => node.type === "form").onSubmit({ preventDefault() {} }); await settle();
    assert.equal(h.sent.length, 1);
  } finally { h.unmount(); }
});

test("ResearchThread offers the latest reply without pulling the reader away from older messages", () => {
  const h = editorHarness("ResearchThread");
  try {
    h.props.thread.state.messages = [{ id: "first", role: "assistant", text: "First answer" }];
    const transcript = h.element(node => node.props?.className === "transcript");
    const node = { scrollHeight: 1200, clientHeight: 300, scrollTop: 0 }; transcript.ref.current = node;
    transcript.onScroll();
    h.props.thread.state.messages.push({ id: "second", role: "assistant", text: "New answer" });
    h.render();
    const latest = h.element(node => node.type === "button" && node.props.className?.includes("latestReply"));
    assert.equal(node.scrollTop, 0);
    latest.onClick(); assert.equal(node.scrollTop, 1200);
    assert.equal(findElement(h.render(), node => node.type === "button" && node.props.className?.includes("latestReply")), null);
  } finally { h.unmount(); }
});

for (const kind of ["text", "pdf"]) test(`edited notes + ${kind} supply saves once and starts reading`, async () => {
  const h = editorHarness();
  try {
    h.editNote("Unsaved note");
    h.question().onChange({ target: { value: "Keep this unrelated question" } });
    await h.supply(kind);
    assert.deepEqual(h.calls.map((call) => call.revision), [1, 2]);
    assert.deepEqual(h.sent, [["rw.paper.readUploaded", "p"]]);
    h.render(); h.render();
    assert.equal(h.question().value, "Keep this unrelated question");
    h.editNote("Next edit");
    h.element((node) => node.type === "button" && node.props.children === "rw.save").onClick(); await settle();
    assert.deepEqual(h.calls.map((call) => call.revision), [1, 2, 3]);
    assert.equal(h.props.paper.note, "Next edit");
  } finally { h.unmount(); }
});

test("failed note save stops source upload and automatic reading", async () => {
  const h = editorHarness("PaperSheet", { failSave: true });
  try {
    h.editNote("Keep unsaved"); await h.supply("text");
    assert.equal(h.calls.length, 1); assert.equal(h.sent.length, 0);
    assert.equal(h.element((node) => node.type === "textarea" && node.props["aria-label"] === "rw.paper.myNotes").value, "Keep unsaved");
  } finally { h.unmount(); }
});

test("source supply while another run is busy does not start a turn", async () => {
  const h = editorHarness();
  try {
    h.props.thread.elsewhere = true; h.editNote("My note"); await h.supply("text");
    assert.deepEqual(h.calls.map((call) => call.revision), [1, 2]); assert.equal(h.sent.length, 0);
  } finally { h.unmount(); }
});

test("notes typed during PDF upload are retained with the new source revision", async () => {
  const uploading = deferred();
  const h = editorHarness("PaperSheet", { uploading });
  try {
    h.editNote("First note"); await h.supply("pdf");
    h.editNote("More notes during upload");
    uploading.resolve(); await settle(); await settle(); h.render(); h.render();
    assert.equal(h.element((node) => node.type === "textarea" && node.props["aria-label"] === "rw.paper.myNotes").value, "More notes during upload");
    h.element((node) => node.type === "button" && node.props.children === "rw.save").onClick(); await settle();
    assert.deepEqual(h.calls.map((call) => call.revision), [1, 2, 3]);
    assert.equal(h.props.paper.note, "More notes during upload");
  } finally { h.unmount(); }
});
