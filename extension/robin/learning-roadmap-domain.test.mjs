import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { splitRoadmap, isRoadmapPath } from "./learning-roadmap.ts";
import { roadmapCatalog, roadmapNote, saveRoadmapRecord } from "./learning-roadmap-domain.ts";

const root = mkdtempSync(join(tmpdir(), "learning-roadmap-"));
const before = { data: process.env.ROBIN_DATA_DIR, registry: process.env.ROBIN_OBSIDIAN_CONFIG };
process.env.ROBIN_DATA_DIR = join(root, "data");
process.env.ROBIN_OBSIDIAN_CONFIG = join(root, "registry.json");
const vault = join(root, "Vault"), path = "技术/职业路线图/01 - Full Stack.md";
mkdirSync(join(vault, ".obsidian"), { recursive: true });
mkdirSync(join(vault, "技术/职业路线图"), { recursive: true });
writeFileSync(process.env.ROBIN_OBSIDIAN_CONFIG, JSON.stringify({ vaults: { local: { path: vault } } }));
const text = "---\ntags: [roadmap]\n---\n# Full Stack\n\n[[Other]]\n\n## React\nExplain state.\n\n### 实践\nBuild a form.\n\n### 验收\n- [ ] Test a failure.\n\n## HTTP\nExplain requests.\n";
writeFileSync(join(vault, path), text);
writeFileSync(join(vault, "Other.md"), "# Other\nNot a roadmap");
after(() => {
  rmSync(root, { recursive: true, force: true });
  for (const [key, value] of [["ROBIN_DATA_DIR", before.data], ["ROBIN_OBSIDIAN_CONFIG", before.registry]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test("projects real chapters and practice without treating code, comments or YAML as lessons", () => {
  const source = "---\n## YAML\n---\n# Overview\n```md\n## Fake\n### 验收\n```\n<!--\nignored\n## Comment\n-->\n## C#\nTheory\n### 实践\nDo this\n#### 验收\n- [ ] Evidence\n### Other\nMore theory\n## C#\nSecond occurrence\n~~~md\n## Still fake\n~~~\n";
  const sections = splitRoadmap(source);
  assert.deepEqual(sections.map((section) => section.title), ["Overview", "C#", "C#"]);
  assert.equal(sections[1].practice, "### 实践\nDo this\n#### 验收\n- [ ] Evidence");
  assert.equal(sections[0].practice, "");
  assert.notEqual(sections[1].id, sections[2].id);
  assert.equal(splitRoadmap("# Empty")[0].id, "intro");
  assert.equal(splitRoadmap("## 检查是否理解\nQuestion?")[0].practice, "## 检查是否理解\nQuestion?");
  assert.equal(splitRoadmap(text.replace(/\n/g, "\r\n")).length, 3);
  assert.ok(isRoadmapPath(path));
  assert.ok(isRoadmapPath("技术/AI知识地图/03 - Eval.md"));
  assert.ok(!isRoadmapPath("Other.md"));
});

test("reads current source, records separate evidence and rejects conflicting/stale writes", async () => {
  const catalog = await roadmapCatalog("local");
  assert.deepEqual(catalog.notes.map((note) => note.path), [path]);
  assert.deepEqual(catalog.progress, []);
  const source = await roadmapNote("local", path);
  const section = source.sections[1];
  assert.match(section.practice, /Build a form/);
  const input = { vaultId: "local", path, section: section.id, fingerprint: section.fingerprint, status: "gap", evidence: "I cannot explain stale state.", revision: 0 };
  const saved = await saveRoadmapRecord(input);
  assert.equal(saved.revision, 1);
  assert.equal((await roadmapCatalog("local")).progress[0].status, "gap");
  assert.equal(readFileSync(join(vault, path), "utf8"), text, "never edits source ticks");
  await assert.rejects(saveRoadmapRecord(input), (error) => error.status === 409);
  await assert.rejects(saveRoadmapRecord({ ...input, status: "confident", evidence: "  " }), /evidence/);
  const another = source.sections[2];
  await saveRoadmapRecord({ ...input, section: another.id, fingerprint: another.fingerprint });
  assert.equal((await roadmapCatalog("local")).progress.length, 2, "independent sections merge");
  writeFileSync(join(vault, path), text.replace("Explain state.", "Explain derived state."));
  await assert.rejects(saveRoadmapRecord({ ...input, revision: 1 }), (error) => error.status === 409);
  const updated = await roadmapNote("local", path);
  assert.notEqual(updated.sections[1].fingerprint, section.fingerprint);
  assert.equal(updated.progress[0].evidence, input.evidence);
  const confirmed = await saveRoadmapRecord({ ...input, fingerprint: updated.sections[1].fingerprint, revision: 1, status: "confident", evidence: "Built a form and tested stale responses." });
  assert.equal(confirmed.revision, 2);
  assert.equal((await roadmapCatalog("local")).progress.length, 2);
});

test("all reads and writes retain the registered-vault boundary and validate data", async () => {
  await assert.rejects(roadmapCatalog("missing"), (error) => error.status === 404);
  for (const path of ["../Outside.md", ".obsidian/x.md", "/etc/passwd", "data.json"]) await assert.rejects(roadmapNote("local", path));
  writeFileSync(join(root, "Outside.md"), "# Private");
  symlinkSync(join(root, "Outside.md"), join(vault, "Roadmap.md"));
  await assert.rejects(roadmapNote("local", "Roadmap.md"));
  const section = (await roadmapNote("local", path)).sections[0];
  const input = { vaultId: "local", path, section: section.id, fingerprint: section.fingerprint, status: "learning", evidence: "", revision: 0 };
  for (const patch of [{ status: "verified" }, { evidence: "x".repeat(20_001) }, { revision: -1 }, { revision: 1.5 }, { section: "missing" }, { path: "../Outside.md" }]) await assert.rejects(saveRoadmapRecord({ ...input, ...patch }));
  for (const bad of [null, [], "hello", {}]) await assert.rejects(saveRoadmapRecord(bad));
  writeFileSync(join(process.env.ROBIN_DATA_DIR, "learning-roadmap-progress.json"), '{"bad": {"status": "gap"}}');
  await assert.rejects(roadmapCatalog("local"), /Invalid learning roadmap progress/);
  await assert.rejects(saveRoadmapRecord(input), /Invalid learning roadmap progress/);
});
