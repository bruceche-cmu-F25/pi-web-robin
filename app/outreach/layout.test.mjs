import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Cold Reach and its research page share the Robin shell and language provider", () => {
  const layout = readFileSync(new URL("./layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /<I18nProvider>\s*<RobinShell>\{children\}<\/RobinShell>\s*<\/I18nProvider>/);
});
