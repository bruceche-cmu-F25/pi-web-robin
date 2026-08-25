import assert from "node:assert/strict";
import { test } from "node:test";
import { createKeyboardMemory } from "./callbacks.ts";
import {
  askAssistant,
  gmailAudience,
  handleCallback,
  handleMessage,
  jobAudience,
  pollOnce,
  readConfig,
  sendDailyAgenda,
  sendGmailDigest,
  sendJobDigest,
  sendMessage,
  runSchedules,
  startNightlySweep,
} from "./bridge.ts";

const config = (over = {}) => ({
  token: "TOKEN",
  allowlist: [42],
  piWebUrl: "http://127.0.0.1:30141",
  dailyAgenda: { enabled: false, time: "08:00", locale: "en" },
  jobDigest: {
    enabled: false, morning: "08:00", evening: "20:00", count: 10,
    locale: "en", chatIds: [], sweepAt: "03:00",
  },
  gmailDigest: { enabled: false, time: "08:00", locale: "en", chatIds: [], query: "newer_than:1d" },
  reminders: { enabled: false, lead: 30, locale: "en", chatIds: [] },
  transcription: { enabled: false, baseUrl: "https://api.openai.com/v1", model: "whisper-1" },
  ...over,
});

/**
 * Records every call and replies from a scripted queue keyed by URL fragment.
 *
 * Typing indicators are recorded apart from `calls`: they are decoration sent
 * around every turn, and folding them in would shift the index of every
 * assertion about what was actually said. One test below covers them directly.
 */
function fakeFetch(routes) {
  const calls = [];
  const chatActions = [];
  const fetch = async (url, init) => {
    // Only JSON bodies parse; the transcription call posts multipart FormData.
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
    if (String(url).includes("sendChatAction")) {
      chatActions.push(body);
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    calls.push({ url: String(url), body, init });
    for (const [fragment, responder] of Object.entries(routes)) {
      if (String(url).includes(fragment)) {
        const value = typeof responder === "function" ? responder(calls.length) : responder;
        return {
          ok: value.ok ?? true,
          status: value.status ?? 200,
          json: async () => value.body,
          // Transcription answers text/plain, not JSON.
          text: async () => (typeof value.body === "string" ? value.body : JSON.stringify(value.body)),
          arrayBuffer: async () => value.buffer ?? new ArrayBuffer(0),
        };
      }
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  return { fetch, calls, chatActions };
}

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

const deps = (
  fetch,
  logs = [],
  ledgers = {},
  googleConnected = () => true,
  extra = {},
) => ({
  fetch,
  log: (message) => logs.push(message),
  now: () => 0,
  dailyAgendaLedger: ledgers.agenda ?? ledger(),
  jobLedger: ledgers.job ?? ledger(),
  gmailLedger: ledgers.gmail ?? ledger(),
  reminderLedger: ledgers.reminder ?? ledger(),
  googleConnected,
  ...extra,
});

test("an unlisted chat reaches neither the agent nor Telegram", async () => {
  const { fetch, calls } = fakeFetch({});
  const logs = [];
  await handleMessage(config(), deps(fetch, logs), {
    updateId: 1, messageId: 10, chatId: 999, from: "stranger", text: "delete all my todos",
  });

  assert.deepEqual(calls, [], "no agent call, and no reply that would confirm the bot exists");
  assert.match(logs.join("\n"), /refused/);
});

test("discovery mode reports the chat id and still refuses to act", async () => {
  const { fetch, calls } = fakeFetch({});
  const logs = [];
  await handleMessage(config({ allowlist: [] }), deps(fetch, logs), {
    updateId: 1, chatId: 12345, from: "bruce", text: "hi",
  });

  assert.deepEqual(calls, []);
  const output = logs.join("\n");
  assert.match(output, /discovery/);
  assert.match(output, /12345/, "the id must be shown so it can be added");
  assert.match(output, /TELEGRAM_ALLOWED_CHAT_IDS=12345/);
});

test("an allowed chat is forwarded and answered", async () => {
  const { fetch, calls } = fakeFetch({
    "/api/robin/assistant": { body: { reply: "Added todo: buy milk.", usedTools: ["todo_add"] } },
    "sendMessage": { body: { ok: true, result: { message_id: 500 } } },
  });
  await handleMessage(config(), deps(fetch), {
    updateId: 1, messageId: 10, chatId: 42, from: "bruce", text: "remember to buy milk",
  });

  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/api\/robin\/assistant$/);
  assert.equal(calls[0].body.message, "remember to buy milk");
  assert.match(calls[1].url, /sendMessage$/);
  assert.equal(calls[1].body.chat_id, 42);
  assert.equal(calls[1].body.text, "Added todo: buy milk.\n\n— added a todo");
});

test("a photo is downloaded and forwarded to the assistant as an image", async () => {
  const { fetch, calls } = fakeFetch({
    "getFile": { body: { ok: true, result: { file_path: "photos/file_1.jpg" } } },
    "file/botTOKEN/photos/file_1.jpg": { buffer: new TextEncoder().encode("JPEGDATA").buffer },
    "/api/robin/assistant": { body: { reply: "That is a screenshot.", usedTools: [] } },
    "sendMessage": { body: { ok: true, result: { message_id: 500 } } },
  });
  await handleMessage(config(), deps(fetch), {
    updateId: 1,
    chatId: 42,
    from: "bruce",
    text: "what is this?",
    photos: [{ fileId: "big-id", width: 400, height: 400 }],
  });

  const getFile = calls.find((call) => call.url.includes("getFile"));
  assert.equal(getFile.body.file_id, "big-id", "getFile must ask for the photo's file id");

  const assistant = calls.find((call) => call.url.includes("/api/robin/assistant"));
  assert.equal(assistant.body.message, "what is this?");
  assert.equal(assistant.body.images.length, 1);
  assert.equal(assistant.body.images[0].type, "image");
  assert.equal(assistant.body.images[0].mimeType, "image/jpeg");
  assert.equal(assistant.body.images[0].data, Buffer.from("JPEGDATA").toString("base64"));
});

test("an agent failure is reported back to the authorized sender", async () => {
  const { fetch, calls } = fakeFetch({
    "/api/robin/assistant": { ok: false, status: 500, body: { error: "The assistant took too long to respond." } },
    "sendMessage": { body: { ok: true, result: { message_id: 500 } } },
  });
  const logs = [];
  await handleMessage(config(), deps(fetch, logs), {
    updateId: 1, chatId: 42, from: "bruce", text: "x",
  });

  const sent = calls.find((call) => call.url.includes("sendMessage"));
  assert.match(sent.body.text, /Something went wrong: The assistant took too long/);
  assert.match(logs.join("\n"), /\[error\]/);
});

test("a long reply is sent as several messages", async () => {
  const { fetch, calls } = fakeFetch({
    "/api/robin/assistant": { body: { reply: "x".repeat(9000), usedTools: [] } },
    "sendMessage": { body: { ok: true, result: { message_id: 500 } } },
  });
  await handleMessage(config(), deps(fetch), { updateId: 1, chatId: 42, from: "b", text: "x" });

  const sends = calls.filter((call) => call.url.includes("sendMessage"));
  assert.equal(sends.length, 3);
  for (const send of sends) assert.ok(send.body.text.length <= 4096);
});

test("pollOnce advances the offset past everything it saw", async () => {
  const { fetch, calls } = fakeFetch({
    "getUpdates": {
      body: {
        ok: true,
        result: [
          { update_id: 100, message: { message_id: 1, chat: { id: 42 }, from: {}, text: "hi" } },
          { update_id: 101, message: { message_id: 2, chat: { id: 42 }, sticker: {} } },
        ],
      },
    },
    "/api/robin/assistant": { body: { reply: "hello", usedTools: [] } },
    "sendMessage": { body: { ok: true, result: { message_id: 500 } } },
  });

  const next = await pollOnce(config(), deps(fetch), null);
  assert.equal(next, 102);
  assert.equal(calls[0].body.offset, undefined, "the first poll has no offset");
  assert.deepEqual(calls[0].body.allowed_updates, ["message", "callback_query"]);
});

test("pollOnce keeps the previous offset when nothing arrives", async () => {
  const { fetch } = fakeFetch({ "getUpdates": { body: { ok: true, result: [] } } });
  assert.equal(await pollOnce(config(), deps(fetch), 500), 500);
});

test("daily agenda asks for both sources and broadcasts to allowed chats", async () => {
  const { fetch, calls } = fakeFetch({
    "/api/robin/assistant": { body: { reply: "今日简报", usedTools: ["todo_list", "calendar_list_events"] } },
    "sendMessage": { body: { ok: true, result: { message_id: 500 } } },
  });
  const dailyConfig = config({
    allowlist: [42, 43],
    dailyAgenda: { enabled: true, time: "08:00", locale: "zh" },
  });
  const agenda = ledger();
  await sendDailyAgenda(dailyConfig, deps(fetch, [], { agenda }), "2026-08-17");

  assert.match(calls[0].body.message, /todo_list/);
  assert.match(calls[0].body.message, /calendar_list_events/);
  assert.equal(calls[0].body.readOnly, true);
  assert.deepEqual(
    calls.filter((call) => call.url.includes("sendMessage")).map((call) => call.body.chat_id),
    [42, 43],
  );
  assert.deepEqual(agenda.runs.get("2026-08-17"), [42, 43]);
});

test("the pi-web password is sent as basic auth when configured", async () => {
  const { fetch, calls } = fakeFetch({
    "/api/robin/assistant": { body: { reply: "ok", usedTools: [] } },
  });
  await askAssistant(config({ password: "s3cret" }), deps(fetch), "hi");
  const header = calls[0].init.headers.Authorization;
  assert.equal(Buffer.from(header.replace("Basic ", ""), "base64").toString(), "pi:s3cret");
});

/* ── job digest ── */

const schedule = { enabled: true, morning: "08:00", evening: "20:00", count: 10, locale: "en", sweepAt: "03:00", chatIds: [] };

test("the digest scans, scores in the narrow mode, then claims only what it sent", async () => {
  const { fetch, calls } = fakeFetch({
    "/api/robin/jobs/scan": { body: { scan: { scanned: 1200, matched: 30, added: 4 } } },
    "/api/robin/jobs/score": { body: { started: true, scoring: { running: false } } },
    "/api/robin/jobs/digest": {
      body: { text: "1. 4.6 Acme — AI Engineer\n   https://a/1", jobIds: ["j1"], count: 1, pending: 40, scoreBatch: 40 },
    },
    "sendMessage": { body: { ok: true, result: { message_id: 500 } } },
  });
  const job = ledger();
  await sendJobDigest(config({ jobDigest: schedule }), deps(fetch, [], { job }), "2026-08-17:morning");

  const paths = calls.map((call) => call.url.replace("http://127.0.0.1:30141", "").split("?")[0]);
  assert.ok(paths[0].endsWith("/api/robin/jobs/scan"));
  // The backlog is read first, because it decides whether to score at all.
  assert.equal(calls[1].body.preview, true);
  assert.ok(paths[2].endsWith("/api/robin/jobs/score"), "scoring is delegated, not re-implemented here");

  const sends = calls.filter((call) => call.url.includes("sendMessage"));
  assert.equal(sends.length, 1);
  assert.match(sends[0].body.text, /https:\/\/a\/1/);

  const claim = calls.at(-1);
  assert.deepEqual(claim.body.claim, ["j1"], "claimed after delivery, not before");
  assert.deepEqual(job.runs.get("2026-08-17:morning"), [42]);
});

test("a failed send claims nothing, so the same jobs are offered again", async () => {
  const { fetch, calls } = fakeFetch({
    "/api/robin/jobs/scan": { body: { scan: { scanned: 0, matched: 0, added: 0 } } },
    "/api/robin/assistant": { body: { reply: "ok", usedTools: [] } },
    "/api/robin/jobs/digest": { body: { text: "1. 4.6 Acme", jobIds: ["j1"], count: 1, pending: 0, scoreBatch: 40 } },
    "sendMessage": { ok: false, status: 429, body: { description: "Too Many Requests" } },
  });
  const job = ledger();
  const logs = [];
  await sendJobDigest(config({ jobDigest: schedule }), deps(fetch, logs, { job }), "2026-08-17:morning");

  assert.equal(calls.some((call) => call.body?.claim), false, "nothing landed, so nothing is consumed");
  assert.equal(job.runs.size, 0);
  assert.match(logs.join("\n"), /send to 42 failed/);
});

test("a board being down still lets already-scored jobs go out", async () => {
  const { fetch, calls } = fakeFetch({
    "/api/robin/jobs/scan": { ok: false, status: 500, body: { error: "boom" } },
    "/api/robin/assistant": { body: { reply: "ok", usedTools: [] } },
    "/api/robin/jobs/digest": { body: { text: "1. 4.0 Beta", jobIds: ["j2"], count: 1, pending: 0, scoreBatch: 40 } },
    "sendMessage": { body: { ok: true, result: { message_id: 500 } } },
  });
  const logs = [];
  await sendJobDigest(config({ jobDigest: schedule }), deps(fetch, logs), "2026-08-17:evening");

  assert.match(logs.join("\n"), /scan failed/);
  assert.equal(calls.filter((call) => call.url.includes("sendMessage")).length, 1);
});

/* ── gmail digest ── */

const mailSchedule = { enabled: true, time: "08:00", locale: "en", chatIds: [], query: "newer_than:1d" };

test("the email digest goes to its own chat list when set", () => {
  assert.deepEqual(gmailAudience(config({ allowlist: [42], gmailDigest: mailSchedule })), [42]);
  assert.deepEqual(
    gmailAudience(config({ allowlist: [42], gmailDigest: { ...mailSchedule, chatIds: [-100777] } })),
    [-100777],
  );
});

test("the email digest runs in the mail-review mode and marks delivery", async () => {
  const { fetch, calls } = fakeFetch({
    "/api/robin/assistant": { body: { reply: "面试邀请", usedTools: ["gmail_list"] } },
    "sendMessage": { body: { ok: true, result: { message_id: 500 } } },
  });
  const gmail = ledger();
  const mailConfig = config({
    allowlist: [42, 43],
    gmailDigest: { enabled: true, time: "08:00", locale: "zh", chatIds: [], query: "is:unread" },
  });
  await sendGmailDigest(mailConfig, deps(fetch, [], { gmail }), "2026-08-17");

  assert.match(calls[0].body.message, /gmail_list/);
  assert.equal(calls[0].body.mode, "mail");
  assert.equal(calls[0].body.readOnly, undefined);
  assert.deepEqual(
    calls.filter((call) => call.url.includes("sendMessage")).map((call) => call.body.chat_id),
    [42, 43],
  );
  assert.deepEqual(gmail.runs.get("2026-08-17"), [42, 43]);
});

test("an unconnected Google skips the digest for the day rather than retrying", async () => {
  const { fetch, calls } = fakeFetch({});
  const gmail = ledger();
  const logs = [];
  await sendGmailDigest(
    config({ allowlist: [42], gmailDigest: mailSchedule }),
    deps(fetch, logs, { gmail }, () => false),
    "2026-08-17",
  );
  assert.deepEqual(calls, [], "no assistant call, no send");
  assert.match(logs.join("\n"), /skipped/);
  assert.deepEqual(gmail.runs.get("2026-08-17"), [42]);
});

const noStored = { allowedChatIds: [] };

test("readConfig demands a token and defaults the rest", () => {
  assert.throws(() => readConfig({}, noStored), /No Telegram bot token/);

  const parsed = readConfig({ TELEGRAM_BOT_TOKEN: "T", TELEGRAM_ALLOWED_CHAT_IDS: "1,2" }, noStored);
  assert.equal(parsed.piWebUrl, "http://127.0.0.1:30141");
  assert.deepEqual(parsed.allowlist, [1, 2]);
  assert.equal(parsed.password, undefined);

  const custom = readConfig({ TELEGRAM_BOT_TOKEN: "T", PI_WEB_URL: "http://box:8080/" }, noStored);
  assert.equal(custom.piWebUrl, "http://box:8080", "a trailing slash would double up in request paths");
});

test("settings saved in the dashboard override the environment", () => {
  // Otherwise editing on the settings page would appear to do nothing.
  const config = readConfig(
    { TELEGRAM_BOT_TOKEN: "env-token", TELEGRAM_ALLOWED_CHAT_IDS: "1" },
    { botToken: "stored-token", allowedChatIds: [42] },
  );
  assert.equal(config.token, "stored-token");
  assert.deepEqual(config.allowlist, [42]);
});

test("the environment still works when nothing is stored", () => {
  const config = readConfig(
    { TELEGRAM_BOT_TOKEN: "env-token", TELEGRAM_ALLOWED_CHAT_IDS: "7" },
    { allowedChatIds: [] },
  );
  assert.equal(config.token, "env-token");
  assert.deepEqual(config.allowlist, [7]);
});

test("the nightly sweep marks itself even when it fails", async () => {
  const { fetch, calls } = fakeFetch({
    "/api/robin/jobs/sweep": { ok: false, status: 500, body: { error: "boom" } },
  });
  const job = ledger();
  const logs = [];
  await startNightlySweep(config({ jobDigest: schedule }), deps(fetch, logs, { job }), "2026-08-17:sweep");

  assert.equal(calls.length, 1);
  assert.match(logs.join("\n"), /nightly sweep failed/);
  // Marked anyway — otherwise a failing sweep retries every poll all night.
  assert.deepEqual(job.runs.get("2026-08-17:sweep"), [42]);
});

test("the job feed goes to its own chats, falling back to the main allow-list", () => {
  const base = config({ allowlist: [42], jobDigest: schedule });
  assert.deepEqual(jobAudience(base), [42], "no dedicated list means the main one");

  const dedicated = config({
    allowlist: [42],
    jobDigest: { ...schedule, chatIds: [-1001234567890] },
  });
  assert.deepEqual(jobAudience(dedicated), [-1001234567890]);
});

test("the sweep and the digest do not erase each other's delivery record", () => {
  // The bug this pins: one ledger slot meant the sweep marked itself, the
  // morning digest overwrote that, the sweep found no record of itself and
  // fired again — ping-ponging every poll all day.
  const job = ledger();
  job.mark("2026-08-18:sweep", 42);
  job.mark("2026-08-18:morning", 42);

  assert.deepEqual(job.pending("2026-08-18:sweep", [42]), [],
    "the sweep must still count as delivered after the digest wrote");
  assert.deepEqual(job.pending("2026-08-18:morning", [42]), []);
  assert.deepEqual(job.pending("2026-08-18:evening", [42]), [42],
    "a slot that has not run is still pending");
});

/* ─────────────────────── typing, commands, voice ─────────────────────── */

test("a turn shows a typing indicator while the user waits", async () => {
  const { fetch, chatActions } = fakeFetch({
    "/api/robin/assistant": { body: { reply: "ok", usedTools: [] } },
    "sendMessage": { body: { ok: true, result: { message_id: 1 } } },
  });
  await handleMessage(config(), deps(fetch), {
    updateId: 1, messageId: 10, chatId: 42, from: "bruce", text: "hi",
  });
  assert.ok(chatActions.length >= 1, "a two-minute turn cannot look like nothing happening");
  assert.equal(chatActions[0].action, "typing");
  assert.equal(chatActions[0].chat_id, 42);
});

test("a slash command answers without reaching the model", async () => {
  const { fetch, calls } = fakeFetch({
    "sendMessage": { body: { ok: true, result: { message_id: 1 } } },
  });
  await handleMessage(config(), deps(fetch), {
    updateId: 1, messageId: 10, chatId: 42, from: "bruce", text: "/help",
  });
  assert.equal(calls.length, 1, "/help is text we already have");
  assert.match(calls[0].url, /sendMessage$/);
  assert.match(calls[0].body.text, /\/today/);
});

test("an unrecognised slash command still reaches the model", async () => {
  const { fetch, calls } = fakeFetch({
    "/api/robin/assistant": { body: { reply: "I am not sure.", usedTools: [] } },
    "sendMessage": { body: { ok: true, result: { message_id: 1 } } },
  });
  await handleMessage(config(), deps(fetch), {
    updateId: 1, messageId: 10, chatId: 42, from: "bruce", text: "/banana",
  });
  assert.match(calls[0].url, /\/api\/robin\/assistant$/);
});

test("a voice note is transcribed, echoed, and then acted on", async () => {
  const { fetch, calls } = fakeFetch({
    "getFile": { body: { ok: true, result: { file_path: "voice/file_1.oga", file_size: 900 } } },
    "/file/bot": { body: {}, buffer: new ArrayBuffer(900) },
    "audio/transcriptions": { body: "remind me to pay rent" },
    "/api/robin/assistant": { body: { reply: "Added.", usedTools: ["todo_add"] } },
    "sendMessage": { body: { ok: true, result: { message_id: 1 } } },
  });
  await handleMessage(
    config({ transcription: { enabled: true, baseUrl: "https://api.openai.com/v1", model: "whisper-1", apiKey: "sk-test" } }),
    deps(fetch),
    { updateId: 1, messageId: 10, chatId: 42, from: "bruce", text: "", voice: { fileId: "v1" } },
  );

  const sent = calls.filter((call) => call.url.endsWith("sendMessage"));
  assert.match(sent[0].body.text, /remind me to pay rent/, "the transcript is echoed before it is acted on");
  const turn = calls.find((call) => call.url.endsWith("/api/robin/assistant"));
  assert.equal(turn.body.message, "remind me to pay rent");
});

test("a voice note with transcription off says so instead of failing", async () => {
  const { fetch, calls } = fakeFetch({
    "getFile": { body: { ok: true, result: { file_path: "voice/file_1.oga", file_size: 10 } } },
    "/file/bot": { body: {}, buffer: new ArrayBuffer(10) },
    "sendMessage": { body: { ok: true, result: { message_id: 1 } } },
  });
  await handleMessage(config(), deps(fetch), {
    updateId: 1, messageId: 10, chatId: 42, from: "bruce", text: "", voice: { fileId: "v1" },
  });
  const sent = calls.filter((call) => call.url.endsWith("sendMessage"));
  assert.match(sent.at(-1).body.text, /turn on transcription/);
  assert.equal(calls.some((call) => call.url.includes("/api/robin/assistant")), false);
});

/* ─────────────────────────── rate limiting ─────────────────────────── */

test("a burst past the ceiling is refused before it costs a turn", async () => {
  const { fetch, calls } = fakeFetch({
    "/api/robin/assistant": { body: { reply: "ok", usedTools: [] } },
    "sendMessage": { body: { ok: true, result: { message_id: 1 } } },
  });
  const limit = { take: (_chatId, _now) => 7 };
  const message = {
    updateId: 1, messageId: 10, chatId: 42, from: "bruce", text: "again and again",
  };
  await handleMessage(config(), deps(fetch, [], {}, () => true, { rateLimit: limit }), message);

  assert.equal(calls.some((call) => call.url.includes("/api/robin/assistant")), false);
  assert.match(calls[0].body.text, /Try again in 7s/);
});

/* ─────────────────────────── button presses ─────────────────────────── */

test("a button press acts without the model and acknowledges the spinner", async () => {
  const { fetch, calls } = fakeFetch({
    "/api/robin/jobs": { body: { job: {} } },
    "answerCallbackQuery": { body: { ok: true } },
  });
  await handleCallback(config(), deps(fetch), {
    updateId: 1, callbackId: "cb1", chatId: 42, messageId: 900, from: "bruce",
    data: "job:applied:ab12",
  });

  assert.equal(calls.some((call) => call.url.includes("/api/robin/assistant")), false);
  assert.match(calls[0].url, /\/api\/robin\/jobs$/);
  assert.equal(calls[0].init.method, "PATCH");
  assert.match(calls[1].url, /answerCallbackQuery$/);
  assert.equal(calls[1].body.text, "Marked applied");
});

test("a press from an unlisted chat is refused in silence", async () => {
  const { fetch, calls } = fakeFetch({});
  await handleCallback(config(), deps(fetch), {
    updateId: 1, callbackId: "cb1", chatId: 999, messageId: 900, from: "stranger",
    data: "job:dropped:ab12",
  });
  assert.deepEqual(calls, [], "authorization is the same gate as for a message");
});

test("pressing a button retires it from the message that carried it", async () => {
  const { fetch, calls } = fakeFetch({
    "/api/robin/todos": { body: { todo: {} } },
    "sendMessage": { body: { ok: true, result: { message_id: 900 } } },
    "answerCallbackQuery": { body: { ok: true } },
    "editMessageReplyMarkup": { body: { ok: true } },
  });
  const keyboards = createKeyboardMemory();
  const shared = deps(fetch, [], {}, () => true, { keyboards });

  await sendMessage(config(), shared, 42, "your day", [
    [{ text: "done a", data: "todo:done:a" }],
    [{ text: "done b", data: "todo:done:b" }],
  ]);
  await handleCallback(config(), shared, {
    updateId: 1, callbackId: "cb1", chatId: 42, messageId: 900, from: "bruce",
    data: "todo:done:a",
  });

  const edit = calls.find((call) => call.url.endsWith("editMessageReplyMarkup"));
  assert.ok(edit, "the pressed button has to disappear");
  assert.deepEqual(edit.body.reply_markup.inline_keyboard, [
    [{ text: "done b", callback_data: "todo:done:b" }],
  ]);
});

/* ────────────────────── the loop no longer blocks ────────────────────── */

test("a slow digest does not hold the poller shut", async () => {
  // The regression this exists for: schedules used to run inside the poll loop,
  // so a job digest that scanned, scored, and waited for the scorer — twenty
  // minutes on a bad day — meant twenty minutes of unanswered messages. They
  // now run alongside polling, so a hung schedule costs nothing but itself.
  let stuckStarted = false;
  let releaseStuck = () => {};
  const fetch = async (url, init) => {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    const target = String(url);
    if (target.includes("/api/robin/assistant") && body?.readOnly) {
      stuckStarted = true;
      // The daily agenda's turn, held open until the test lets it go. Released
      // at the end rather than abandoned: an abandoned request leaves pi-web's
      // abort timer on the event loop and the runner waits out its two minutes.
      return new Promise((resolve) => {
        releaseStuck = () => resolve({
          ok: true, status: 200, json: async () => ({ reply: "late", usedTools: [] }),
        });
      });
    }
    if (target.includes("getUpdates")) {
      return {
        ok: true, status: 200, json: async () => ({
          ok: true,
          result: [{
            update_id: 1,
            message: { message_id: 1, chat: { id: 42 }, from: {}, text: "are you there?" },
          }],
        }),
      };
    }
    if (target.includes("/api/robin/assistant")) {
      return { ok: true, status: 200, json: async () => ({ reply: "yes", usedTools: [] }) };
    }
    if (target.includes("sendMessage")) {
      answered.push(body.text);
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  const answered = [];

  const running = config({ dailyAgenda: { enabled: true, time: "00:00", locale: "en" } });
  const scheduleDeps = deps(fetch);

  // Fired and deliberately not awaited, exactly as the poll loop does it.
  const schedules = runSchedules(running, scheduleDeps);
  await Promise.resolve();
  assert.ok(stuckStarted, "the schedule really is in flight and stuck");

  const next = await pollOnce(running, scheduleDeps, null);
  assert.equal(next, 2, "the poll completed while the schedule was still hanging");
  assert.deepEqual(answered, ["yes"], "the question was answered, not queued behind the digest");

  releaseStuck();
  await schedules;
});

/* ───────────────────── per-chat failure isolation ───────────────────── */

test("one unreachable chat does not cost the others their briefing", async () => {
  const { fetch } = fakeFetch({
    "/api/robin/assistant": { body: { reply: "今日简报", usedTools: ["todo_list"] } },
    "/api/robin/todos": { body: { todos: [] } },
    "sendMessage": (nth) => (nth === 3
      ? { ok: false, status: 403, body: { description: "bot was blocked by the user" } }
      : { ok: true, body: { ok: true, result: { message_id: nth } } }),
  });
  const agenda = ledger();
  await sendDailyAgenda(
    config({ allowlist: [1, 2, 3] }),
    deps(fetch, [], { agenda }),
    "2026-08-23",
    [1, 2, 3],
  );
  // The blocked chat is chat 1 here (call order), and the rest still got it.
  assert.equal(agenda.runs.get("2026-08-23").length, 2, "a blocked chat must not abort the broadcast");
});

test("a chat that failed is retried, and one that succeeded is not", async () => {
  const { fetch } = fakeFetch({
    "/api/robin/assistant": { body: { reply: "mail report", usedTools: ["gmail_list"] } },
    "sendMessage": { body: { ok: true, result: { message_id: 1 } } },
  });
  const gmail = ledger();
  gmail.mark("2026-08-23", 1);
  await sendGmailDigest(
    config({ allowlist: [1, 2] }),
    deps(fetch, [], { gmail }),
    "2026-08-23",
    [2],
  );
  assert.deepEqual(gmail.runs.get("2026-08-23"), [1, 2]);
});

/* ─────────────────────── settings without a restart ─────────────────────── */

test("readConfig defaults the reminder and transcription blocks", () => {
  const parsed = readConfig({ TELEGRAM_BOT_TOKEN: "t" }, { allowedChatIds: [1] });
  assert.equal(parsed.reminders.enabled, false);
  assert.equal(parsed.reminders.lead, 30);
  assert.equal(parsed.transcription.enabled, false);
  assert.equal(parsed.transcription.apiKey, undefined);
});
