/**
 * Shared file plumbing for the Robin stores.
 *
 * Imported from two very different runtimes — the pi extension (loaded by jiti)
 * and the Next.js server (webpack) — so it stays on node builtins only.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Data lives outside ~/.pi/agent so pi never treats it as its own state. */
export function dataDir(): string {
  return process.env.ROBIN_DATA_DIR || join(homedir(), ".pi", "robin");
}

export function dataPath(name: string): string {
  return join(dataDir(), name);
}

export function readJsonArray<T>(name: string): T[] {
  let raw: string;
  try {
    raw = readFileSync(dataPath(name), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  // A parse failure must not fall through to an empty list: the next write
  // would silently replace a damaged-but-recoverable file with [].
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`${dataPath(name)} does not contain a JSON array`);
  }
  return parsed as T[];
}

const LOCK_STALE_MS = 30_000;
const LOCK_TIMEOUT_MS = 30_000;

function sleepSync(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

/**
 * Serialize one read-modify-write across all Robin processes.
 * ponytail: synchronous bounded lock keeps existing sync domain interfaces; use
 * an async lock if this store ever serves high-contention traffic.
 */
export function withFileLock<T>(path: string, action: () => T): T {
  const lock = `${path}.lock`;
  mkdirSync(dirname(path), { recursive: true });
  const started = Date.now();

  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) {
          rmSync(lock, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() - started >= LOCK_TIMEOUT_MS) {
        throw new Error(`Timed out waiting for ${path}`);
      }
      sleepSync(10);
    }
  }

  try {
    return action();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

/** Write-then-rename keeps readers from ever seeing a half-written file. */
function writeJsonArrayUnlocked<T>(name: string, items: T[]): void {
  const path = dataPath(name);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(items, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

export function writeJsonArray<T>(name: string, items: T[]): void {
  withFileLock(dataPath(name), () => writeJsonArrayUnlocked(name, items));
}

/** Atomically read, mutate, and optionally persist one JSON array. */
export function updateJsonArray<T, R>(
  name: string,
  updater: (items: T[]) => { value: R; changed: boolean },
): R {
  return withFileLock(dataPath(name), () => {
    const items = readJsonArray<T>(name);
    const result = updater(items);
    if (result.changed) writeJsonArrayUnlocked(name, items);
    return result.value;
  });
}

export function readJsonObject<T>(name: string): T | null {
  let raw: string;
  try {
    raw = readFileSync(dataPath(name), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${dataPath(name)} does not contain a JSON object`);
  }
  return parsed as T;
}

function writeJsonObjectUnlocked<T extends object>(name: string, value: T): void {
  const path = dataPath(name);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

export function writeJsonObject<T extends object>(name: string, value: T): void {
  withFileLock(dataPath(name), () => writeJsonObjectUnlocked(name, value));
}

/** Atomically read, mutate, and optionally persist one JSON object. */
export function updateJsonObject<T extends object, R>(
  name: string,
  updater: (value: T | null) => { result: R; value: T; changed: boolean },
): R {
  return withFileLock(dataPath(name), () => {
    const result = updater(readJsonObject<T>(name));
    if (result.changed) writeJsonObjectUnlocked(name, result.value);
    return result.result;
  });
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}
