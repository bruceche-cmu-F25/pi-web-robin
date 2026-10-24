import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { GET, POST } = await jiti.import("./route.ts");
let calls;
let accepted;
beforeEach(() => {
  calls = [];
  accepted = 1;
  // Never touch real credentials/subscriptions and never call a push provider.
  globalThis.__piWebPushNotifierVersion = 3;
  globalThis.__piWebPushNotifier = Promise.resolve({
    subscriptionCount: () => 1,
    sendNotification: async (payload) => { calls.push(payload); return { accepted, failed: accepted ? 0 : 1, expired: 0 }; },
  });
});
afterEach(() => { delete globalThis.__piWebPushNotifier; delete globalThis.__piWebPushNotifierVersion; });
const notice = { id: "test:1", title: "Test", body: "Hello", url: "/dashboard", ttl: 60 };
function request(method, body = notice, headers = {}) {
  return new Request("http://localhost:30141/api/push/send", {
    method, headers: { host: "localhost:30141", "content-type": "application/json", ...headers },
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
  });
}

test("status reveals only subscription count and accepted sends return delivery counts", async () => {
  assert.deepEqual(await (await GET(request("GET"))).json(), { subscriptions: 1 });
  const response = await POST(request("POST"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { accepted: 1, failed: 0, expired: 0 });
  assert.deepEqual(calls, [notice]);
});

test("zero accepted subscriptions is a failed delivery, not a successful empty broadcast", async () => {
  accepted = 0;
  assert.equal((await POST(request("POST"))).status, 503);
});

test("cross-origin, wrong media type and malformed payloads never reach the notifier", async () => {
  assert.equal((await POST(request("POST", notice, { origin: "https://evil.test" }))).status, 403);
  assert.equal((await GET(request("GET", undefined, { origin: "https://evil.test" }))).status, 403);
  assert.equal((await POST(request("POST", notice, { "content-type": "text/plain" }))).status, 415);
  for (const value of [null, {}, [], { ...notice, url: "//evil.test" }, { ...notice, ttl: 0 }, { ...notice, title: "" }]) {
    assert.equal((await POST(request("POST", value))).status, 400);
  }
  assert.deepEqual(calls, []);
});
