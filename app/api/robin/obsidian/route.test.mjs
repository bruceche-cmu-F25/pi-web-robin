import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { GET, POST } = await jiti.import("./route.ts");
const { createNoteDraft, readNoteDrafts } = await jiti.import("../../../../extension/robin/notes-domain.ts");
const { writeNoteFinal, readNoteFinals, writeNotesAgentSessionId, readNotesAgentSessionId } = await jiti.import("../../../../extension/robin/notes-agent-state.ts");
const previous = { data: process.env.ROBIN_DATA_DIR, config: process.env.ROBIN_OBSIDIAN_CONFIG };
const root = mkdtempSync(join(tmpdir(), "robin-obsidian-route-"));
const vault = join(root, "Vault");
process.env.ROBIN_DATA_DIR = join(root, "data");
process.env.ROBIN_OBSIDIAN_CONFIG = join(root, "registry.json");
mkdirSync(join(vault, ".obsidian"), { recursive: true });
writeFileSync(process.env.ROBIN_OBSIDIAN_CONFIG, JSON.stringify({ vaults: { local: { path: vault } } }));
after(() => {
  rmSync(root, { recursive: true, force: true });
  for (const [key, value] of [["ROBIN_DATA_DIR", previous.data], ["ROBIN_OBSIDIAN_CONFIG", previous.config]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
const request = (method = "GET", body, headers = {}) => new Request("http://localhost:30141/api/robin/obsidian", {
  method, headers: { host: "localhost:30141", "content-type": "application/json", ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

test("same-origin API discovers the vault and archives a confirmed note with cleanup", async () => {
  const discovery = await GET(request());
  assert.equal(discovery.status, 200);
  assert.equal((await discovery.json()).vaults[0].path, vault);
  const draft = createNoteDraft({ title: "Test note", text: "Confirmed content" });
  writeNoteFinal(draft.id, { status: "ready", startedAt: new Date().toISOString(), content: "Final" });
  writeNotesAgentSessionId(draft.id, "agent-session");
  const body = { confirmed: true, vaultId: "local", draftId: draft.id, title: draft.title, content: draft.text,
    expectedDraft: { title: draft.title, text: draft.text }, attachmentIds: [] };
  const response = await POST(request("POST", body));
  assert.equal(response.status, 200);
  const { archive } = await response.json();
  assert.equal(readFileSync(join(vault, archive.relativePath), "utf8"), "Confirmed content\n");
  assert.equal(readNoteDrafts().length, 0);
  assert.equal(readNotesAgentSessionId(draft.id), null);
  assert.equal(readNoteFinals()[draft.id], undefined);
  const retry = await POST(request("POST", body));
  assert.deepEqual(await retry.json(), { archive });
});

test("route rejects malformed and cross-origin writes", async () => {
  assert.equal((await GET(request("GET", undefined, { origin: "https://evil.example" }))).status, 403);
  assert.equal((await POST(request("POST", {}, { origin: "https://evil.example" }))).status, 403);
  assert.equal((await POST(request("POST", {}, { "content-type": "text/plain" }))).status, 415);
  for (const input of [null, [], {}, { confirmed: false }]) assert.equal((await POST(request("POST", input))).status, 400);
  const broken = new Request("http://localhost:30141/api/robin/obsidian", {
    method: "POST", headers: { host: "localhost:30141", "content-type": "application/json" }, body: "{",
  });
  assert.equal((await POST(broken)).status, 400);
});
