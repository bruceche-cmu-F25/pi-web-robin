import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url).import("./web-push.ts");
}

const { createWebPushNotifier, localeText, parsePushNotification } = await loadSubject();
const NOTICE = { id: "jobs:2026-10-24:morning", title: "New jobs", body: "3 matching roles", url: "/dashboard/jobs", ttl: 120 };

test("generic push sends a bounded payload and reuses durable per-device receipts", async () => {
  const first = makeEnvironment();
  first.notifier.addSubscription(SUB_EN);
  assert.equal(first.notifier.subscriptionCount(), 1);
  assert.deepEqual(await first.notifier.sendNotification(NOTICE), { accepted: 1, failed: 0, expired: 0 });
  assert.deepEqual(JSON.parse(first.sent[0].payload), {
    title: NOTICE.title, body: NOTICE.body, url: NOTICE.url, tag: `robin:${NOTICE.id}`,
  });
  assert.equal(first.sent[0].ttl, 120);
  const restarted = makeEnvironment({ initialState: structuredClone(first.getSaved()) });
  restarted.notifier.addSubscription(SUB_ZH);
  assert.deepEqual(await restarted.notifier.sendNotification(NOTICE), { accepted: 2, failed: 0, expired: 0 });
  assert.equal(restarted.sent.length, 1, "retry sends only to the new device");
  assert.equal(restarted.sent[0].subscription.endpoint, SUB_ZH.endpoint);
});

test("reusing an accepted id for different content is refused rather than claiming an unsent batch", async () => {
  const { notifier, sent } = makeEnvironment();
  notifier.addSubscription(SUB_EN);
  await notifier.sendNotification(NOTICE);
  await assert.rejects(notifier.sendNotification({ ...NOTICE, body: "Different jobs" }), /different content/);
  assert.equal(sent.length, 1);
});

test("generic push distinguishes no subscribers, temporary failures and expired devices", async () => {
  const empty = makeEnvironment();
  assert.deepEqual(await empty.notifier.sendNotification(NOTICE), { accepted: 0, failed: 0, expired: 0 });
  const failed = makeEnvironment({ errorFor: () => ({ statusCode: 503 }) });
  failed.notifier.addSubscription(SUB_EN);
  assert.deepEqual(await failed.notifier.sendNotification(NOTICE), { accepted: 0, failed: 1, expired: 0 });
  assert.equal(failed.notifier.subscriptionCount(), 1);
  await failed.notifier.sendNotification(NOTICE);
  assert.equal(failed.sent.length, 2, "temporary failures are retryable");
  const partial = makeEnvironment({ errorFor: (sub) => sub === SUB_ZH ? { statusCode: 410 } : null });
  partial.notifier.addSubscription(SUB_EN);
  partial.notifier.addSubscription(SUB_ZH);
  assert.deepEqual(await partial.notifier.sendNotification(NOTICE), { accepted: 1, failed: 0, expired: 1 });
  assert.equal(partial.notifier.subscriptionCount(), 1);
});

test("concurrent duplicate ids share one delivery attempt", async () => {
  let release;
  let sends = 0;
  const notifier = createWebPushNotifier({
    loadState: () => ({ vapidKeys: { publicKey: "pub", privateKey: "priv" }, subscriptions: [SUB_EN] }),
    saveState() {}, generateVapidKeys: () => assert.fail("reuse existing keys"),
    send: () => { sends++; return new Promise(resolve => { release = resolve; }); },
  });
  const a = notifier.sendNotification(NOTICE);
  const b = notifier.sendNotification(NOTICE);
  assert.equal(a, b);
  release();
  await Promise.all([a, b]);
  assert.equal(sends, 1);
});

test("notification validation rejects unsafe URLs, invalid TTL and oversized payloads", () => {
  assert.deepEqual(parsePushNotification(NOTICE), NOTICE);
  for (const url of ["https://evil.test", "//evil.test", "/\\\\evil.test", "javascript:alert(1)"]) {
    assert.throws(() => parsePushNotification({ ...NOTICE, url }));
  }
  for (const ttl of [0, -1, 1.5, 86401, "60"]) assert.throws(() => parsePushNotification({ ...NOTICE, ttl }));
  assert.throws(() => parsePushNotification({ ...NOTICE, body: "x".repeat(501) }));
  assert.throws(() => parsePushNotification({ ...NOTICE, id: "bad\nkey" }));
});

test("push receipts are bounded and expired receipts do not suppress a new delivery", async () => {
  const env = makeEnvironment({ initialState: {
    vapidKeys: { publicKey: "pub", privateKey: "priv" }, subscriptions: [SUB_EN],
    receipts: [{ id: NOTICE.id, expiresAt: 0, endpoints: [SUB_EN.endpoint] }],
  } });
  await env.notifier.sendNotification(NOTICE);
  assert.equal(env.sent.length, 1);
  for (let i = 0; i < 140; i++) await env.notifier.sendNotification({ ...NOTICE, id: `test:${i}` });
  assert.ok(env.getSaved().receipts.length <= 128);
});

function makeEnvironment({
  initialState = null,
  errorFor = () => null,
} = {}) {
  let state = initialState;
  let saved = null;
  const sent = [];

  const env = {
    send: async (subscription, payload, vapidKeys, ttl) => {
      sent.push({ subscription, payload, vapidKeys, ttl });
      const error = errorFor(subscription);
      if (error) throw error;
    },
    loadState: () => state,
    saveState: (s) => { saved = s; },
    generateVapidKeys: () => ({ publicKey: "pub-key", privateKey: "priv-key" }),
  };

  return {
    notifier: createWebPushNotifier(env),
    sent,
    getSaved: () => saved,
  };
}

const SUB_EN = {
  endpoint: "https://push.example.com/en",
  keys: { p256dh: "p256dh-en", auth: "auth-en" },
  locale: "en",
};
const SUB_ZH = {
  endpoint: "https://push.example.com/zh",
  keys: { p256dh: "p256dh-zh", auth: "auth-zh" },
  locale: "zh-CN",
};

test("generates and persists VAPID keys when no state exists", () => {
  const { notifier, getSaved } = makeEnvironment();

  assert.equal(notifier.getVapidPublicKey(), "pub-key");
  assert.deepEqual(getSaved(), {
    vapidKeys: { publicKey: "pub-key", privateKey: "priv-key" },
    subscriptions: [],
  });
});

test("reuses persisted VAPID keys", () => {
  const { notifier } = makeEnvironment({
    initialState: {
      vapidKeys: { publicKey: "persisted-pub", privateKey: "persisted-priv" },
      subscriptions: [],
    },
  });

  assert.equal(notifier.getVapidPublicKey(), "persisted-pub");
});

test("addSubscription upserts by endpoint and persists", () => {
  const { notifier, getSaved } = makeEnvironment();

  notifier.addSubscription(SUB_EN);
  notifier.addSubscription(SUB_ZH);
  notifier.addSubscription({ ...SUB_EN, locale: "zh-CN" });

  const saved = getSaved();
  assert.equal(saved.subscriptions.length, 2);
  const updated = saved.subscriptions.find((s) => s.endpoint === SUB_EN.endpoint);
  assert.equal(updated.locale, "zh-CN");
});

test("addSubscription persists even after getVapidPublicKey already saved", () => {
  const { notifier, getSaved } = makeEnvironment();

  notifier.getVapidPublicKey(); // first save
  notifier.addSubscription(SUB_EN);

  assert.equal(getSaved().subscriptions.length, 1);
});

test("notifySessionComplete sends localized payloads with the session name", async () => {
  const { notifier, sent } = makeEnvironment();
  notifier.addSubscription(SUB_EN);
  notifier.addSubscription(SUB_ZH);

  await notifier.notifySessionComplete("session-1", "My session");

  assert.equal(sent.length, 2);
  const en = sent.find((s) => s.subscription.endpoint === SUB_EN.endpoint);
  const zh = sent.find((s) => s.subscription.endpoint === SUB_ZH.endpoint);
  assert.deepEqual(JSON.parse(en.payload), {
    title: "My session",
    body: "Task finished.",
    url: "/?session=session-1",
    tag: "pi-session-complete:session-1",
  });
  assert.deepEqual(JSON.parse(zh.payload), {
    title: "My session",
    body: "任务已完成。",
    url: "/?session=session-1",
    tag: "pi-session-complete:session-1",
  });
});

test("notifySessionComplete falls back to the localized generic title", async () => {
  const { notifier, sent } = makeEnvironment();
  notifier.addSubscription(SUB_ZH);

  await notifier.notifySessionComplete("unknown-session");

  assert.deepEqual(JSON.parse(sent[0].payload), {
    title: "任务完成",
    body: "任务已完成。",
    url: "/?session=unknown-session",
    tag: "pi-session-complete:unknown-session",
  });
});

test("notifySessionComplete prunes subscriptions dropped by the push service", async () => {
  const { notifier, sent, getSaved } = makeEnvironment({
    errorFor: (subscription) => subscription.endpoint === SUB_ZH.endpoint ? { statusCode: 410 } : null,
  });
  notifier.addSubscription(SUB_EN);
  notifier.addSubscription(SUB_ZH);

  await notifier.notifySessionComplete("session-1");

  assert.equal(sent.length, 2);
  const saved = getSaved();
  assert.deepEqual(saved.subscriptions.map((s) => s.endpoint), [SUB_EN.endpoint]);
});

test("localeText falls back to English for unknown locales", () => {
  assert.equal(localeText("zh-CN", "taskFinished"), "任务已完成。");
  assert.equal(localeText("ja", "taskFinished"), "Task finished.");
  assert.equal(localeText("en", "sessionComplete"), "Session complete");
});

test("push requests immediate delivery with a long TTL", async () => {
  const { PUSH_OPTIONS } = await loadSubject();

  // iOS may defer non-high-urgency pushes to an arbitrary later window.
  assert.equal(PUSH_OPTIONS.urgency, "high");
  assert.equal(PUSH_OPTIONS.TTL, 2419200);
});

test("vapidSubject defaults to a valid https URL, not mailto:localhost", async () => {
  const { vapidSubject } = await loadSubject();
  const subject = vapidSubject();
  assert.doesNotMatch(subject, /@localhost$/);
  assert.ok(subject.startsWith("https://") || subject.startsWith("mailto:"), subject);
});
