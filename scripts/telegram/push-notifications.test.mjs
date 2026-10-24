import assert from "node:assert/strict";
import test from "node:test";
import { readConfig, sendDailyAgenda, sendGmailDigest, sendJobDigest, runDigests, runScheduledReminders, startScheduleLoop, handleMessage } from "./bridge.ts";
import { scheduledPush } from "./push-notifications.ts";

const now = new Date(2026, 9, 24, 10, 0).getTime();
const config = (over = {}) => ({
  token: "", allowlist: [], notificationChannel: "push", piWebUrl: "http://localhost:30141",
  dailyAgenda: { enabled: false, time: "08:00", locale: "zh" },
  gmailDigest: { enabled: false, time: "08:00", locale: "zh", query: "newer_than:1d", chatIds: [] },
  jobDigest: { enabled: false, morning: "08:00", evening: "20:00", count: 10, locale: "zh", chatIds: [], sweepAt: "" },
  reminders: { enabled: false, lead: 30, locale: "zh", chatIds: [] },
  ...over,
});
function ledger() {
  const rows = new Map();
  return {
    rows, pending: (key, audience) => audience.filter(id => !(rows.get(key) ?? []).includes(id)),
    mark: (key, id) => rows.set(key, [...new Set([...(rows.get(key) ?? []), id])]),
  };
}
function env(respond = () => undefined) {
  const calls = [];
  const logs = [];
  const deps = {
    now: () => now, log: text => logs.push(text), googleConnected: () => true,
    dailyAgendaLedger: ledger(), gmailLedger: ledger(), jobLedger: ledger(), reminderLedger: ledger(),
    fetch: async (url, init) => {
      const call = { path: new URL(url).pathname, method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : null };
      calls.push(call);
      const supplied = await respond(call);
      const body = supplied?.body ?? (call.path === "/api/push/send"
        ? (call.method === "GET" ? { subscriptions: 1 } : { accepted: 1, failed: 0, expired: 0 })
        : call.path === "/api/robin/assistant" ? { reply: "**明天截止** [申请](https://example.test)", usedTools: [] }
        : call.path === "/api/robin/jobs/digest" ? { text: "1. Acme Engineer", jobIds: ["j1"], count: 1, pending: 0 }
        : call.path === "/api/robin/events" ? { today: "2026-10-24", events: [{ id: "a", title: "Meeting", date: "2026-10-24", start: "10:20" }] }
        : {});
      return { ok: (supplied?.status ?? 200) < 400, status: supplied?.status ?? 200, json: async () => body };
    },
  };
  return { deps, calls, logs };
}
const pushes = calls => calls.filter(c => c.path === "/api/push/send" && c.method === "POST");

test("push mode starts without a Telegram token or chat ids", () => {
  const parsed = readConfig({}, { notificationChannel: "push", allowedChatIds: [] });
  assert.equal(parsed.token, "");
  assert.equal(parsed.notificationChannel, "push");
  assert.deepEqual(parsed.allowlist, []);
});

test("agenda and mail use phone delivery only, with local destinations and ledger receipts", async () => {
  for (const [send, ledgerName, url] of [[sendDailyAgenda, "dailyAgendaLedger", "/dashboard"], [sendGmailDigest, "gmailLedger", "/dashboard/gmail"]]) {
    const { deps, calls } = env();
    await send(config(), deps, "2026-10-24");
    assert.equal(pushes(calls).length, 1);
    assert.equal(pushes(calls)[0].body.url, url);
    assert.doesNotMatch(pushes(calls)[0].body.body, /\*|https:/);
    assert.deepEqual(deps[ledgerName].rows.get("2026-10-24"), [0]);
    assert.equal(calls.some(c => c.path.includes("/bot") || c.path === "/api/robin/todos"), false);
  }
});

test("job delivery claims only after push acceptance; no matches sends no notification", async () => {
  for (const status of [200, 503]) {
    const { deps, calls } = env(call => call.path === "/api/push/send" ? { status, body: { accepted: status === 200 ? 1 : 0 } } : undefined);
    await sendJobDigest(config(), deps, "2026-10-24:morning");
    assert.equal(calls.some(c => c.body?.claim), status === 200);
    assert.equal(deps.jobLedger.rows.has("2026-10-24:morning"), status === 200);
    assert.equal(pushes(calls)[0].body.url, "/dashboard/jobs");
  }
  const { deps, calls } = env(call => call.path === "/api/robin/jobs/digest" ? { body: { text: "No jobs", jobIds: [], count: 0, pending: 0 } } : undefined);
  await sendJobDigest(config(), deps, "2026-10-24:morning");
  assert.deepEqual(pushes(calls), []);
  assert.deepEqual(deps.jobLedger.rows.get("2026-10-24:morning"), [0]);
});

test("scheduled slots are not regenerated after acceptance, and no subscriber means no paid work", async () => {
  const ready = env();
  const configured = config({ dailyAgenda: { enabled: true, time: "08:00", locale: "zh" } });
  await runDigests(configured, ready.deps);
  await runDigests(configured, ready.deps);
  assert.equal(pushes(ready.calls).length, 1);
  assert.equal(ready.calls.filter(c => c.path === "/api/robin/assistant").length, 1);
  const absent = env(() => ({ body: { subscriptions: 0 } }));
  await runDigests(configured, absent.deps);
  assert.equal(absent.calls.length, 1);
});

test("switching channels does not replay completed digests or restart the nightly sweep", async () => {
  const { deps, calls } = env();
  const configured = config({ allowlist: [42],
    dailyAgenda: { enabled: true, time: "08:00", locale: "zh" },
    gmailDigest: { enabled: true, time: "08:00", locale: "zh", query: "newer_than:1d", chatIds: [] },
    jobDigest: { enabled: true, morning: "08:00", evening: "20:00", count: 10, locale: "zh", chatIds: [], sweepAt: "03:00" },
  });
  deps.dailyAgendaLedger.mark("2026-10-24", 42);
  deps.gmailLedger.mark("2026-10-24", 42);
  deps.jobLedger.mark("2026-10-24:sweep", 42);
  deps.jobLedger.mark("2026-10-24:morning", 42);
  await runDigests(configured, deps);
  assert.deepEqual(calls.map(c => c.path), ["/api/push/send"]);
});

test("only a fresh structured FYI-only mail review suppresses the phone alert", async () => {
  for (const fresh of [true, false]) {
    const { deps, calls } = env(call => call.path === "/api/robin/gmail" ? { body: { review: {
      day: "2026-10-24", reviewedAt: new Date(now - (fresh ? 0 : 86400000)).toISOString(),
      items: [{ triage: "fyi" }], headline: "Nothing needs attention",
    } } } : undefined);
    await sendGmailDigest(config(), deps, "2026-10-24");
    assert.equal(pushes(calls).length, fresh ? 0 : 1);
    assert.deepEqual(deps.gmailLedger.rows.get("2026-10-24"), [0]);
  }
});

test("reminders have a stable event id, local destination and TTL ending at event start", async () => {
  const { deps, calls } = env();
  const configured = config({ reminders: { enabled: true, lead: 30, locale: "zh", chatIds: [] } });
  await runScheduledReminders(configured, deps);
  await runScheduledReminders(configured, deps);
  assert.equal(pushes(calls).length, 1);
  assert.equal(pushes(calls)[0].body.ttl, 20 * 60);
  assert.equal(pushes(calls)[0].body.url, "/dashboard");
  assert.match(pushes(calls)[0].body.id, /^reminder:/);
});

test("the independent timer checks reminders while a digest is stalled and never overlaps that digest", async (t) => {
  let release;
  let turns = 0;
  let calendars = 0;
  const { deps } = env(call => {
    if (call.path === "/api/robin/assistant") {
      turns++;
      return new Promise(resolve => { release = () => resolve({ body: { reply: "done", usedTools: [] } }); });
    }
    if (call.path === "/api/robin/events") calendars++;
  });
  const configured = config({ dailyAgenda: { enabled: true, time: "08:00", locale: "en" }, reminders: { enabled: true, lead: 30, locale: "en", chatIds: [] } });
  t.mock.timers.enable({ apis: ["setInterval"] });
  const stop = startScheduleLoop(() => configured, deps);
  t.after(stop);
  const flush = () => new Promise(resolve => setImmediate(resolve));
  await flush();
  assert.equal(turns, 1);
  assert.equal(calendars, 1);
  t.mock.timers.tick(30_000);
  await flush();
  assert.equal(turns, 1);
  assert.equal(calendars, 2, "no Telegram polling or digest completion is needed for the next reminder tick");
  release();
  await flush();
  stop();
  t.mock.timers.tick(30_000);
  await flush();
  assert.equal(calendars, 2);
});

test("a channel changed during generation prevents delivery on the old channel", async () => {
  const { deps, calls } = env();
  deps.reloadConfig = () => config({ notificationChannel: "telegram" });
  await sendDailyAgenda(config(), deps, "2026-10-24");
  assert.equal(pushes(calls).length, 0);
  assert.equal(deps.dailyAgendaLedger.rows.size, 0);
});

test("push preference never redirects interactive Telegram replies", async () => {
  const { deps, calls } = env(call => call.path.includes("/bot") ? { body: { ok: true, result: { message_id: 1 } } } : undefined);
  await handleMessage(config({ token: "TEST", allowlist: [42] }), deps, { updateId: 1, messageId: 1, chatId: 42, from: "user", text: "hello" });
  assert.equal(pushes(calls).length, 0);
  assert.ok(calls.some(c => c.path.endsWith("sendMessage")));
});

test("notification summaries fit a lock screen and occurrence ids are stable", () => {
  const a = scheduledPush("jobs", "2026-10-24:morning", "新".repeat(600), "zh");
  const b = scheduledPush("jobs", "2026-10-24:morning", "different text", "zh");
  assert.equal(a.id, b.id);
  assert.ok(Array.from(a.body).length <= 180);
  assert.notEqual(a.id, scheduledPush("jobs", "2026-10-24:evening", "text", "en").id);
});
