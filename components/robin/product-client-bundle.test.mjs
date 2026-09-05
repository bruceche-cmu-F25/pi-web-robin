import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";

/**
 * product-domain.ts reaches the filesystem through paths.ts. A client
 * component that imports a *value* from it pulls `node:fs` into the browser
 * bundle, and Turbopack does not warn — it panics and takes the whole dev
 * server down, so the failure shows up as "the app is broken", not as a
 * lint error. This has now happened twice; the node-free half lives in
 * product-shape.ts and product-stack.ts.
 */
const dir = new URL("./", import.meta.url);
const files = (await readdir(dir)).filter((name) => /^[Pp]roduct.*\.tsx?$/.test(name) && !name.includes(".test."));

test("the product components exist and are covered by this guard", () => {
  assert.ok(files.length >= 5, `only found ${files.join(", ")}`);
});

for (const file of files) {
  test(`${file} imports product-domain for types only`, async () => {
    const source = await readFile(new URL(file, dir), "utf8");
    // The clause may not itself contain "from", which keeps each match to a
    // single import statement rather than swallowing everything above it.
    const imports = [...source.matchAll(/import\s+(type\s+)?(\{[^}]*\}|[A-Za-z_$][\w$]*)\s+from\s+"[^"]*product-domain"/g)];
    assert.ok(imports.length <= 1, `${file}: expected at most one product-domain import`);
    for (const [, typeOnly, clause] of imports) {
      if (typeOnly) continue;
      const specifiers = clause.replace(/^\{|\}$/g, "").split(",").map((part) => part.trim()).filter(Boolean);
      assert.ok(specifiers.length > 0, `${file}: default import from product-domain`);
      for (const specifier of specifiers) {
        assert.ok(
          specifier.startsWith("type "),
          `${file} value-imports "${specifier}" from product-domain — put it in product-shape.ts instead`,
        );
      }
    }
  });
}
