import assert from "node:assert/strict";
import { test } from "node:test";
import { storeIcon } from "./icons.ts";

test("private icon targets are refused before fetch", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    return new Response(new Uint8Array([1]), { headers: { "Content-Type": "image/png" } });
  });

  assert.equal(await storeIcon("safeid", "http://169.254.169.254/latest/meta-data/"), null);
  assert.equal(calls, 0);
});
