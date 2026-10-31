import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const { defaultCwdPath } = await createJiti(import.meta.url).import("./default-cwd.ts");

test("general conversations share one stable directory, independent of date and project cwd", () => {
  const home = path.join(os.tmpdir(), "pi-web-home");
  assert.equal(defaultCwdPath(home), path.join(home, "pi-cwd", "general"));
  assert.equal(defaultCwdPath(), path.join(os.homedir(), "pi-cwd", "general"));
});
