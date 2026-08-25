import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./CodingBoard.tsx", import.meta.url), "utf8");

test("coding escape links use document navigation so Basic Auth can challenge", () => {
  assert.doesNotMatch(source, /from ["']next\/link["']/);
  assert.match(source, /<a href="\/dashboard"/);
  assert.match(source, /<a\s+href=\{chatHref\}/);
});
