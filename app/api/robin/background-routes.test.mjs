import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createJiti } from "jiti";

const dir = mkdtempSync(join(tmpdir(), "robin-background-routes-"));
const previous = process.env.ROBIN_DATA_DIR;
process.env.ROBIN_DATA_DIR = dir;
globalThis.__backgroundRouteCalls = 0;

after(() => {
  rmSync(dir, { recursive: true, force: true });
  if (previous === undefined) delete process.env.ROBIN_DATA_DIR;
  else process.env.ROBIN_DATA_DIR = previous;
  delete globalThis.__backgroundRouteCalls;
});

const googleStub = join(dir, "google.mjs");
const assistantStub = join(dir, "assistant.mjs");
writeFileSync(googleStub, "export function isConnected() { return true; }");
writeFileSync(assistantStub, `
export async function runAssistantTurn() {
  globalThis.__backgroundRouteCalls += 1;
  return { reply: "done", usedTools: [], sessionId: "session" };
}
`);

const jiti = createJiti(import.meta.url, { alias: {
  "@/extension/robin/google-calendar": googleStub,
  "@/lib/robin-assistant": assistantStub,
  "@": process.cwd(),
}, moduleCache: false });
const mailRoute = await jiti.import("./gmail/check/route.ts");
const roundRoute = await jiti.import("./rounds/scan/route.ts");
const backgroundRuns = await jiti.import("../../../extension/robin/background-run-domain.ts");

const request = () => new Request("http://localhost/api/robin/test", {
  method: "POST",
  headers: { "Content-Type": "application/json", Host: "localhost", Origin: "http://localhost" },
  body: JSON.stringify({ locale: "en" }),
});

for (const [label, route, runName] of [
  ["mail review", mailRoute, "mail-review"],
  ["hiring-round scan", roundRoute, "hiring-round-mail-scan"],
]) {
  test(`${label} reports a remote durable owner without spending another model turn`, async () => {
    assert.equal(backgroundRuns.claimBackgroundRun(runName, "another-runtime"), true);
    try {
      const response = await route.POST(request());
      assert.equal(response.status, 409);
      assert.equal((await response.json()).reason, "already-running");
      assert.equal(globalThis.__backgroundRouteCalls, 0);
    } finally {
      backgroundRuns.releaseBackgroundRun(runName, "another-runtime");
    }
  });
}
