import assert from "node:assert/strict";
import { test } from "node:test";
import { findElement, hookHarness } from "../../scripts/react-hook-harness.mjs";

for (const narrow of [false, true]) test(`resource rail: ${narrow ? "narrow" : "wide"} defaults, manual fold, breakpoint focus and cleanup`, () => {
  let listener, focused = 0;
  const activeElement = {};
  const media = { matches: narrow, addEventListener(type, fn) { assert.equal(type, "change"); listener = fn; }, removeEventListener(type, fn) { assert.equal(type, "change"); assert.equal(fn, listener); listener = null; } };
  const element = { open: true, contains: node => node === activeElement, querySelector: selector => { assert.equal(selector, "summary"); return { focus: () => focused++ }; } };
  const h = hookHarness(new URL("./WorkspaceRail.tsx", import.meta.url), {
    "./WorkspaceRail.module.css": { default: new Proxy({}, { get: (_, key) => key }) },
  }, { window: { matchMedia: query => { assert.equal(query, "(max-width: 1150px)"); return media; } }, document: { activeElement } });
  const render = () => h.render(() => {
    const tree = h.exports.WorkspaceRail({ title: "Resources", children: "Saved links" });
    findElement(tree, node => node.type === "details").props.ref.current = element;
    return tree;
  });
  try {
    assert.equal(render().props["aria-label"], "Resources");
    assert.equal(element.open, !narrow);
    element.open = !element.open; const chosen = element.open;
    render(); assert.equal(element.open, chosen, "rerenders preserve a user's fold choice");
    media.matches = false; listener(); assert.equal(element.open, true);
    const before = focused;
    media.matches = true; listener(); assert.equal(element.open, false);
    assert.equal(focused, before + 1, "collapsing cannot leave focus inside hidden resources");
  } finally { h.unmount(); }
  assert.equal(listener, null);
});
