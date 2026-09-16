import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const previousDataDir = process.env.ROBIN_DATA_DIR;
const dataDir = mkdtempSync(join(tmpdir(), "robin-note-drafts-"));
process.env.ROBIN_DATA_DIR = dataDir;
const { createNoteDraft, deleteNoteDraft, readNoteDrafts, updateNoteDraft } = await import("./notes-domain.ts");
const { clearNotesAgentSession, readNotesAgentSessionId, writeNotesAgentSessionId } = await import("./notes-agent-state.ts");

after(() => {
  rmSync(dataDir, { recursive: true, force: true });
  if (previousDataDir === undefined) delete process.env.ROBIN_DATA_DIR;
  else process.env.ROBIN_DATA_DIR = previousDataDir;
});

test("note drafts persist independently with their own Notion destinations", () => {
  const first = createNoteDraft({ title: "HTTP", text: "rough" });
  const second = createNoteDraft({ title: "React" });
  const updated = updateNoteDraft(first.id, { text: "final", notionParentId: "parent" });

  assert.equal(updated?.notionParentId, "parent");
  assert.equal(readNoteDrafts().find((draft) => draft.id === first.id)?.text, "final");
  assert.equal(deleteNoteDraft(first.id), true);
  assert.deepEqual(readNoteDrafts().map((draft) => draft.id), [second.id]);
});

test("each draft keeps an independent agent session", () => {
  writeNotesAgentSessionId("draft-a", "session-a");
  writeNotesAgentSessionId("draft-b", "session-b");
  assert.equal(readNotesAgentSessionId("draft-a"), "session-a");
  assert.equal(clearNotesAgentSession("draft-a"), true);
  assert.equal(readNotesAgentSessionId("draft-a"), null);
  assert.equal(readNotesAgentSessionId("draft-b"), "session-b");
});
