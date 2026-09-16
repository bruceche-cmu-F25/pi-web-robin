import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

// A document whose title writes are delivered to MutationObservers as a
// microtask, like the browser does. It refuses to go on past a bound, so a
// ping-pong between writers fails the test instead of hanging it.
let writes = 0;
const observers = new Set();
let pending = false;
let title = "Pi Web";
globalThis.document = {
  head: {},
  get title() { return title; },
  set title(value) {
    if (++writes > 200) throw new Error("title writers are fighting");
    title = value;
    if (pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      for (const observer of [...observers]) observer.callback();
    });
  },
};
globalThis.MutationObserver = class {
  constructor(callback) { this.callback = callback; }
  observe() { observers.add(this); }
  disconnect() { observers.delete(this); }
};

const jiti = createJiti(import.meta.url);
const { applyTitlePrefix, holdTitle } = await jiti.import("./tab-title.ts");

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a held page title and the focus prefix settle on one title", async () => {
  const release = holdTitle("robin - Pi Web");
  applyTitlePrefix("Focus 24 min · ");
  await settle();
  writes = 0;

  // A route change replacing the title, then the countdown ticking down.
  document.title = "Pi Web";
  await settle();
  assert.equal(document.title, "Focus 24 min · robin - Pi Web");
  applyTitlePrefix("Focus 23 min · ");
  await settle();
  assert.equal(document.title, "Focus 23 min · robin - Pi Web");
  assert.ok(writes < 10, `expected a handful of writes, saw ${writes}`);

  applyTitlePrefix("");
  await settle();
  assert.equal(document.title, "robin - Pi Web");
  release();
});
