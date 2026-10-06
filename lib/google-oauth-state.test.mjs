import assert from "node:assert/strict";
import { test } from "node:test";
import { redirectUriFor, issueState, consumeAccountState, consumeOAuthState } from "./google-oauth-state.ts";

test("OAuth redirect keeps the browser's HTTP origin when a relay rewrites the request scheme", () => {
  const req = new Request("https://localhost:30141/api/robin/google", { method: "POST", headers: { host: "localhost:30141", origin: "http://localhost:30141", "x-forwarded-proto": "https", "sec-fetch-site": "same-origin" } });
  assert.equal(redirectUriFor(req), "http://localhost:30141/api/robin/google/callback");
});

test("OAuth redirect preserves real HTTPS and ignores unrelated origins", () => {
  assert.equal(redirectUriFor(new Request("https://robin.example/api/robin/google", { headers: { host: "robin.example", origin: "https://robin.example" } })), "https://robin.example/api/robin/google/callback");
  assert.equal(redirectUriFor(new Request("http://localhost:30141/api/robin/google", { headers: { host: "localhost:30141", origin: "https://attacker.example" } })), "http://localhost:30141/api/robin/google/callback");
  assert.equal(redirectUriFor(new Request("http://localhost:30141/api/robin/google", { headers: { host: "localhost:30141", origin: "http://localhost:9999" } })), "http://localhost:30141/api/robin/google/callback");
});

test("account state remains single-use", () => {
  const state = issueState("outreach");
  assert.equal(consumeAccountState(state), "outreach");
  assert.equal(consumeAccountState(state), null);
});


test("token exchange retains the exact original redirect URI regardless of the callback request scheme", () => {
  const uri = "http://localhost:30141/api/robin/google/callback";
  const state = issueState("outreach", uri);
  assert.deepEqual(consumeOAuthState(state), { account: "outreach", redirectUri: uri });
  assert.equal(consumeOAuthState(state), null);
});
