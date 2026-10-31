import assert from "node:assert/strict";
import { test } from "node:test";
import { deferred, findElement, hookHarness, settle } from "../../scripts/react-hook-harness.mjs";

function setup({ project = { id: "heat", name: "HEAT", brief: "Original question", links: [], archived: false }, touch = false, inline = false } = {}) {
  const request = deferred(), calls = [], confirmations = [], listeners = new Map();
  let closed = 0, saved = 0, focused, answer = false;
  const heading = { attributes: new Set(), setAttribute(name) { this.attributes.add(name); }, removeAttribute(name) { this.attributes.delete(name); } };
  const input = { ...heading, attributes: new Set() };
  const dialog = { querySelector: () => input, showModal() { focused = heading.attributes.has("autofocus") ? "heading" : "input"; }, close() {} };
  const h = hookHarness(new URL("./ProjectDialog.tsx", import.meta.url), {
    "@/hooks/useI18n": { useI18n: () => ({ t: key => key }) },
    "./ResearchWorkspace.module.css": { default: new Proxy({}, { get: (_, key) => key }) },
    "./research-client": { researchJson: (method, body) => ({ method, body }), researchRequest: (url, options) => { calls.push({ url, ...options }); return request.promise; } },
  }, { Error, HTMLElement: class {}, document: { activeElement: null }, window: {
    matchMedia: () => ({ matches: touch }),
    confirm: message => { confirmations.push(message); return answer; },
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name); },
  } });
  const props = { project, inline, onClose: () => closed++, onSaved: () => saved++ };
  const render = () => h.render(() => {
    const tree = h.exports.ProjectDialog(props);
    const modal = findElement(tree, node => node.type === "dialog");
    if (modal) modal.props.ref.current = dialog;
    const title = findElement(tree, node => node.props?.id === "research-project-dialog");
    if (title) title.props.ref.current = heading;
    return tree;
  });
  const element = predicate => { const node = findElement(render(), predicate); assert.ok(node); return node.props; };
  const button = key => element(node => node.type === "button" && node.props.children === key);
  const field = name => element(node => node.props?.placeholder === name);
  const escape = (native = false) => {
    let prevented = false, stopped = false;
    const event = { key: "Escape", preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } };
    element(node => node.type === "dialog")[native ? "onCancel" : "onKeyDown"](event);
    assert.ok(prevented); if (!native) assert.ok(stopped);
  };
  render();
  return { props, render, element, button, field, escape, calls, request, confirmations, listeners,
    allowDiscard: value => { answer = value; }, closed: () => closed, saved: () => saved, focused: () => focused,
    unmount: () => h.unmount() };
}

for (const action of ["cancel", "escape", "native cancel"]) test(`${action}: clean closes directly; dirty cancellation retains the draft; explicit discard closes`, () => {
  const h = setup();
  const close = () => action === "cancel" ? h.button("rw.cancel").onClick() : h.escape(action === "native cancel");
  try {
    close(); assert.equal(h.closed(), 1); assert.equal(h.confirmations.length, 0);
    h.field("rw.project.namePlaceholder").onChange({ target: { value: "Edited" } });
    close(); assert.equal(h.closed(), 1); assert.equal(h.confirmations.length, 1);
    assert.equal(h.field("rw.project.namePlaceholder").value, "Edited");
    h.allowDiscard(true); close(); assert.equal(h.closed(), 2);
    assert.equal(h.calls.length, 0);
  } finally { h.unmount(); }
});

for (const placeholder of ["rw.project.namePlaceholder", "rw.project.briefPlaceholder", "rw.focusPlaceholder", "Repository | https://github.com/…\nShared drive | https://drive.google.com/…"]) test(`new project protects ${placeholder.split("\n")[0]} and recognises reverted edits`, () => {
  const h = setup({ project: null });
  try {
    h.field(placeholder).onChange({ target: { value: "Draft" } }); h.escape();
    assert.equal(h.closed(), 0); assert.ok(h.listeners.has("beforeunload"));
    h.field(placeholder).onChange({ target: { value: "" } }); h.escape();
    assert.equal(h.closed(), 1); assert.equal(h.confirmations.length, 1);
    assert.equal(h.listeners.has("beforeunload"), false);
  } finally { h.unmount(); }
});

test("save is single-flight even before rerender; Escape cannot close it, failure retains editable fields", async () => {
  const h = setup();
  try {
    h.field("rw.project.namePlaceholder").onChange({ target: { value: "My draft" } });
    const form = h.element(node => node.type === "form"), cancel = h.button("rw.cancel");
    form.onSubmit({ preventDefault() {} }); form.onSubmit({ preventDefault() {} }); cancel.onClick();
    h.escape(); h.escape(true); assert.equal(h.calls.length, 1); assert.equal(h.closed(), 0); assert.equal(h.confirmations.length, 0);
    assert.equal(h.field("rw.project.namePlaceholder").readOnly, true);
    assert.ok(h.element(node => node.props?.role === "status"));
    assert.equal(h.button("rw.saving").disabled, true);
    h.request.reject(new Error("Save failed")); await settle();
    assert.equal(h.field("rw.project.namePlaceholder").value, "My draft");
    assert.equal(h.field("rw.project.namePlaceholder").readOnly, false);
    assert.equal(h.element(node => node.props?.role === "alert").children, "Save failed");
    h.escape(); assert.equal(h.closed(), 0); assert.equal(h.confirmations.length, 1);
  } finally { h.unmount(); }
  assert.equal(h.listeners.size, 0);
});

test("a successful save sends the original project fields and calls onSaved once", async () => {
  const h = setup();
  try {
    h.field("rw.project.namePlaceholder").onChange({ target: { value: "New title" } });
    h.element(node => node.type === "form").onSubmit({ preventDefault() {} });
    assert.equal(h.calls[0].body.patch.name, "New title");
    assert.equal(h.calls[0].body.patch.brief, "Original question");
    h.request.resolve({ project: { ...h.props.project, name: "New title" } }); await settle();
    assert.equal(h.saved(), 1); assert.equal(h.confirmations.length, 0);
  } finally { h.unmount(); }
});

for (const archived of [false, true]) test(`${archived ? "restore" : "archive"} cannot silently discard edited fields`, () => {
  const h = setup(); h.props.project.archived = archived;
  try {
    h.field("rw.project.briefPlaceholder").onChange({ target: { value: "Keep this question" } });
    const action = () => h.button(archived ? "rw.project.restore" : "rw.project.archive").onClick();
    action(); assert.equal(h.calls.length, 0);
    h.allowDiscard(true); action(); assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].body.patch.archived, !archived);
    assert.equal(h.calls[0].body.patch.brief, undefined, "archival is not an implicit text save");
  } finally { h.unmount(); }
});

for (const touch of [false, true]) test(`initial focus: ${touch ? "touch focuses heading" : "desktop focuses name"} before showModal`, () => {
  const h = setup({ touch });
  try {
    assert.equal(h.focused(), touch ? "heading" : "input");
    assert.equal(h.field("rw.project.namePlaceholder").autoFocus, undefined);
  } finally { h.unmount(); }
});

test("inline setup never opens a dialog or steals focus", () => {
  const h = setup({ project: null, inline: true });
  try { assert.equal(h.focused(), undefined); assert.equal(h.render().type, "section"); }
  finally { h.unmount(); }
});
