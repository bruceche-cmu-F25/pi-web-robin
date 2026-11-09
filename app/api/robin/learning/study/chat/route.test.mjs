import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createJiti } from "jiti";

const prior = process.env.ROBIN_DATA_DIR;
const dir = mkdtempSync(join(tmpdir(), "robin-planner-chat-"));
process.env.ROBIN_DATA_DIR = dir;
after(() => { rmSync(dir, { recursive: true, force: true }); if (prior === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = prior; });
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { POST, DELETE } = await jiti.import("./route.ts");
const { readStudyPlan } = await jiti.import("../../../../../../extension/robin/study-plan-domain.ts");
const request = (method, body, origin) => new Request("http://localhost:30141/api/robin/learning/study/chat", {
  method, headers: { host: "localhost:30141", "content-type": "application/json", ...(origin ? { origin } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

test("planner chat rejects stale weeks and malformed drafts before starting an agent", async () => {
  const week = readStudyPlan().week.week;
  assert.equal((await POST(request("POST", { week, message: "Hello" }, "https://evil.example"))).status, 403);
  assert.equal((await POST(request("POST", { week, message: "  " }))).status, 400);
  assert.equal((await POST(request("POST", { week: "2020-01-01", message: "Hello" }))).status, 409);
  assert.equal((await POST(request("POST", { week, message: "Hello", draft: "not-json" }))).status, 400);
  assert.equal((await POST(request("POST", { week, message: "Hello", draft: JSON.stringify({ objective: "Plan", milestones: [{ title: "X".repeat(121) }] }) }))).status, 400);
  assert.equal((await DELETE(request("DELETE"))).status, 200);
});
