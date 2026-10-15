import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { resetTaskStore } from "./task-store.test-support.mjs";

const dir = mkdtempSync(join(tmpdir(), "robin-background-runs-"));
const previous = process.env.ROBIN_DATA_DIR;
process.env.ROBIN_DATA_DIR = dir;
beforeEach(() => resetTaskStore(dir));
after(() => {
  rmSync(dir, { recursive: true, force: true });
  if (previous === undefined) delete process.env.ROBIN_DATA_DIR;
  else process.env.ROBIN_DATA_DIR = previous;
});

const {
  backgroundRunActive,
  cancelBackgroundRun,
  claimBackgroundRun,
  executeBackgroundRun,
  heartbeatBackgroundRun,
  releaseBackgroundRun,
  RUN_LEASE_MS,
  withBackgroundRunOwnership,
} = await import("./background-run-domain.ts");

test("named background runs reject overlap, expire, and fence late writers", () => {
  const name = "scanner";
  const started = Date.parse("2026-10-04T10:00:00.000Z");

  assert.equal(claimBackgroundRun(name, "owner-one", started), true);
  assert.equal(backgroundRunActive(name, started + RUN_LEASE_MS - 1), true);
  assert.equal(claimBackgroundRun(name, "owner-two", started + 1), false);
  assert.equal(heartbeatBackgroundRun(name, "owner-two", "2026-10-04T10:01:00.000Z"), false);
  assert.equal(heartbeatBackgroundRun(name, "owner-one", "2026-10-04T10:01:00.000Z"), true);

  let writes = 0;
  assert.deepEqual(
    withBackgroundRunOwnership(name, "owner-one", () => ++writes, Date.parse("2026-10-04T10:01:30.000Z")),
    { owned: true, value: 1 },
  );

  const replacementAt = Date.parse("2026-10-04T10:01:00.000Z") + RUN_LEASE_MS;
  assert.equal(claimBackgroundRun(name, "owner-two", replacementAt), true);
  assert.deepEqual(
    withBackgroundRunOwnership(name, "owner-one", () => ++writes, replacementAt),
    { owned: false },
  );
  assert.equal(writes, 1);
  assert.equal(releaseBackgroundRun(name, "owner-one"), false, "an old finally cannot clear its replacement");
  assert.equal(releaseBackgroundRun(name, "owner-two"), true);
  assert.equal(backgroundRunActive(name, replacementAt), false);
});

test("explicit cancellation clears a remote owner", () => {
  assert.equal(claimBackgroundRun("cancel-me", "remote-owner"), true);
  assert.equal(cancelBackgroundRun("cancel-me"), true);
  assert.equal(backgroundRunActive("cancel-me"), false);
  assert.equal(cancelBackgroundRun("cancel-me"), false);
});

test("detached work keeps its lease until the supplied settlement promise", async () => {
  let finish;
  const settled = new Promise((resolve) => { finish = resolve; });
  const execution = await executeBackgroundRun("detached", async ({ deferRelease }) => {
    deferRelease(settled);
    return "response finished";
  });
  assert.deepEqual(execution, { started: true, value: "response finished" });
  assert.equal(backgroundRunActive("detached"), true);
  assert.equal(claimBackgroundRun("detached", "duplicate"), false);

  finish();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(backgroundRunActive("detached"), false);
});
