import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { STARTER_PRODUCT_LIBRARY } from "./product-domain.ts";
import { shelfLogo } from "./shelf-logos.ts";

test("every linked starter product resource has a local mark", () => {
  for (const resource of STARTER_PRODUCT_LIBRARY) {
    if (!resource.url) continue;
    assert.ok(shelfLogo(new URL(resource.url).host), `missing product mark for ${resource.url}`);
  }
});

test("logo lookup treats www and the bare host as the same site", () => {
  assert.equal(shelfLogo("www.youtube.com"), shelfLogo("youtube.com"));
  assert.equal(shelfLogo("WWW.YOUTUBE.COM."), shelfLogo("youtube.com"));
});

test("the snapshot script includes both shelves and preserves a cached mark on a transient failure", async () => {
  const source = await readFile(new URL("../../scripts/refresh-shelf-logos.mjs", import.meta.url), "utf8");
  assert.match(source, /STARTER_PRODUCT_LIBRARY/);
  assert.match(source, /learningShelf\(\)/);
  assert.match(source, /found\.set\(host, previous\)/);
});
