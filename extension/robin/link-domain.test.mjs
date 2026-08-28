import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { getLink, listLinks, refreshLinkIcon, updateLink } from "./link-domain.ts";
import { readLinks, writeLinks } from "./store.ts";

const previousDataDir = process.env.ROBIN_DATA_DIR;
const dataDir = mkdtempSync(join(tmpdir(), "robin-link-domain-test-"));
process.env.ROBIN_DATA_DIR = dataDir;

after(() => {
  rmSync(dataDir, { recursive: true, force: true });
  if (previousDataDir === undefined) delete process.env.ROBIN_DATA_DIR;
  else process.env.ROBIN_DATA_DIR = previousDataDir;
});

const saved = (over = {}) => ({
  id: "saved",
  title: "Old title",
  url: "https://example.com/old",
  createdAt: "2026-08-01T00:00:00.000Z",
  ...over,
});

test("the link domain owns link reads", () => {
  writeLinks([saved()]);
  assert.deepEqual(listLinks(), [saved()]);
  assert.equal(getLink("saved")?.title, "Old title");
  assert.equal(getLink("missing"), null);
});

test("updating a URL preserves links written while metadata is loading", async (t) => {
  let release;
  const metadataReady = new Promise((resolve) => { release = resolve; });
  let started;
  const metadataStarted = new Promise((resolve) => { started = resolve; });
  t.mock.method(globalThis, "fetch", async () => {
    started();
    await metadataReady;
    return new Response("<html><head><title>New title</title></head></html>", {
      headers: { "Content-Type": "text/html" },
    });
  });

  writeLinks([saved()]);
  const updating = updateLink("saved", { url: "https://example.com/new" });
  await metadataStarted;
  writeLinks([...readLinks(), saved({ id: "concurrent", title: "Concurrent" })]);
  release();
  await updating;

  assert.deepEqual(readLinks().map(({ id }) => id), ["saved", "concurrent"]);
  assert.equal(readLinks()[0].url, "https://example.com/new");
});

test("refreshing an icon preserves links written while metadata is loading", async (t) => {
  let release;
  const metadataReady = new Promise((resolve) => { release = resolve; });
  let started;
  const metadataStarted = new Promise((resolve) => { started = resolve; });
  t.mock.method(globalThis, "fetch", async () => {
    started();
    await metadataReady;
    return new Response("<html><head></head></html>", {
      headers: { "Content-Type": "text/html" },
    });
  });

  writeLinks([saved()]);
  const refreshing = refreshLinkIcon("saved");
  await metadataStarted;
  writeLinks([...readLinks(), saved({ id: "concurrent", title: "Concurrent" })]);
  release();
  await refreshing;

  assert.deepEqual(readLinks().map(({ id }) => id), ["saved", "concurrent"]);
});
