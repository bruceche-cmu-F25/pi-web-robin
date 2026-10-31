import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const root = mkdtempSync(join(tmpdir(), "chat-reviews-route-"));
const stub = join(root, "runtime.mjs");
writeFileSync(stub, `
const state = () => globalThis.__chatReviewsRouteTest;
export const readSessionReviews = () => { if (state().error) throw Error("unavailable"); return state().reviews; };
export const listAllSessions = async () => { state().scans++; return state().sessions; };
export const getRunningRpcSessionIds = () => state().running;
export const acceptSessionReview = async (id, entryId) => { state().writes.push({ id, entryId }); if (state().error) throw Error("unavailable"); return state().accepted; };
`);
const route = await createJiti(import.meta.url, { alias: {
  "@/lib/session-reader": stub,
  "@/lib/rpc-manager": stub,
  "@/lib/session-ui-state": stub,
  "@": process.cwd(),
} }).import("./route.ts");
let state;
beforeEach(() => {
  state = globalThis.__chatReviewsRouteTest = {
    reviews: { chat: { entryId: "reply", completedAt: 123 } },
    sessions: [{ id: "chat", name: "The chat", firstMessage: "Hi", cwd: "/tmp" }],
    running: [], scans: 0, writes: [], accepted: true,
  };
});
after(() => { delete globalThis.__chatReviewsRouteTest; rmSync(root, { recursive: true, force: true }); });
const request = (body = { id: "chat", entryId: "reply" }, headers = {}) => new Request("http://localhost/api/sessions/reviews", {
  method: "POST", headers: { Host: "localhost", Origin: "http://localhost", "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
});

test("GET reads persisted completions without any mutation and hides running chats", async () => {
  const response = await route.GET();
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).reviews[0].title, "The chat");
  assert.deepEqual(state.writes, []);
  state.running = ["chat"];
  assert.deepEqual(await (await route.GET()).json(), { reviews: [] });
});

test("empty/accepted queues do not scan session files, read failure is not an empty success", async () => {
  state.reviews.chat.reviewed = true;
  assert.deepEqual(await (await route.GET()).json(), { reviews: [] });
  assert.equal(state.scans, 0);
  state.error = true;
  assert.equal((await route.GET()).status, 500);
});

test("POST checks origin, content type, shape and identifiers before any write", async () => {
  assert.equal((await route.POST(request(undefined, { Origin: "https://other.example" }))).status, 403);
  assert.equal((await route.POST(request(undefined, { "Content-Type": "text/plain" }))).status, 415);
  for (const body of [null, [], {}, { id: "../bad", entryId: "reply" }, { id: "chat", entryId: "x".repeat(129) }]) assert.equal((await route.POST(request(body))).status, 400);
  assert.deepEqual(state.writes, []);
});

test("POST confirms only the displayed entry and reports stale or failed writes", async () => {
  assert.deepEqual(await (await route.POST(request())).json(), { id: "chat", entryId: "reply" });
  assert.deepEqual(state.writes, [{ id: "chat", entryId: "reply" }]);
  state.accepted = false;
  assert.equal((await route.POST(request())).status, 409);
  state.error = true;
  assert.equal((await route.POST(request())).status, 500);
});
