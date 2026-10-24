import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createJiti } from "jiti";
const { GET } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./route.ts");
const root = mkdtempSync(join(tmpdir(), "obsidian-browser-api-"));
const previous = process.env.ROBIN_OBSIDIAN_CONFIG;
process.env.ROBIN_OBSIDIAN_CONFIG = join(root, "registry.json");
mkdirSync(join(root, "Vault", ".obsidian"), { recursive: true });
writeFileSync(join(root, "Vault", "Hello.md"), "# Hello");
writeFileSync(process.env.ROBIN_OBSIDIAN_CONFIG, JSON.stringify({ vaults: { local: { path: join(root, "Vault") } } }));
after(() => {
  rmSync(root, { recursive: true, force: true });
  if (previous === undefined) delete process.env.ROBIN_OBSIDIAN_CONFIG; else process.env.ROBIN_OBSIDIAN_CONFIG = previous;
});
const request = (query = "", headers = {}) => new Request(`http://localhost:30141/api/robin/obsidian/vault${query}`, { headers: { host: "localhost:30141", ...headers } });
test("read-only API discovers, indexes and reads registered vaults without caching", async () => {
  const discovery = await GET(request());
  assert.equal(discovery.status, 200);
  assert.equal(discovery.headers.get("cache-control"), "private, no-store");
  assert.equal((await discovery.json()).vaults[0].id, "local");
  const index = await GET(request("?vaultId=local"));
  assert.equal((await index.json()).notes[0].path, "Hello.md");
  const read = await GET(request("?vaultId=local&path=Hello.md"));
  assert.equal((await read.json()).note.content, "# Hello");
});
test("origin and path checks apply to reads too", async () => {
  assert.equal((await GET(request("", { origin: "https://evil.example" }))).status, 403);
  assert.equal((await GET(request("?vaultId=unknown"))).status, 404);
  assert.equal((await GET(request("?vaultId=local&path=../registry.json"))).status, 400);
  assert.equal((await GET(request("?vaultId=local&path=missing.md"))).status, 404);
});
