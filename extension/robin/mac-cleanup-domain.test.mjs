import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, writeFile, rm, rename, symlink, utimes, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createMacCleanup, scanIssue } from "./mac-cleanup-domain.ts";

async function fixture(t, overrides = {}) {
  const home = await realpath(await mkdtemp(join(tmpdir(), "robin-mac-test-")));
  t.after(() => rm(home, { recursive: true, force: true }));
  const path = join(home, ".npm/_cacache");
  await mkdir(path, { recursive: true }); await writeFile(join(path, "fixture"), "disposable test data");
  const moved = [];
  const service = createMacCleanup({ home: () => home, measure: async () => 8192, trashAvailable: async () => true, trash: async (source) => {
    moved.push(source); await rename(source, join(home, `fake-trash-${moved.length}`));
  }, ...overrides });
  return { home, path, moved, service };
}
const request = (scan, ids = ["npm"]) => ({ scanId: scan.id, ids, confirmed: true });

test("scan is read-only; selected cache is moved only after confirmation, token is single-use", async (t) => {
  const { service, path, moved } = await fixture(t);
  const scan = await service.scan();
  assert.equal(scan.caches.find((x) => x.id === "npm").bytes, 8192);
  assert.equal(scan.caches.find((x) => x.id === "pip").status, "missing");
  assert.equal(moved.length, 0); assert.ok(await lstat(path));
  await assert.rejects(service.trash({ ...request(scan), confirmed: false }));
  for (const ids of [["Downloads"], ["../../Documents"], ["npm", "npm"], ["pip"], [], [null]]) await assert.rejects(service.trash(request(scan, ids)));
  await assert.rejects(service.trash({ ...request(scan), scanId: "invented" }));
  const result = await service.trash(request(scan));
  assert.equal(result.items[0].status, "trashed"); assert.deepEqual(moved, [path]);
  await assert.rejects(service.trash(request(scan)), /expired|already used/);
});

test("linked targets and linked ancestors are never eligible, including swaps after scanning", async (t) => {
  const { service, path, home, moved } = await fixture(t);
  const scan = await service.scan();
  await rename(join(home, ".npm"), join(home, "original"));
  await symlink(join(home, "original"), join(home, ".npm"));
  await assert.rejects(service.trash(request(scan)), /Linked/);
  assert.equal(moved.length, 0);
  const linked = await service.scan();
  assert.equal(linked.caches.find((x) => x.id === "npm").status, "unavailable");
  assert.equal(linked.caches.find((x) => x.id === "npm").issue, "excluded");
  await assert.rejects(service.trash(request(linked)), /eligible/);
  await rm(join(home, ".npm")); await mkdir(join(home, ".npm"));
  await symlink(join(home, "original/_cacache"), path);
  const leafLinked = await service.scan();
  assert.equal(leafLinked.caches.find((x) => x.id === "npm").status, "unavailable");
});

test("changed caches fail the whole preflight; failed measurements cannot be selected", async (t) => {
  const { service, path, moved } = await fixture(t);
  const scan = await service.scan();
  await utimes(path, new Date(0), new Date(0));
  await assert.rejects(service.trash(request(scan)), /changed/); assert.equal(moved.length, 0);
  const failed = await fixture(t, { measure: async () => { throw new Error("Permission denied"); } });
  const incomplete = await failed.service.scan();
  assert.equal(incomplete.caches.find((x) => x.id === "npm").bytes, null);
  await assert.rejects(failed.service.trash(request(incomplete)), /eligible/);
});

test("partial failure is explicit and consumes scan; missing Trash does not move", async (t) => {
  let count = 0;
  const { service, home } = await fixture(t, { trash: async () => { if (++count === 2) throw new Error("timeout"); } });
  await mkdir(join(home, ".npm/_logs"));
  const scan = await service.scan();
  const result = await service.trash(request(scan, ["npm", "npm-logs"]));
  assert.deepEqual(result.items.map((item) => item.status), ["trashed", "failed"]);
  await assert.rejects(service.trash(request(scan)), /expired|already used/);
  const absent = await fixture(t, { trashAvailable: async () => false });
  const noTrash = await absent.service.scan(); assert.equal(noTrash.canTrash, false);
  await assert.rejects(absent.service.trash(request(noTrash)), /unavailable/);
  assert.equal(absent.moved.length, 0);
});

test("concurrent operations are refused; aborted scans do not authorize cleanup", async (t) => {
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  const { service, moved } = await fixture(t, { measure: async () => { await wait; return 8192; } });
  const controller = new AbortController();
  const first = service.scan(controller.signal);
  await assert.rejects(service.scan(), /already running/);
  controller.abort(); release(); await assert.rejects(first);
  assert.equal(moved.length, 0);
});

test("large personal folders get 30 seconds, cache scans stay bounded at 6.5 seconds", async (t) => {
  const calls = [];
  const { service, home } = await fixture(t, { measure: async (path, signal, timeoutMs) => { calls.push({ path, timeoutMs }); return 8192; } });
  await mkdir(join(home, "Library"));
  await service.scan();
  assert.equal(calls.find((c) => c.path.endsWith("/_cacache")).timeoutMs, 6500);
  assert.equal(calls.find((c) => c.path.endsWith("/Library")).timeoutMs, 30_000);
  assert.ok(calls[0].path.endsWith("/_cacache"), "caches are measured before long folder scans");
});

test("failure reason is specific; incomplete command stdout never becomes a size", async (t) => {
  assert.equal(scanIssue({ killed: true, signal: "SIGKILL" }), "timeout");
  assert.equal(scanIssue({ code: 1, stderr: "du: Operation not permitted" }), "permission");
  assert.equal(scanIssue({ code: "EACCES" }), "permission");
  assert.equal(scanIssue({ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", killed: true }), "failed");
  const { service, moved } = await fixture(t, { measure: async () => { throw Object.assign(new Error("stopped"), { killed: true, stdout: "123456\\tpartial" }); } });
  const scan = await service.scan();
  const npm = scan.caches.find((item) => item.id === "npm");
  assert.equal(npm.issue, "timeout"); assert.equal(npm.bytes, null);
  await assert.rejects(service.trash(request(scan)), /eligible/); assert.equal(moved.length, 0);
});

test("expired plan refuses cleanup", async (t) => {
  const { service, moved } = await fixture(t);
  const scan = await service.scan(), now = Date.now();
  t.mock.method(Date, "now", () => now + 11 * 60_000);
  await assert.rejects(service.trash(request(scan)), /expired/);
  assert.equal(moved.length, 0);
});
