import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { renderHook } from "../hooks/__fixtures__/react-hook-shim.mjs";

const shim = fileURLToPath(new URL("../hooks/__fixtures__/react-hook-shim.mjs", import.meta.url));
const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true, alias: { "react/jsx-runtime": fileURLToPath(import.meta.resolve("react/jsx-runtime")), react: shim } });
const { SidebarToast } = await jiti.import("./SidebarToast.tsx");
let clock, listeners, dismissed;
const tick = (ms) => { clock += ms; mock.timers.tick(ms); };
const visibility = (value) => {
  document.visibilityState = value;
  for (const listener of listeners) listener();
};

function mount(id = 1) {
  const parent = renderHook(() => SidebarToast({ toast: { id, message: "Archived", actions: [] }, durationMs: 1000, dismissLabel: "Dismiss", onDismiss: () => dismissed++ }));
  const card = parent.result.props.children;
  const view = renderHook(() => card.type(card.props));
  return { view, dispose() { view.unmount(); parent.unmount(); } };
}

test.beforeEach(() => {
  clock = 0; dismissed = 0; listeners = new Set();
  mock.timers.enable({ apis: ["setTimeout"] });
  mock.method(performance, "now", () => clock);
  globalThis.window = { setTimeout, clearTimeout };
  globalThis.document = {
    visibilityState: "visible",
    addEventListener: (name, fn) => { assert.equal(name, "visibilitychange"); listeners.add(fn); },
    removeEventListener: (_name, fn) => listeners.delete(fn),
  };
});
test.afterEach(() => {
  mock.restoreAll(); mock.timers.reset();
  delete globalThis.window; delete globalThis.document;
});

test("background time does not consume the remaining visible countdown", () => {
  const h = mount();
  tick(400); visibility("hidden"); tick(20_000);
  assert.equal(dismissed, 0);
  visibility("visible"); tick(599);
  assert.equal(dismissed, 0);
  tick(1); assert.equal(dismissed, 1);
  h.dispose(); assert.equal(listeners.size, 0);
});

test("a toast mounted hidden starts its full timer only when visible", () => {
  visibility("hidden");
  const h = mount(); tick(10_000);
  assert.equal(dismissed, 0);
  visibility("visible"); tick(999); assert.equal(dismissed, 0);
  tick(1); assert.equal(dismissed, 1);
  h.dispose();
});

test("hover and focus pause; leaving grants a fresh window even across visibility changes", () => {
  const h = mount(); tick(400);
  h.view.result.props.onPointerEnter({ pointerType: "mouse" }); h.view.flush();
  visibility("hidden"); tick(2000); visibility("visible");
  h.view.result.props.onFocus(); h.view.flush();
  h.view.result.props.onPointerLeave(); h.view.flush();
  tick(2000); assert.equal(dismissed, 0);
  h.view.result.props.onBlur({ currentTarget: { contains: () => false }, relatedTarget: null }); h.view.flush();
  tick(999); assert.equal(dismissed, 0);
  tick(1); assert.equal(dismissed, 1);
  h.dispose();
});

test("touch does not pause, and replacing/unmounting a toast removes the old timer", () => {
  const old = mount();
  old.view.result.props.onPointerEnter({ pointerType: "touch" }); old.view.flush();
  tick(400); old.dispose();
  const next = mount(2); tick(600);
  assert.equal(dismissed, 0);
  next.dispose(); tick(2000);
  assert.equal(dismissed, 0); assert.equal(listeners.size, 0);
});

test("a timer delivered before the hidden event never dismisses an unseen toast", () => {
  const h = mount();
  document.visibilityState = "hidden";
  tick(1000); assert.equal(dismissed, 0);
  visibility("hidden"); visibility("visible");
  tick(999); assert.equal(dismissed, 0);
  tick(1); assert.equal(dismissed, 1);
  h.dispose();
});
