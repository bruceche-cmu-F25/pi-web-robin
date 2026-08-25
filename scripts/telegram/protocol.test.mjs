import assert from "node:assert/strict";
import { test } from "node:test";
import {
  errorMessage,
  formatReply,
  isAllowed,
  parseAllowlist,
  parsePhotos,
  parseUpdates,
  parseVoice,
  resolveLocale,
} from "./protocol.ts";

const update = (id, fields = {}) => ({
  update_id: id,
  message: {
    message_id: id * 100,
    chat: { id: 42 },
    from: { username: "bruce" },
    text: "hello",
    ...fields,
  },
});

test("parseUpdates extracts messages and the next offset", () => {
  const { messages, nextOffset } = parseUpdates({ ok: true, result: [update(7), update(8)] });
  assert.deepEqual(messages.map((m) => [m.updateId, m.chatId, m.text]), [[7, 42, "hello"], [8, 42, "hello"]]);
  assert.equal(nextOffset, 9);
});

test("unsupported updates are still acknowledged", () => {
  // A sticker has no text. If its update_id did not advance the offset, the
  // loop would refetch it forever and never see anything after it.
  const sticker = { update_id: 11, message: { message_id: 1100, chat: { id: 42 }, sticker: {} } };
  const { messages, nextOffset } = parseUpdates({ ok: true, result: [sticker] });
  assert.deepEqual(messages, []);
  assert.equal(nextOffset, 12, "the offset must move past updates we cannot handle");
});

test("a photo is parsed with its caption as text, largest size last", () => {
  const { messages, nextOffset } = parseUpdates({
    ok: true,
    result: [{
      update_id: 20,
      message: {
        message_id: 2000,
        chat: { id: 42 },
        from: { username: "bruce" },
        caption: " 这是截图 ",
        photo: [
          { file_id: "small", width: 100, height: 100 },
          { file_id: "large", width: 400, height: 400 },
        ],
      },
    }],
  });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].text, "这是截图");
  assert.deepEqual(messages[0].photos, [
    { fileId: "small", width: 100, height: 100 },
    { fileId: "large", width: 400, height: 400 },
  ]);
  assert.equal(nextOffset, 21);
});

test("a bare photo with no caption is kept, with empty text", () => {
  const { messages } = parseUpdates({
    ok: true,
    result: [{
      update_id: 21,
      message: { message_id: 2100, chat: { id: 42 }, photo: [{ file_id: "p1", width: 10, height: 10 }] },
    }],
  });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].text, "");
  assert.deepEqual(messages[0].photos, [{ fileId: "p1", width: 10, height: 10 }]);
});

test("parsePhotos drops sizes without a usable file id", () => {
  assert.deepEqual(parsePhotos(undefined), []);
  assert.deepEqual(parsePhotos("nope"), []);
  assert.deepEqual(parsePhotos([{ width: 1 }, { file_id: "ok" }]), [{ fileId: "ok" }]);
});

test("blank and whitespace-only messages are ignored but acknowledged", () => {
  const { messages, nextOffset } = parseUpdates({ ok: true, result: [update(3, { text: "   " })] });
  assert.deepEqual(messages, []);
  assert.equal(nextOffset, 4);
});

test("trimming preserves multibyte text and captures the sender", () => {
  // Non-ASCII on purpose: a byte-wise trim would corrupt these characters.
  const { messages } = parseUpdates({ ok: true, result: [update(1, { text: "  买牛奶  " })] });
  assert.equal(messages[0].text, "买牛奶");
  assert.equal(messages[0].from, "bruce");
});

test("the sender's Telegram language is captured when present", () => {
  const withLang = parseUpdates({
    ok: true,
    result: [update(1, { from: { username: "bruce", language_code: "zh-hans" } })],
  });
  assert.equal(withLang.messages[0].languageCode, "zh-hans");

  const without = parseUpdates({ ok: true, result: [update(2)] });
  assert.equal(without.messages[0].languageCode, undefined);
});

test("resolveLocale maps every Chinese tag to zh and everything else to en", () => {
  for (const tag of ["zh", "zh-hans", "zh-CN", "ZH-TW"]) {
    assert.equal(resolveLocale(tag), "zh", tag);
  }
  for (const tag of ["en", "en-GB", "fr", undefined, ""]) {
    assert.equal(resolveLocale(tag), "en", String(tag));
  }
});

test("replies follow the sender's language", () => {
  assert.equal(formatReply("好的", ["todo_add"], "zh"), "好的\n\n— 记了待办");
  assert.equal(formatReply("好的", ["todo_update", "todo_delete"], "zh"), "好的\n\n— 改了待办、删了待办");
  assert.equal(formatReply("好的", ["todo_list", "todo_add"], "zh"), "好的\n\n— 查了待办、记了待办");
  assert.equal(formatReply("   ", ["todo_add"], "zh"), "（没有回复内容）\n\n— 记了待办");
  assert.match(errorMessage("boom", "zh"), /出错了：boom/);
  assert.match(errorMessage("boom", "en"), /Something went wrong: boom/);
});

test("a failed or malformed response yields nothing", () => {
  const empty = { messages: [], callbacks: [], nextOffset: null };
  assert.deepEqual(parseUpdates({ ok: false }), empty);
  assert.deepEqual(parseUpdates(null), empty);
  assert.deepEqual(parseUpdates({ ok: true, result: "nope" }), empty);
});

test("parseAllowlist reads a comma list and rejects junk", () => {
  assert.deepEqual(parseAllowlist("123, 456"), [123, 456]);
  assert.deepEqual(parseAllowlist("-1001234567890"), [-1001234567890], "group chat ids are negative");
  assert.deepEqual(parseAllowlist(undefined), []);
  assert.deepEqual(parseAllowlist("  "), []);
  assert.throws(() => parseAllowlist("123,abc"), /Not a numeric chat id/);
});

test("isAllowed is exact membership, never a prefix or truthiness check", () => {
  assert.ok(isAllowed(42, [42]));
  assert.ok(!isAllowed(42, []), "an empty allow-list authorizes nobody");
  assert.ok(!isAllowed(4, [42]));
  assert.ok(!isAllowed(0, [42]));
});

test("formatReply appends the tools that actually ran", () => {
  assert.equal(formatReply("Added.", ["todo_add"]), "Added.\n\n— added a todo");
  assert.equal(
    formatReply("Done", ["todo_list", "todo_add", "todo_list"]),
    "Done\n\n— read your todos, added a todo",
  );
  assert.equal(formatReply("Just chatting", []), "Just chatting");
});

test("formatReply survives an empty model reply", () => {
  assert.equal(formatReply("   ", ["todo_add"]), "(no reply text)\n\n— added a todo");
});



test("a button press is parsed as a callback, not a message", () => {
  const { messages, callbacks, nextOffset } = parseUpdates({
    ok: true,
    result: [{
      update_id: 30,
      callback_query: {
        id: "cb-1",
        data: "job:shortlist:abc",
        from: { username: "bruce", language_code: "zh-hans" },
        message: { message_id: 900, chat: { id: 42 } },
      },
    }],
  });
  assert.deepEqual(messages, []);
  assert.equal(callbacks.length, 1);
  assert.deepEqual(callbacks[0], {
    updateId: 30,
    callbackId: "cb-1",
    chatId: 42,
    messageId: 900,
    from: "bruce",
    data: "job:shortlist:abc",
    languageCode: "zh-hans",
  });
  assert.equal(nextOffset, 31);
});

test("a callback missing its message or data is dropped but acknowledged", () => {
  const noMessage = parseUpdates({
    ok: true,
    result: [{ update_id: 31, callback_query: { id: "cb", data: "x" } }],
  });
  assert.deepEqual(noMessage.callbacks, []);
  assert.equal(noMessage.nextOffset, 32, "an undeliverable callback must not wedge the loop");

  const noData = parseUpdates({
    ok: true,
    result: [{
      update_id: 32,
      callback_query: { id: "cb", message: { message_id: 1, chat: { id: 42 } } },
    }],
  });
  assert.deepEqual(noData.callbacks, []);
  assert.equal(noData.nextOffset, 33);
});

test("a voice note is kept even though it carries no text", () => {
  const { messages } = parseUpdates({
    ok: true,
    result: [{
      update_id: 40,
      message: {
        message_id: 4000,
        chat: { id: 42 },
        from: { username: "bruce" },
        voice: { file_id: "v1", duration: 6, mime_type: "audio/ogg" },
      },
    }],
  });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].text, "");
  assert.deepEqual(messages[0].voice, { fileId: "v1", duration: 6, mimeType: "audio/ogg" });
});

test("a forwarded recording arrives as audio and transcribes the same way", () => {
  const { messages } = parseUpdates({
    ok: true,
    result: [{
      update_id: 41,
      message: { message_id: 4100, chat: { id: 42 }, audio: { file_id: "a1", duration: 30 } },
    }],
  });
  assert.deepEqual(messages[0].voice, { fileId: "a1", duration: 30 });
});

test("parseVoice rejects anything without a file id", () => {
  assert.equal(parseVoice(undefined), null);
  assert.equal(parseVoice({ duration: 5 }), null);
  assert.equal(parseVoice("nope"), null);
  assert.deepEqual(parseVoice({ file_id: "ok" }), { fileId: "ok" });
});

test("a message without a message id cannot be replied to, so it is dropped", () => {
  const { messages, nextOffset } = parseUpdates({
    ok: true,
    result: [{ update_id: 50, message: { chat: { id: 42 }, text: "hi" } }],
  });
  assert.deepEqual(messages, []);
  assert.equal(nextOffset, 51);
});
