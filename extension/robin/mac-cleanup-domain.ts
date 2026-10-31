import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, sep } from "node:path";
import { promisify } from "node:util";
import type { DiskEntry, DiskScanIssue, MacCleanupResult, MacDiskScan } from "./mac-system.ts";

const exec = promisify(execFile);
const CACHE_PATHS = [
  ["npm", ".npm/_cacache"],
  ["npm-logs", ".npm/_logs"],
  ["pip", "Library/Caches/pip"],
  ["uv", ".cache/uv"],
  ["homebrew", "Library/Caches/Homebrew"],
  ["xcode", "Library/Developer/Xcode/DerivedData"],
] as const;
const FOLDERS = ["Downloads", "Documents", "Desktop", "Library", "Movies", "Pictures"];
const TTL = 10 * 60_000;
export class MacCleanupError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
class ScanIssue extends Error {
  issue: DiskScanIssue;
  constructor(issue: DiskScanIssue, message: string) { super(message); this.issue = issue; }
}
/** Keep command output private; only a bounded reason code crosses the API. */
export function scanIssue(error: unknown): DiskScanIssue {
  if (error instanceof ScanIssue) return error.issue;
  const e = error as { code?: string; name?: string; killed?: boolean; stderr?: string } | null;
  if (e?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return "failed";
  if (e?.name === "TimeoutError" || e?.name === "AbortError" || e?.killed || e?.code === "ETIMEDOUT") return "timeout";
  if (e?.code === "EACCES" || e?.code === "EPERM" || /Operation not permitted|Permission denied/i.test(e?.stderr ?? "")) return "permission";
  return "failed";
}
type Identity = { dev: number; ino: number; mtimeMs: number; ctimeMs: number };
function sameFile(a: Identity, b: Identity) { return a.dev === b.dev && a.ino === b.ino && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs; }

/** No arbitrary browsing paths: every candidate comes from the fixed cache allow-list. */
async function inspect(home: string, path: string) {
  const rel = relative(home, path);
  if (!rel || rel.startsWith(`..${sep}`) || rel === ".." || rel.startsWith(sep)) throw new Error("Path is outside the home directory");
  const homeDevice = (await lstat(home)).dev;
  let current = home;
  for (const part of ["", ...rel.split(sep)]) {
    if (part) current = join(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory() || info.uid !== process.getuid?.() || info.dev !== homeDevice) throw new ScanIssue("excluded", "Linked, mounted or unowned directory is excluded");
  }
  if (await realpath(path) !== path) throw new ScanIssue("excluded", "Linked directory is excluded");
  return lstat(path);
}

/** A testable filesystem boundary: tests supply a temporary home and a fake Trash operation. */
export function createMacCleanup(deps: {
  home: () => string;
  measure: (path: string, signal: AbortSignal, timeoutMs: number) => Promise<number>;
  trashAvailable: () => Promise<boolean>;
  trash: (path: string) => Promise<void>;
}) {
  let busy = false;
  const plans = new Map<string, { home: string; expires: number; identities: Map<string, Identity> }>();
  return {
    async scan(signal?: AbortSignal): Promise<MacDiskScan> {
      if (busy) throw new MacCleanupError("A disk operation is already running", 409);
      busy = true;
      try {
        const home = await realpath(deps.home());
        const expires = Date.now() + TTL;
        const identities = new Map<string, Identity>();
        const scan: MacDiskScan = { id: randomUUID(), scannedAt: new Date().toISOString(), expiresAt: new Date(expires).toISOString(), canTrash: await deps.trashAvailable(), folders: [], caches: [] };
        const deadline = AbortSignal.any([AbortSignal.timeout(45_000), ...(signal ? [signal] : [])]);
        const jobs = [
          ...CACHE_PATHS.map(([id, rel]) => ({ id, name: id, rel, cache: true })),
          ...FOLDERS.map((name) => ({ id: name, name, rel: name, cache: false })),
        ];
        // Two du processes at a time, no background whole-disk index or privileged traversal.
        let next = 0;
        await Promise.all([0, 1].map(async () => {
          while (next < jobs.length) {
            const job = jobs[next++], path = join(home, job.rel);
            const entry: DiskEntry = { id: job.id, name: job.name, path: `~/${job.rel}`, bytes: null, status: "unavailable" };
            try {
              deadline.throwIfAborted();
              const before = await inspect(home, path);
              const bytes = await deps.measure(path, deadline, job.cache ? 6500 : 30_000);
              const after = await inspect(home, path);
              if (!sameFile(before, after)) throw new ScanIssue("changed", "Directory changed while scanning");
              if (!Number.isFinite(bytes) || bytes < 0) throw new Error("Invalid directory size");
              entry.bytes = bytes; entry.status = "ready";
              if (job.cache) identities.set(job.id, after);
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === "ENOENT") entry.status = "missing";
              else entry.issue = scanIssue(error);
            }
            (job.cache ? scan.caches : scan.folders).push(entry);
          }
        }));
        signal?.throwIfAborted();
        scan.folders.sort((a, b) => (b.bytes ?? -1) - (a.bytes ?? -1));
        scan.caches.sort((a, b) => (b.bytes ?? -1) - (a.bytes ?? -1));
        for (const [id, plan] of plans) if (plan.expires < Date.now()) plans.delete(id);
        while (plans.size >= 3) plans.delete(plans.keys().next().value!);
        plans.set(scan.id, { home, expires, identities });
        return scan;
      } finally { busy = false; }
    },
    async trash(raw: unknown): Promise<MacCleanupResult> {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new MacCleanupError("Invalid cleanup request");
      const input = raw as { scanId?: unknown; ids?: unknown; confirmed?: unknown };
      if (input.confirmed !== true || typeof input.scanId !== "string" || !Array.isArray(input.ids) || !input.ids.length || input.ids.length > CACHE_PATHS.length || input.ids.some((id) => typeof id !== "string") || new Set(input.ids).size !== input.ids.length) throw new MacCleanupError("Choose cache items and explicitly confirm Trash");
      if (busy) throw new MacCleanupError("A disk operation is already running", 409);
      const plan = plans.get(input.scanId);
      if (!plan || plan.expires < Date.now()) throw new MacCleanupError("Scan expired or already used; scan again", 409);
      const selected = input.ids.map((id) => {
        const definition = CACHE_PATHS.find(([key]) => key === id), identity = plan.identities.get(id as string);
        if (!definition || !identity) throw new MacCleanupError("Item was not an eligible cache in this scan");
        return { id: definition[0], rel: definition[1], identity };
      });
      busy = true;
      try {
        if (!await deps.trashAvailable()) throw new MacCleanupError("Native Trash is unavailable; macOS 15 or later is required", 503);
        if (await realpath(deps.home()) !== plan.home) throw new MacCleanupError("Home directory changed; scan again", 409);
        // Validate the entire selection before moving anything. Revalidate each item just before use.
        for (const item of selected) {
          const info = await inspect(plan.home, join(plan.home, item.rel));
          if (!sameFile(info, item.identity)) throw new MacCleanupError("A cache changed since scanning; scan again", 409);
        }
        plans.clear(); // All other tabs must rescan after this attempt; never auto-retry a move.
        const items: MacCleanupResult["items"] = [];
        for (const item of selected) {
          const path = join(plan.home, item.rel);
          try {
            if (!sameFile(await inspect(plan.home, path), item.identity)) throw new Error("Cache changed; scan again");
            await deps.trash(path);
            items.push({ id: item.id, path: `~/${item.rel}`, status: "trashed" });
          } catch {
            items.push({ id: item.id, path: `~/${item.rel}`, status: "failed", error: "Move not confirmed. Inspect Trash and the original location before rescanning." });
          }
        }
        return { items };
      } finally { busy = false; }
    },
  };
}
// Versioned slot: HMR must not retain the old scan budget or pre-contract-change plans.
const state = globalThis as typeof globalThis & { robinMacCleanupV2?: ReturnType<typeof createMacCleanup> };
export const macCleanup = state.robinMacCleanupV2 ??= createMacCleanup({
  home: homedir,
  measure: async (path, signal, timeoutMs) => {
    const { stdout } = await exec("/usr/bin/du", ["-skx", path], { signal, timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: 64 * 1024, env: { NODE_ENV: process.env.NODE_ENV, PATH: "/usr/bin:/bin", LC_ALL: "C" } });
    const match = /^(\d+)\s/.exec(stdout);
    if (!match) throw new Error("No size available");
    return Number(match[1]) * 1024;
  },
  trashAvailable: async () => {
    if (process.platform !== "darwin" || process.getuid?.() === 0) return false;
    try { await access("/usr/bin/trash", constants.X_OK); return true; } catch { return false; }
  },
  trash: async (path) => {
    // Apple's native Trash preserves recovery behavior. No shell, sudo, rm, or permanent-delete fallback.
    await exec("/usr/bin/trash", ["-s", path], { timeout: 15_000, killSignal: "SIGKILL", maxBuffer: 64 * 1024, env: { NODE_ENV: process.env.NODE_ENV, PATH: "/usr/bin:/bin", HOME: homedir(), LC_ALL: "C" } });
  },
});
