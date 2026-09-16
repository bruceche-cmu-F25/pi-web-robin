import assert from "node:assert/strict";
import { test } from "node:test";
import { parseFinalizedNote } from "./note-finalization.ts";

test("finalized note envelope separates the Notion title from Markdown", () => {
  assert.deepEqual(
    parseFinalizedNote("<title>HTTP Basics</title>\n<note>## Requests\n\n- GET</note>", "Notes 2026-09-14"),
    { title: "HTTP Basics", content: "## Requests\n\n- GET" },
  );
  assert.deepEqual(parseFinalizedNote("## Useful fallback", "Class notes"), {
    title: "Class notes",
    content: "## Useful fallback",
  });
});
