import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyCallback,
  createKeyboardMemory,
  jobButtons,
  parseCallback,
  todoButtons,
} from "./callbacks.ts";
import { MAX_CALLBACK_DATA_BYTES } from "./telegram-api.ts";

const ctx = (fetch) => ({ url: "http://127.0.0.1:30141", fetch });

/** Records requests and answers them all the same way. */
function fakeFetch(value = { ok: true, body: {} }) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method, body: init?.body ? JSON.parse(init.body) : undefined });
    return { ok: value.ok, status: value.status ?? 200, json: async () => value.body };
  };
  return { fetch, calls };
}

test("parseCallback accepts only the payloads the buttons produce", () => {
  assert.deepEqual(parseCallback("job:shortlist:ab12cd34"), {
    kind: "job", action: "shortlist", id: "ab12cd34",
  });
  assert.deepEqual(parseCallback("todo:done:xyz"), { kind: "todo", action: "done", id: "xyz" });
});

test("parseCallback refuses anything outside the closed set", () => {
  assert.equal(parseCallback("job:delete:ab12"), null, "an action we never offer");
  assert.equal(parseCallback("shell:run:ls"), null, "a domain we never offer");
  assert.equal(parseCallback("todo:done"), null, "too few parts");
  assert.equal(parseCallback("todo:done:a:b"), null, "too many parts");
  assert.equal(parseCallback("todo:done:"), null, "no id");
  assert.equal(parseCallback("todo:done:../../etc"), null, "an id that is a path");
  assert.equal(parseCallback("todo:done:" + "x".repeat(64)), null, "an id past the shape limit");
});

test("every payload a button can carry fits Telegram's cap", () => {
  const rows = [...jobButtons("ab12cd34", "en", "https://example.com/x"),
    ...todoButtons([{ id: "zz99yy88", title: "pay the rent" }], "en")];
  for (const row of rows) {
    for (const button of row) {
      if (!button.data) continue;
      assert.ok(
        Buffer.byteLength(button.data, "utf8") <= MAX_CALLBACK_DATA_BYTES,
        `${button.data} is too long`,
      );
      assert.notEqual(parseCallback(button.data), null, `${button.data} must round-trip`);
    }
  }
});

test("a job's link sits on its own row, and is absent when there is none", () => {
  const withUrl = jobButtons("ab12", "en", "https://example.com/x");
  assert.equal(withUrl.length, 2);
  assert.equal(withUrl[1][0].url, "https://example.com/x");
  assert.equal(jobButtons("ab12", "en").length, 1);
});

test("todo buttons are capped and one per row", () => {
  const todos = Array.from({ length: 20 }, (_, i) => ({ id: `id${i}`, title: `task ${i}` }));
  const rows = todoButtons(todos, "zh", 8);
  assert.equal(rows.length, 8);
  for (const row of rows) assert.equal(row.length, 1);
});

test("a job press patches the pipeline and retires the whole row", async () => {
  const { fetch, calls } = fakeFetch({ ok: true, body: { job: {} } });
  const outcome = await applyCallback(ctx(fetch), "job:applied:ab12", "en");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/api\/robin\/jobs$/);
  assert.equal(calls[0].method, "PATCH");
  assert.deepEqual(calls[0].body, { id: "ab12", status: "applied" });
  assert.equal(outcome.toast, "Marked applied");
  assert.deepEqual(outcome.retire.sort(), [
    "job:applied:ab12", "job:dropped:ab12", "job:shortlist:ab12",
  ]);
});

test("a todo press completes it and retires only its own button", async () => {
  const { fetch, calls } = fakeFetch({ ok: true, body: { todo: {} } });
  const outcome = await applyCallback(ctx(fetch), "todo:done:t1", "zh");
  assert.deepEqual(calls[0].body, { id: "t1", done: true });
  assert.equal(outcome.toast, "已完成");
  assert.deepEqual(outcome.retire, ["todo:done:t1"]);
});

test("an unknown payload never reaches pi-web", async () => {
  const { fetch, calls } = fakeFetch();
  const outcome = await applyCallback(ctx(fetch), "job:delete:everything", "en");
  assert.equal(calls.length, 0, "a refused payload must not become a request");
  assert.match(outcome.toast, /no longer valid/);
  assert.deepEqual(outcome.retire, []);
});

test("a failure is reported on the button and retires nothing", async () => {
  const { fetch } = fakeFetch({ ok: false, status: 500, body: { error: "pi-web is down" } });
  const outcome = await applyCallback(ctx(fetch), "job:dropped:ab12", "en");
  assert.match(outcome.toast, /Could not do that: pi-web is down/);
  assert.deepEqual(outcome.retire, [], "the button must stay pressable after a failure");
});

test("the keyboard memory drops retired buttons and keeps the link", () => {
  const memory = createKeyboardMemory();
  memory.remember(42, 7, jobButtons("ab12", "en", "https://example.com/x"));
  const remaining = memory.without(42, 7, [
    "job:shortlist:ab12", "job:applied:ab12", "job:dropped:ab12",
  ]);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0][0].url, "https://example.com/x");
});

test("an unremembered message yields null, so its buttons are left alone", () => {
  const memory = createKeyboardMemory();
  assert.equal(memory.without(42, 999, ["todo:done:x"]), null);
});

test("the memory evicts oldest first and stays bounded", () => {
  const memory = createKeyboardMemory(3);
  for (let id = 1; id <= 5; id += 1) {
    memory.remember(42, id, [[{ text: "x", data: `todo:done:t${id}` }]]);
  }
  assert.equal(memory.without(42, 1, []), null, "the oldest was evicted");
  assert.equal(memory.without(42, 2, []), null);
  assert.notEqual(memory.without(42, 5, []), null, "the newest is still remembered");
});

test("retiring the last button forgets the message", () => {
  const memory = createKeyboardMemory();
  memory.remember(42, 7, [[{ text: "done", data: "todo:done:t1" }]]);
  assert.deepEqual(memory.without(42, 7, ["todo:done:t1"]), []);
  assert.equal(memory.without(42, 7, []), null, "nothing left to remember");
});
