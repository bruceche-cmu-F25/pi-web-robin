import { execFile } from "node:child_process";
import { cpus, hostname, platform, totalmem, uptime } from "node:os";
import { statfs } from "node:fs/promises";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { cpuPercent, parseGpu, parseMemory, parseSwap, type MacSnapshot } from "./mac-system.ts";

const exec = promisify(execFile);
const globalState = globalThis as typeof globalThis & { robinMacMetrics?: { value?: MacSnapshot; pending?: Promise<MacSnapshot> } };
const state = globalState.robinMacMetrics ??= {};
const command = async (file: string, args: string[] = []) => (await exec(file, args, {
  timeout: 2000, killSignal: "SIGKILL", maxBuffer: 2 * 1024 * 1024,
  env: { NODE_ENV: process.env.NODE_ENV, PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LC_ALL: "C" },
})).stdout;
function ticks() {
  return cpus().map(({ times }) => ({ idle: times.idle, total: Object.values(times).reduce((a, b) => a + b, 0) }));
}
async function collect(): Promise<MacSnapshot> {
  const cpu = cpus();
  const result: MacSnapshot = {
    supported: platform() === "darwin", sampledAt: new Date().toISOString(), host: hostname(),
    model: cpu[0]?.model ?? "Mac", cores: cpu.length, uptime: uptime(), cpu: null, perCore: [], gpu: null,
    memory: null, swap: null, disk: null, issues: [],
  };
  if (!result.supported) return result;
  const sample = async (name: string, work: () => Promise<void>) => {
    try { await work(); } catch { result.issues.push(name); }
  };
  await Promise.all([
    sample("cpu", async () => {
      const before = ticks(); await delay(400); const after = ticks();
      result.perCore = after.map((core, i) => before[i] ? cpuPercent(before[i], core) : null);
      if (before.length === after.length && before.length) {
        const sum = (values: ReturnType<typeof ticks>) => values.reduce((a, b) => ({ idle: a.idle + b.idle, total: a.total + b.total }), { idle: 0, total: 0 });
        result.cpu = cpuPercent(sum(before), sum(after));
      }
    }),
    sample("gpu", async () => { result.gpu = parseGpu(await command("/usr/sbin/ioreg", ["-r", "-d", "1", "-c", "IOAccelerator"])); }),
    sample("memory", async () => { result.memory = parseMemory(await command("/usr/bin/vm_stat"), totalmem()); }),
    sample("swap", async () => { result.swap = parseSwap(await command("/usr/sbin/sysctl", ["-n", "vm.swapusage"])); }),
    sample("disk", async () => {
      const fs = await statfs("/System/Volumes/Data");
      const total = fs.blocks * fs.bsize, available = Math.max(0, fs.bavail * fs.bsize);
      // APFS shares capacity with other volumes/snapshots. Occupied = capacity minus available,
      // not df's per-volume Used, which would understate unavailable container space.
      result.disk = { total, available, used: Math.max(0, total - available) };
    }),
  ]);
  for (const name of ["cpu", "gpu", "memory", "swap", "disk"] as const) if (result[name] === null && !result.issues.includes(name)) result.issues.push(name);
  result.sampledAt = new Date().toISOString();
  return result;
}
/** No daemon: only visible pages request samples. All clients share one short bounded sample. */
export async function readMacSnapshot(): Promise<MacSnapshot> {
  if (state.pending) return state.pending;
  if (state.value && Date.now() - Date.parse(state.value.sampledAt) < 2000) return state.value;
  state.pending = collect().then((value) => { state.value = value; return value; }).finally(() => { state.pending = undefined; });
  return state.pending;
}
