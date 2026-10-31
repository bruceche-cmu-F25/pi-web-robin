import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { clearTextRecovery, readTextRecoveries, removeTextRecoveries, saveTextRecovery } from "./text-recovery.ts";

let entries;
beforeEach(() => {
  entries = new Map();
  globalThis.window = { localStorage: {
    get length() { return entries.size; }, key: (i) => [...entries.keys()][i] ?? null,
    getItem: (key) => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: (key) => entries.delete(key),
  } };
});
afterEach(() => { delete globalThis.window; });

test("reload offers text only; own writes, other entities and scopes stay separate", () => {
  saveTextRecovery("notes", "a/b", "old:text", { title: "Draft", text: "未保存\n🙂", notionParentId: "" });
  saveTextRecovery("notes", "a", "old:text", { text: "other" });
  saveTextRecovery("product", "a/b", "old:note", { note: "separate" });
  assert.equal(readTextRecoveries("notes", "a/b", "old").drafts.length, 0);
  const read = readTextRecoveries("notes", "a/b", "new");
  assert.equal(read.unavailable, false);
  assert.equal(read.drafts.length, 1);
  assert.equal(read.drafts[0].fields.text, "未保存\n🙂");
});

test("acknowledgements are exact, including A → B → A and identical timestamps", () => {
  const first = saveTextRecovery("notes", "id", "tab:text", { text: "A" });
  const middle = saveTextRecovery("notes", "id", "tab:text", { text: "B" }, first);
  const last = saveTextRecovery("notes", "id", "tab:text", { text: "A" }, middle);
  assert.equal(entries.size, 1, "each successful edit replaces only its own previous backup");
  assert.notEqual(first.value, last.value);
  assert.equal(clearTextRecovery(first), false);
  assert.equal(readTextRecoveries("notes", "id", "next").drafts[0].fields.text, "A");
  assert.equal(clearTextRecovery(last), true);
  assert.equal(entries.size, 0);
});

test("another tab can edit between discard's read and delete without losing the new copy", () => {
  const first = saveTextRecovery("notes", "id", "tab:text", { text: "Old" });
  let changed = false;
  window.localStorage.getItem = (key) => {
    const value = entries.get(key) ?? null;
    if (!changed && key === first.key) {
      changed = true;
      saveTextRecovery("notes", "id", "tab:text", { text: "Concurrent edit" }, first);
    }
    return value;
  };
  clearTextRecovery(first);
  assert.equal(readTextRecoveries("notes", "id", "next").drafts[0].fields.text, "Concurrent edit");
});

test("two tabs and independent product fields never overwrite each other's backup", () => {
  const name = saveTextRecovery("product", "id", "one:name", { name: "New name" });
  saveTextRecovery("product", "id", "one:note", { note: "One" });
  saveTextRecovery("product", "id", "two:note", { note: "Two" });
  assert.equal(clearTextRecovery(name), true);
  assert.deepEqual(readTextRecoveries("product", "id", "next").drafts.map((d) => d.fields.note).sort(), ["One", "Two"]);
});

test("oversized/quota-denied edits do not evict the previous recoverable copy", () => {
  const receipt = saveTextRecovery("notes", "id", "one:text", { text: "Still recoverable" });
  assert.equal(saveTextRecovery("notes", "id", "one:text", { text: "界".repeat(256_000) }, receipt), null);
  window.localStorage.setItem = () => { throw new DOMException("Full", "QuotaExceededError"); };
  assert.equal(saveTextRecovery("notes", "id", "one:text", { text: "New" }, receipt), null);
  assert.equal(entries.get(receipt.key), receipt.value);
});

test("malformed, future-version and unexpected-field records are not replayed or removed", () => {
  const receipt = saveTextRecovery("notes", "id", "one:text", { text: "Valid" });
  for (const value of ["{", JSON.stringify({ ...JSON.parse(receipt.value), version: 2 }), JSON.stringify({ ...JSON.parse(receipt.value), fields: { url: "https://example.com" } })]) {
    entries.set(receipt.key, value);
    assert.deepEqual(readTextRecoveries("notes", "id", "next"), { drafts: [], unavailable: true });
    assert.equal(entries.get(receipt.key), value);
  }
});

test("restricted storage fails visibly without throwing into the editor", () => {
  Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Denied", "SecurityError"); } });
  assert.equal(saveTextRecovery("notes", "id", "one:text", { text: "Edit" }), null);
  assert.deepEqual(readTextRecoveries("notes", "id", "next"), { drafts: [], unavailable: true });
  assert.equal(clearTextRecovery({ key: "key", value: "value" }), false);
  assert.doesNotThrow(() => removeTextRecoveries("notes", "id"));
});

test("resume source recovers exactly, independently of notes and other editors", () => {
  const source = String.raw`\documentclass{ctexart}
\begin{document}中文 & <script>not HTML</script>\end{document}`;
  saveTextRecovery("resume", "main", "old:source", { source });
  saveTextRecovery("notes", "main", "old:text", { text: "Separate" });
  assert.equal(readTextRecoveries("resume", "main", "old").drafts.length, 0);
  assert.deepEqual(readTextRecoveries("resume", "main", "new").drafts[0].fields, { source });
});

test("confirmed removal clears only the deleted entity, not adjacent ids or other scopes", () => {
  saveTextRecovery("notes", "id", "one:text", { text: "Remove" });
  saveTextRecovery("notes", "id2", "one:text", { text: "Keep" });
  saveTextRecovery("product", "id", "one:note", { note: "Keep" });
  removeTextRecoveries("notes", "id");
  assert.equal(entries.size, 2);
});
