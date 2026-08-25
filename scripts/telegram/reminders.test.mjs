import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dueReminders,
  formatReminder,
  minutesOfDay,
  reminderKey,
  runReminders,
} from "./reminders.ts";

const event = (over) => ({ id: "e1", title: "Standup", date: "2026-08-23", start: "09:00", ...over });

/** An in-memory DeliveryLedger with its runs exposed for assertions. */
function ledger() {
  const runs = new Map();
  return {
    pending(key, audience) {
      const sent = runs.get(key) ?? [];
      return audience.filter((id) => !sent.includes(id));
    },
    mark(key, chatId) {
      const sent = runs.get(key) ?? [];
      if (!sent.includes(chatId)) runs.set(key, [...sent, chatId]);
    },
    runs,
  };
}

test("minutesOfDay parses wall-clock times and refuses anything else", () => {
  assert.equal(minutesOfDay("09:30"), 570);
  assert.equal(minutesOfDay("00:00"), 0);
  assert.equal(minutesOfDay("23:59"), 1439);
  assert.equal(minutesOfDay(undefined), null);
  assert.equal(minutesOfDay("9am"), null);
  assert.equal(minutesOfDay("24:00"), null, "an out-of-range hour is not a time");
  assert.equal(minutesOfDay("10:75"), null);
});

test("only events inside the lead window are due", () => {
  const events = [
    event({ id: "soon", start: "09:20" }),
    event({ id: "later", start: "11:00" }),
    event({ id: "past", start: "08:00" }),
  ];
  const due = dueReminders(events, "2026-08-23", 9 * 60, 30);
  assert.deepEqual(due.map((e) => e.id), ["soon"]);
});

test("an event that has already started is not a reminder", () => {
  // Otherwise a restart mid-morning would replay the whole morning.
  const due = dueReminders([event({ start: "09:00" })], "2026-08-23", 9 * 60, 30);
  assert.deepEqual(due, [], "the exact start minute is already too late");
});

test("all-day events are skipped, having no moment to be early for", () => {
  const due = dueReminders(
    [event({ id: "allday", start: undefined })],
    "2026-08-23",
    9 * 60,
    120,
  );
  assert.deepEqual(due, []);
});

test("a multi-day event reminds on its first day only", () => {
  const trip = event({ id: "trip", date: "2026-08-20", endDate: "2026-08-25", start: "09:20" });
  assert.deepEqual(dueReminders([trip], "2026-08-23", 9 * 60, 30), [], "day four is not a start");
  assert.deepEqual(
    dueReminders([trip], "2026-08-20", 9 * 60, 30).map((e) => e.id),
    ["trip"],
  );
});

test("events on another day never fire", () => {
  assert.deepEqual(dueReminders([event({ date: "2026-08-24" })], "2026-08-23", 8 * 60 + 50, 30), []);
});

test("due reminders come back in start order", () => {
  const due = dueReminders(
    [event({ id: "b", start: "09:25" }), event({ id: "a", start: "09:05" })],
    "2026-08-23",
    9 * 60,
    60,
  );
  assert.deepEqual(due.map((e) => e.id), ["a", "b"]);
});

test("a reminder says how long you have and where to be", () => {
  const text = formatReminder(event({ start: "09:20", location: "Room B" }), 9 * 60, "en");
  assert.match(text, /Standup/);
  assert.match(text, /Starting in 20 min/);
  assert.match(text, /Room B/);
  assert.match(formatReminder(event({ start: "09:20" }), 9 * 60, "zh"), /20 分钟后开始/);
});

test("the claim key is per event per day, so a weekly meeting recurs", () => {
  assert.equal(reminderKey("2026-08-23", "e1"), "2026-08-23:e1");
  assert.notEqual(reminderKey("2026-08-30", "e1"), reminderKey("2026-08-23", "e1"));
});

/** A pi-web that answers the calendar GET with a fixed feed. */
function calendar(body, ok = true) {
  return async () => ({ ok, status: ok ? 200 : 500, json: async () => body });
}

const baseRun = (over = {}) => ({
  ctx: { url: "http://127.0.0.1:30141", fetch: calendar({ events: [], today: "2026-08-23" }) },
  ledger: ledger(),
  audience: [42],
  leadMinutes: 30,
  locale: "en",
  // 09:00 local on the day the fixtures use.
  now: () => new Date(2026, 7, 23, 9, 0).getTime(),
  log: () => {},
  send: async () => {},
  ...over,
});

test("a due event is sent once and then claimed", async () => {
  const sent = [];
  const shared = ledger();
  const run = baseRun({
    ctx: {
      url: "http://x",
      fetch: calendar({ events: [event({ start: "09:20" })], today: "2026-08-23" }),
    },
    ledger: shared,
    send: async (chatId, text) => { sent.push({ chatId, text }); },
  });

  await runReminders(run);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Standup/);

  // The loop comes round again a moment later; nothing should be resent.
  await runReminders(run);
  assert.equal(sent.length, 1, "a claimed reminder must not repeat every poll cycle");
});

test("a send failure leaves the reminder unclaimed so the next cycle retries", async () => {
  let attempts = 0;
  const run = baseRun({
    ctx: {
      url: "http://x",
      fetch: calendar({ events: [event({ start: "09:20" })], today: "2026-08-23" }),
    },
    send: async () => { attempts += 1; throw new Error("Telegram is down"); },
  });
  await runReminders(run);
  await runReminders(run);
  assert.equal(attempts, 2, "an unsent reminder is still worth sending while the event is future");
});

test("an unreadable calendar is logged, not thrown", async () => {
  const logs = [];
  await runReminders(baseRun({
    ctx: { url: "http://x", fetch: calendar({ error: "boom" }, false) },
    log: (message) => logs.push(message),
    send: async () => { throw new Error("must not be reached"); },
  }));
  assert.match(logs.join("\n"), /could not read the calendar/);
});

test("an empty audience does not even read the calendar", async () => {
  let called = false;
  await runReminders(baseRun({
    audience: [],
    ctx: { url: "http://x", fetch: async () => { called = true; throw new Error("no"); } },
  }));
  assert.equal(called, false);
});

test("a feed without a date is skipped rather than guessed at", async () => {
  const sent = [];
  await runReminders(baseRun({
    ctx: { url: "http://x", fetch: calendar({ events: [event({ start: "09:20" })] }) },
    send: async (chatId) => { sent.push(chatId); },
  }));
  assert.deepEqual(sent, []);
});
