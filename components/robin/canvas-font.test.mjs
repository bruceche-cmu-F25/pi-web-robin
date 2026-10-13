import assert from "node:assert/strict";
import test from "node:test";
import { configureCanvasFont } from "./canvas-font.ts";

test("the local font slot resolves to Notes typography without breaking existing IDs or other fonts", () => {
  const families = { Virgil: 1, Helvetica: 2, Cascadia: 3, Excalifont: 5 };
  const stack = "Georgia, 'Times New Roman', 'Songti SC', serif";
  assert.equal(configureCanvasFont(families, stack), 2);
  assert.equal(families.Helvetica, 2, "The renderer's local font metadata still resolves");
  assert.equal(Object.entries(families).find(([, id]) => id === 2)[0], stack);
  assert.equal(families.Excalifont, 5, "Explicitly chosen/imported fonts remain available");
  configureCanvasFont(families, stack);
  assert.equal(Object.values(families).filter((id) => id === 2).length, 1, "Safe across HMR/repeated initialization");
});
