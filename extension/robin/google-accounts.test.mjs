import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const root = mkdtempSync(join(tmpdir(), "robin-accounts-"));
process.env.ROBIN_DATA_DIR = root;
process.env.ROBIN_GOOGLE_CLIENT_ID = "test-client";
process.env.ROBIN_GOOGLE_CLIENT_SECRET = "test-secret";
process.env.ROBIN_OUTREACH_GOOGLE_CLIENT_ID = "793594470575-personal.apps.googleusercontent.com";
process.env.ROBIN_OUTREACH_GOOGLE_CLIENT_SECRET = "personal-secret";
const settings = await import("./settings.ts");
const google = await import("./google-calendar.ts");
const mail = await import("./jarvis-mail.ts");
const oauth = await import("../../lib/google-oauth-state.ts");
const originalFetch = globalThis.fetch;
const primary = join(root, "google.json");
const outreach = join(root, "google-outreach.json");
const scopes = ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.readonly"];
const tokens = (email, accessToken) => ({ email, refreshToken: `refresh-${email}`, accessToken, accessTokenExpiresAt: Date.now() + 300000, scopes, connectedAt: new Date().toISOString() });
beforeEach(() => {
  globalThis.fetch = originalFetch;
  rmSync(outreach, { force: true });
  rmSync(join(root, "secrets.json"), { force: true });
  writeFileSync(primary, JSON.stringify(tokens("school@example.edu", "school-token")));
});
after(() => { globalThis.fetch = originalFetch; rmSync(root, { recursive: true, force: true }); });

test("OAuth states bind the account destination and are single-use", () => {
  const a = oauth.issueState();
  const b = oauth.issueState("outreach");
  assert.equal(oauth.consumeAccountState(b), "outreach");
  assert.equal(oauth.consumeAccountState(b), null);
  assert.equal(oauth.consumeAccountState(a), "primary");
  assert.equal(oauth.consumeAccountState("invented"), null);
  const primaryUrl = new URL(google.authorizeUrl("http://localhost/callback", "one"));
  const outreachUrl = new URL(google.authorizeUrl("http://localhost/callback", "two", "outreach"));
  assert.equal(primaryUrl.searchParams.get("client_id"), "test-client");
  assert.equal(outreachUrl.searchParams.get("client_id"), process.env.ROBIN_OUTREACH_GOOGLE_CLIENT_ID);
  assert.match(primaryUrl.searchParams.get("scope"), /calendar.readonly/);
  assert.doesNotMatch(primaryUrl.searchParams.get("scope"), /gmail.send/);
  assert.doesNotMatch(outreachUrl.searchParams.get("scope"), /calendar/);
  assert.match(outreachUrl.searchParams.get("scope"), /gmail.send/);
  assert.match(outreachUrl.searchParams.get("prompt"), /select_account/);
});

test("Cold Reach never falls back to the school grant, including reply checks", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("Unexpected network"); };
  assert.equal(google.isConnected(), true);
  assert.equal(google.isConnected("outreach"), false);
  await assert.rejects(() => mail.sendJarvisEmail("recipient@example.com", "Hi", "Hello"), /personal Gmail/);
  await assert.rejects(() => mail.readJarvisThread("old-message", "old-thread", "school@example.edu"), /personal Gmail/);
  assert.equal(calls, 0);
});

test("personal authorization and disconnect leave the school account intact", async () => {
  const originalSchool = readFileSync(primary, "utf8");
  globalThis.fetch = async (url, options) => {
    if (String(url).includes("oauth2.googleapis.com/token")) return Response.json({ refresh_token: "personal-refresh", access_token: "personal-token", expires_in: 3600, scope: scopes.join(" ") });
    assert.equal(url, "https://gmail.googleapis.com/gmail/v1/users/me/profile");
    assert.equal(options.headers.Authorization, "Bearer personal-token");
    return Response.json({ emailAddress: "Personal@example.com" });
  };
  await google.exchangeCode("code", "http://localhost/callback", "outreach");
  assert.equal(google.connectedGoogleEmail("outreach"), "personal@example.com");
  assert.equal(await google.getAccessToken(), "school-token");
  assert.equal(await google.getAccessToken("outreach"), "personal-token");
  assert.equal(readFileSync(primary, "utf8"), originalSchool);
  google.disconnect("outreach");
  assert.equal(google.isConnected("outreach"), false);
  assert.equal(readFileSync(primary, "utf8"), originalSchool);
});

test("message sends and thread reads use personal credentials and reject a different sender", async () => {
  writeFileSync(outreach, JSON.stringify(tokens("personal@example.com", "personal-token")));
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(options.headers.Authorization, "Bearer personal-token");
    return String(url).endsWith("/messages/send") ? Response.json({ id: "sent", threadId: "thread" }) : Response.json({ messages: [] });
  };
  await mail.sendJarvisEmail("recipient@example.com", "Hi", "Hello");
  await mail.readJarvisThread("sent", "thread", "personal@example.com");
  await assert.rejects(() => mail.readJarvisThread("old", "school-thread", "school@example.edu"), /sender changed/);
  await assert.rejects(() => mail.sendJarvisEmail("recipient@example.com", "Hi", "Hello", undefined, "other@example.com"), /sender changed/);
  const stopped = new AbortController();
  stopped.abort();
  await assert.rejects(() => mail.sendJarvisEmail("recipient@example.com", "Hi", "Hello", undefined, "personal@example.com", stopped.signal), { name: "AbortError" });
  assert.equal(calls, 2);
});

test("disconnect during refresh cannot restore personal credentials", async () => {
  writeFileSync(outreach, JSON.stringify({ ...tokens("personal@example.com", "expired"), accessTokenExpiresAt: 0 }));
  globalThis.fetch = async () => {
    google.disconnect("outreach");
    return Response.json({ access_token: "fresh", expires_in: 3600 });
  };
  await assert.rejects(() => google.getAccessToken("outreach"), /account changed/);
  assert.equal(google.isConnected("outreach"), false);
  assert.equal(await google.getAccessToken(), "school-token");
});


test("Cold Reach client configuration preserves school credentials and never appears in settings responses", () => {
  settings.setGoogleCredentials("school-client", "school-secret");
  assert.equal(settings.setOutreachGoogleCredentials("793594470575-new.apps.googleusercontent.com", "new-secret"), true);
  assert.deepEqual(google.readCredentials(), { clientId: "school-client", clientSecret: "school-secret" });
  assert.deepEqual(google.readCredentials("outreach"), { clientId: "793594470575-new.apps.googleusercontent.com", clientSecret: "new-secret" });
  assert.equal(settings.setOutreachGoogleCredentials("793594470575-new.apps.googleusercontent.com", "new-secret"), false);
  assert.throws(() => settings.setOutreachGoogleCredentials("invalid", "secret"), /Client ID/);
  assert.throws(() => settings.setOutreachGoogleCredentials("793594470575-new.apps.googleusercontent.com", ""), /secret/);
  assert.doesNotMatch(JSON.stringify(settings.settingsView()), /new-secret|school-secret/);
});

test("missing personal OAuth client does not fall back to the school's client", () => {
  const id = process.env.ROBIN_OUTREACH_GOOGLE_CLIENT_ID;
  const secret = process.env.ROBIN_OUTREACH_GOOGLE_CLIENT_SECRET;
  delete process.env.ROBIN_OUTREACH_GOOGLE_CLIENT_ID;
  delete process.env.ROBIN_OUTREACH_GOOGLE_CLIENT_SECRET;
  try {
    assert.equal(google.readCredentials("outreach"), null);
    assert.ok(google.readCredentials());
    assert.throws(() => google.authorizeUrl("http://localhost/callback", "state", "outreach"), /not configured/);
  } finally {
    process.env.ROBIN_OUTREACH_GOOGLE_CLIENT_ID = id;
    process.env.ROBIN_OUTREACH_GOOGLE_CLIENT_SECRET = secret;
  }
});
