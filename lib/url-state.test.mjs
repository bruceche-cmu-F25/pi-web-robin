import assert from "node:assert/strict";
import test from "node:test";
import { applyQueryPatch } from "./url-state.ts";

test("view state updates preserve workspace context and remove defaults", () => {
  assert.equal(
    applyQueryPatch("?session=abc&calendar=week", { calendar: "agenda", date: "2026-09-19" }),
    "session=abc&calendar=agenda&date=2026-09-19",
  );
  assert.equal(
    applyQueryPatch("?cwd=%2Ftmp&stage=validate&idea=old", { stage: null, idea: "new", pane: undefined }),
    "cwd=%2Ftmp&idea=new",
  );
});
