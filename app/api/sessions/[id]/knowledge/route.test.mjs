import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { GET, POST } = await jiti.import("./route.ts");
const { cacheSessionPath } = await jiti.import("../../../../../lib/session-reader.ts");
const { createKnowledgeProposal } = await jiti.import("../../../../../extension/robin/knowledge-domain.ts");
const root = mkdtempSync(join(tmpdir(), "knowledge-route-"));
const previous = { data: process.env.ROBIN_DATA_DIR, config: process.env.ROBIN_OBSIDIAN_CONFIG };
process.env.ROBIN_DATA_DIR = join(root, "data");
process.env.ROBIN_OBSIDIAN_CONFIG = join(root, "registry.json");
const vault = join(root, "Vault"); mkdirSync(join(vault, ".obsidian"), { recursive: true });
writeFileSync(process.env.ROBIN_OBSIDIAN_CONFIG, JSON.stringify({ vaults: { test: { path: vault } } }));
const id = "knowledge-route-session";
const file = join(root, "session.jsonl");
writeFileSync(file, [
  { type: "session", version: 3, id, cwd: root, timestamp: "2026-10-01T00:00:00Z" },
  { type: "message", id: "user", parentId: null, timestamp: "2026-10-01T00:00:00Z", message: { role: "user", content: "Keep decisions in Markdown", timestamp: 1 } },
  { type: "message", id: "answer", parentId: "user", timestamp: "2026-10-01T00:00:01Z", message: { role: "assistant", content: [{ type: "text", text: "Use linked notes." }, { type: "thinking", thinking: "Never export this" }], timestamp: 2 } },
  { type: "message", id: "sibling", parentId: "user", timestamp: "2026-10-01T00:00:02Z", message: { role: "user", content: "Other branch", timestamp: 3 } },
].map((item) => JSON.stringify(item)).join("\n") + "\n");
cacheSessionPath(id, file);
const ctx = { params: Promise.resolve({ id }) };
const request = (method = "GET", body, query = "", headers = {}) => new Request(`http://localhost:30141/api/sessions/${id}/knowledge${query}`, {
  method, headers: { host: "localhost:30141", "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
after(() => {
  rmSync(root, { recursive: true, force: true });
  for (const [key, value] of [["ROBIN_DATA_DIR", previous.data], ["ROBIN_OBSIDIAN_CONFIG", previous.config]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test("GET previews the selected branch without starting a model or modifying the session; confirmed POST saves a stored proposal", async () => {
  const original = readFileSync(file, "utf8");
  const response = await GET(request("GET", undefined, "?leafId=answer&scope=all"), ctx);
  assert.equal(response.status, 200);
  const { source, vaults } = await response.json();
  assert.deepEqual(source.messages.map((message) => message.id), ["user", "answer"]);
  assert.equal(vaults[0].id, "test");
  const proposal = createKnowledgeProposal({ source, project: "Robin", vaultId: "test", candidates: [], reply: JSON.stringify({ notes: [{ id: "n1", title: "Decision", kind: "decision", content: "Use Markdown.", links: [], sourceIds: ["user"], targetId: null }] }) });
  assert.equal((await POST(request("POST", { action: "save", proposalId: proposal.id, confirmed: false }), ctx)).status, 400);
  const save = await POST(request("POST", { action: "save", proposalId: proposal.id, confirmed: true }), ctx);
  assert.equal(save.status, 200);
  assert.ok((await save.json()).proposal.notes[0].saved);
  const history = await (await GET(request("GET", undefined, "?history=1"), ctx)).json();
  assert.equal(history.captures[0].saved, 1);
  assert.equal(readFileSync(file, "utf8"), original);
});

test("guard, malformed data and changed sources fail before model work", async () => {
  assert.equal((await GET(request("GET", undefined, "", { origin: "https://evil.example" }), ctx)).status, 403);
  assert.equal((await POST(request("POST", {}, "", { "content-type": "text/plain" }), ctx)).status, 415);
  for (const body of [null, [], {}, { action: "save", proposalId: "unknown", confirmed: true }]) assert.equal((await POST(request("POST", body), ctx)).status, 400);
  const changed = await POST(request("POST", { action: "prepare", leafId: "answer", scope: "all", fingerprint: "stale", project: "Robin", vaultId: "test", provider: "never", modelId: "called" }), ctx);
  assert.equal(changed.status, 409);
});
