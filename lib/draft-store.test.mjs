import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const load = () => createJiti(import.meta.url, { moduleCache: false }).import("./draft-store.ts");
function browserStorage(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { sessionStorage: storage() } });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else delete globalThis.window;
  });
}
function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test("draft text survives a new document; rekey, clear and empty updates do not resurrect it", async (t) => {
  browserStorage(t);
  const firstPage = await load();
  const key = "new:temporary:/project";
  const draft = { value: "中文草稿\nnot sent", images: [{ data: "aGVsbG8=", mimeType: "image/png" }] };
  firstPage.setDraft(key, draft);
  assert.deepEqual(firstPage.getDraft(key), draft);
  const secondPage = await load();
  assert.deepEqual(secondPage.getDraft(key), { value: draft.value, images: [] }, "only text is persisted across documents");
  secondPage.rekeyDraft(key, "session-id");
  const thirdPage = await load();
  assert.equal(thirdPage.getDraft(key), null);
  assert.equal(thirdPage.getDraft("session-id").value, draft.value);
  thirdPage.clearDraft("session-id");
  assert.equal((await load()).getDraft("session-id"), null);
  thirdPage.setDraft(key, draft);
  thirdPage.setDraft(key, { value: "", images: [] });
  assert.equal((await load()).getDraft(key), null);
});

test("drafts stay scoped to a tab and retain the memory fallback when storage fails", async (t) => {
  browserStorage(t);
  const firstTab = await load();
  firstTab.setDraft("key", { value: "first tab", images: [] });
  window.sessionStorage = storage();
  assert.equal((await load()).getDraft("key"), null);
  window.sessionStorage = {
    getItem() { throw Error("blocked"); },
    setItem() { throw Error("quota"); },
    removeItem() { throw Error("blocked"); },
  };
  const blocked = await load();
  assert.equal(blocked.getDraft("key"), null);
  blocked.setDraft("key", { value: "still usable", images: [] });
  assert.equal(blocked.getDraft("key").value, "still usable");
  blocked.clearDraft("key");
  assert.equal(blocked.getDraft("key"), null);
});
