import assert from "node:assert/strict";
import { test } from "node:test";
import { cpuPercent, parseGpu, parseMemory, parseSwap, formatMacBytes, diskBreakdown } from "./mac-system.ts";

test("folder percentages use the measured subtotal, not the largest folder or disk capacity", () => {
  const entry = (id, bytes, status = "ready") => ({ id, name: id, path: `~/${id}`, bytes, status });
  const { total, measured } = diskBreakdown([entry("Pictures", 400), entry("Movies", 100), entry("Library", null, "unavailable"), entry("zero", 0), entry("invalid", 1000, "unavailable")]);
  assert.equal(total, 500); assert.equal(measured.length, 3);
  assert.deepEqual(measured.map(({ share, offset }) => [share, offset]), [[80, 0], [20, 80], [0, 100]]);
  assert.equal(diskBreakdown([entry("zero", 0)]).measured[0].share, 0);
  assert.deepEqual(diskBreakdown([entry("Library", null, "unavailable"), entry("invalid", NaN)]), { total: 0, measured: [] });
});

test("CPU uses tick differences; malformed or reset counters are unknown", () => {
  assert.equal(cpuPercent({ idle: 20, total: 100 }, { idle: 60, total: 200 }), 60);
  assert.equal(cpuPercent({ idle: 20, total: 100 }, { idle: 20, total: 100 }), null);
  assert.equal(cpuPercent({ idle: 20, total: 100 }, { idle: 10, total: 200 }), null);
});
test("GPU retains real zero, refuses missing/invalid data and uses busiest GPU", () => {
  assert.equal(parseGpu('"PerformanceStatistics" = {"Device Utilization %"=0}'), 0);
  assert.equal(parseGpu('"Device Utilization %"=16\n"GPU Activity(%)"=62'), 62);
  assert.equal(parseGpu('"Tiler Utilization %"=12'), null);
  assert.equal(parseGpu('"Device Utilization %"=101'), null);
});
test("memory uses actual page size and physical compressed pages, swap parses MiB", () => {
  const text = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Anonymous pages: 100.
Pages wired down: 20.
Pages purgeable: 5.
Pages stored in compressor: 900.
Pages occupied by compressor: 10.`;
  assert.deepEqual(parseMemory(text, 10000000), { total: 10000000, used: 125 * 16384, compressed: 10 * 16384 });
  assert.equal(parseMemory(text, 1), null);
  assert.equal(parseMemory("unknown", 10000000), null);
  assert.deepEqual(parseSwap("total = 2048.00M  used = 1024.50M free = 1023.50M"), { total: 2048 * 1024 ** 2, used: 1024.5 * 1024 ** 2 });
  assert.equal(parseSwap("failed"), null);
  assert.equal(formatMacBytes(1024 ** 3), "1.0 GiB");
  assert.equal(formatMacBytes(null), "—");
});
