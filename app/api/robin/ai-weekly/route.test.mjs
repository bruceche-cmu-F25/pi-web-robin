import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createJiti } from "jiti";
const root = mkdtempSync(join(tmpdir(), "weekly-route-"));
const previous = process.env.ROBIN_DATA_DIR;
process.env.ROBIN_DATA_DIR = root;
globalThis.__weeklyRouteStarts = 0;
after(() => { rmSync(root, { recursive: true, force: true }); if (previous === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous; delete globalThis.__weeklyRouteStarts; });
const runner = join(root, "runner.mjs");
writeFileSync(runner, "export function startWeeklyGeneration() { globalThis.__weeklyRouteStarts++; return true; }");
const jiti = createJiti(import.meta.url, { alias: { "@/lib/ai-weekly-runner": runner, "@": process.cwd() }, moduleCache: false });
const route = await jiti.import("./route.ts");
function req(method, body, headers = {}, query = "") {
  return new Request(`http://localhost/api/robin/ai-weekly${query}`, { method,
    headers: { Host: "localhost", Origin: "http://localhost", "Content-Type": "application/json", ...headers },
    ...(method !== "GET" ? { body: JSON.stringify(body) } : {}) });
}
test("GET is read-only and the API does not leak Telegram credentials", async () => {
  const response = await route.GET(req("GET"));
  assert.equal(response.status, 200);
  const value = await response.json();
  assert.equal(value.edition, null); assert.equal(value.preferences.enabled, false);
  assert.equal(globalThis.__weeklyRouteStarts, 0);
  assert.ok(!JSON.stringify(value).includes("botToken"));
});
test("origin and JSON guards apply before generation or preference writes", async () => {
  assert.equal((await route.POST(req("POST", { action: "generate" }, { Origin: "https://evil.example" }))).status, 403);
  assert.equal((await route.POST(req("POST", { action: "generate" }, { "Content-Type": "text/plain" }))).status, 415);
  assert.equal((await route.PATCH(req("PATCH", { action: "preferences", preferences: { enabled: true } }, { Origin: "https://evil.example" }))).status, 403);
  assert.equal(globalThis.__weeklyRouteStarts, 0);
});
test("only explicit valid commands run; invalid reads/settings do not reset existing state", async () => {
  assert.equal((await route.POST(req("POST", { action: "anything" }))).status, 400);
  assert.equal((await route.PATCH(req("PATCH", { action: "preferences", preferences: { timezone: "Mars" } }))).status, 400);
  assert.equal((await route.PATCH(req("PATCH", { action: "read", week: "2026-06-15", date: "2026-06-15", read: true }))).status, 400);
  assert.equal((await route.PATCH(req("PATCH", { action: "preferences", preferences: { interests: "Agents and global research" } }))).status, 200);
  assert.equal((await route.GET(req("GET"))).status, 200);
  assert.equal((await route.POST(req("POST", { action: "generate" }))).status, 202);
  assert.equal(globalThis.__weeklyRouteStarts, 1);
});
