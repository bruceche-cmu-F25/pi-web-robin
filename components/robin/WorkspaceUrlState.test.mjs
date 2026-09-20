import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (name) => readFile(new URL(name, import.meta.url), "utf8");

test("calendar, product, and notes restore their durable view state from the URL", async () => {
  const [calendar, product, notes] = await Promise.all([
    read("./CalendarPanel.tsx"),
    read("./ProductIdeas.tsx"),
    read("./NotesWorkspace.tsx"),
  ]);

  for (const [source, keys] of [
    [calendar, ["calendar", "date"]],
    [product, ["stage", "idea"]],
    [notes, ["pane", "draft"]],
  ]) {
    assert.match(source, /useSearchParams\(\)/);
    assert.match(source, /writeUrlState\(/);
    for (const key of keys) assert.ok(source.includes(`searchParams.get("${key}")`), `missing ${key}`);
  }
});
