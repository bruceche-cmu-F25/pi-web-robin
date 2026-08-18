import assert from "node:assert/strict";
import test from "node:test";
import { nextUiStyle, normalizeUiStyle } from "./useUiStyle.ts";

test("UI style defaults to balanced and accepts only persisted styles", () => {
  assert.equal(normalizeUiStyle(null), "balanced");
  assert.equal(normalizeUiStyle("unknown"), "balanced");
  assert.equal(normalizeUiStyle("balanced"), "balanced");
  assert.equal(normalizeUiStyle("classic"), "classic");
});

test("UI style toggle preserves both real implementations", () => {
  assert.equal(nextUiStyle("balanced"), "classic");
  assert.equal(nextUiStyle("classic"), "balanced");
});
