import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { browseVault, discoverVaults, readVaultNote } from "./obsidian-browser-domain.ts";
import { vaultLinks, vaultLinkResolver, vaultPreview } from "./obsidian-links.ts";

const root = mkdtempSync(join(tmpdir(), "obsidian-browser-"));
const vault = join(root, "Vault");
const previous = process.env.ROBIN_OBSIDIAN_CONFIG;
process.env.ROBIN_OBSIDIAN_CONFIG = join(root, "registry.json");
mkdirSync(join(vault, ".obsidian"), { recursive: true });
writeFileSync(process.env.ROBIN_OBSIDIAN_CONFIG, JSON.stringify({ vaults: { local: { path: vault } } }));
function put(path, content) {
  const target = join(vault, path);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, content);
}
put("Home.md", "# Home\n\n[[知识/概念|概念]] [[Absent]]\n[Other](Notes/Other.md) ![[picture.png]]\n`[[Fake]]`\n```md\n[[Not a link]]\n```\n");
put("知识/概念.md", "# 概念\n\n[[Home#Home]]");
put("Notes/Other.md", "[Back](../Home.md)\n\n[[Ambiguous]]");
put("a/Ambiguous.md", "A");
put("b/Ambiguous.md", "B");
put(".private/Secret.md", "hidden");
put("large.md", "x".repeat(256 * 1024 + 1));
put("data.json", "{}");
writeFileSync(join(root, "Outside.md"), "outside secret");
symlinkSync(join(root, "Outside.md"), join(vault, "escape.md"));
symlinkSync(root, join(vault, "escape-dir"), "dir");
after(() => {
  rmSync(root, { recursive: true, force: true });
  if (previous === undefined) delete process.env.ROBIN_OBSIDIAN_CONFIG; else process.env.ROBIN_OBSIDIAN_CONFIG = previous;
});

test("reads live notes and builds explicit links without changing any vault bytes", async () => {
  const before = readdirSync(vault);
  assert.equal(discoverVaults()[0].id, "local");
  const index = await browseVault("local");
  assert.equal(index.limited, false);
  assert.equal(index.skipped, 1);
  assert.equal(index.notes.length, 5);
  const home = index.notes.find((note) => note.path === "Home.md");
  assert.deepEqual(home.links, ["知识/概念.md", "Notes/Other.md"]);
  assert.deepEqual(home.unresolved, ["Absent"]);
  assert.ok(home.excerpt.includes("概念"));
  assert.ok(!home.excerpt.includes("Not a link"));
  assert.ok(home.excerpt.length <= 240);
  assert.deepEqual(index.notes.find((note) => note.path === "Notes/Other.md").links, ["Home.md"]);
  assert.deepEqual(index.notes.find((note) => note.path === "Notes/Other.md").unresolved, ["Ambiguous"]);
  const note = await readVaultNote("local", "知识/概念.md");
  assert.equal(note.content, readFileSync(join(vault, "知识/概念.md"), "utf8"));
  assert.equal(new URL(note.url).searchParams.get("path"), realpathSync(join(vault, "知识/概念.md")));
  assert.deepEqual(readdirSync(vault), before);
  put("Notes/Other.md", "# Changed externally\n\n[[知识/概念]]");
  assert.match((await readVaultNote("local", "Notes/Other.md")).content, /Changed externally/);
  assert.deepEqual((await browseVault("local")).notes.find((note) => note.path === "Notes/Other.md").links, ["知识/概念.md"]);
});

test("rejects traversal, hidden files, symlinks, non-notes and oversized files", async () => {
  for (const path of ["../Outside.md", "/Home.md", "a/../../Outside.md", "a\\file.md", ".private/Secret.md", ".obsidian/config.md", "escape.md", "escape-dir/Outside.md", "data.json", "large.md", "Home.md\0"]) {
    await assert.rejects(readVaultNote("local", path), undefined, path);
  }
  await assert.rejects(readVaultNote("local", "missing.md"), (error) => error.status === 404);
  await assert.rejects(browseVault("not-registered"), (error) => error.status === 404);
});

test("link parsing preserves code, resolves Unicode and relative links, refuses ambiguity", () => {
  const markdown = "[[Home|Start]] ![[知识/概念#Heading]] `[[Not]]`\n~~~md\n[[Neither]]\n~~~\n<!-- [[Hidden]] -->\n[Go](../Home.md)";
  assert.deepEqual(vaultLinks(markdown).map((link) => link.target), ["Home", "知识/概念#Heading", "../Home.md"]);
  const rendered = vaultPreview(markdown);
  assert.ok(rendered.startsWith("[Start](?wiki=Home)"));
  assert.ok(rendered.includes("`[[Not]]`"));
  assert.ok(rendered.includes("[[Neither]]"));
  const resolve = vaultLinkResolver(["Home.md", "知识/概念.md", "a/Duplicate.md", "b/Duplicate.md"]);
  assert.equal(resolve("a/Source.md", "../Home.md", false), "Home.md");
  assert.equal(resolve("a/Source.md", "概念#标题"), "知识/概念.md");
  assert.equal(resolve("Home.md", "Duplicate"), null);
  assert.equal(resolve("a/Source.md", "Duplicate"), "a/Duplicate.md");
  assert.equal(resolve("Home.md", "#Home"), "Home.md");
  assert.equal(resolve("Home.md", "%E7%9F%A5%E8%AF%86/%E6%A6%82%E5%BF%B5"), "知识/概念.md");
  for (const target of ["../../../Home", "%zz", "https://example.com", "file:///etc/passwd", "//host/file", "a\\Home"]) assert.equal(resolve("Home.md", target), null);
});

test("caps the catalog and reports truncation instead of silently claiming completeness", async () => {
  const big = join(root, "Big");
  mkdirSync(join(big, ".obsidian"), { recursive: true });
  for (let i = 0; i < 1002; i++) writeFileSync(join(big, `${i}.md`), "# Small");
  writeFileSync(process.env.ROBIN_OBSIDIAN_CONFIG, JSON.stringify({ vaults: { local: { path: vault }, big: { path: big } } }));
  const index = await browseVault("big");
  assert.equal(index.notes.length, 1000);
  assert.equal(index.limited, true);
});
