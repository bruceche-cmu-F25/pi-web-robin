import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
const { GET, PATCH } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./route.ts");
const root = mkdtempSync(join(tmpdir(), "roadmap-api-"));
const before = [process.env.ROBIN_DATA_DIR, process.env.ROBIN_OBSIDIAN_CONFIG];
process.env.ROBIN_DATA_DIR = join(root, "data");
process.env.ROBIN_OBSIDIAN_CONFIG = join(root, "registry.json");
mkdirSync(join(root, "Vault", ".obsidian"), { recursive: true });
writeFileSync(join(root, "Vault", "Roadmap.md"), "# Roadmap\n\n## Eval\n### Practice\nCompare outputs.");
writeFileSync(process.env.ROBIN_OBSIDIAN_CONFIG, JSON.stringify({ vaults: { local: { path: join(root, "Vault") } } }));
after(() => {
  rmSync(root, { recursive: true, force: true });
  for (const [key, value] of [["ROBIN_DATA_DIR", before[0]], ["ROBIN_OBSIDIAN_CONFIG", before[1]]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
function request(query = "", method = "GET", body, headers = {}) {
  return new Request(`http://localhost:30141/api/robin/learning/roadmap${query}`, {
    method, headers: { host: "localhost:30141", ...(method === "PATCH" ? { origin: "http://localhost:30141", "Content-Type": "application/json" } : {}), ...headers },
    ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  });
}
test("HTTP projection and evidence writes are guarded, uncached and conflict-aware", async () => {
  assert.equal((await GET(request())).status, 400);
  assert.equal((await GET(request("?vaultId=other"))).status, 404);
  assert.equal((await GET(request("?vaultId=local&path=../registry.json"))).status, 400);
  assert.equal((await GET(request("?vaultId=local", "GET", undefined, { origin: "https://evil.test" }))).status, 403);
  const catalog = await GET(request("?vaultId=local"));
  assert.equal(catalog.headers.get("cache-control"), "private, no-store");
  assert.equal((await catalog.json()).notes.length, 1);
  const { sections } = await (await GET(request("?vaultId=local&path=Roadmap.md"))).json();
  const body = { vaultId: "local", path: "Roadmap.md", section: sections[1].id, fingerprint: sections[1].fingerprint, status: "gap", evidence: "Need to compare failure cases.", revision: 0 };
  assert.equal((await PATCH(request("", "PATCH", body, { origin: "https://evil.test" }))).status, 403);
  assert.equal((await PATCH(request("", "PATCH", body, { "Content-Type": "text/plain" }))).status, 415);
  assert.equal((await PATCH(request("", "PATCH", "{"))).status, 400);
  const saved = await PATCH(request("", "PATCH", body));
  assert.equal(saved.status, 200);
  assert.equal(saved.headers.get("cache-control"), "private, no-store");
  assert.equal((await saved.json()).record.revision, 1);
  assert.equal((await PATCH(request("", "PATCH", body))).status, 409);
  assert.equal((await PATCH(request("", "PATCH", { ...body, revision: 1, status: "confident", evidence: "" }))).status, 400);
  const progress = (await (await GET(request("?vaultId=local"))).json()).progress;
  assert.equal(progress[0].status, "gap");
});
