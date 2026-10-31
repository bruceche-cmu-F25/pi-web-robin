/** Client-safe contracts and parsers. Missing measurements stay null, never zero. */
export interface MacSnapshot {
  supported: boolean;
  sampledAt: string;
  host: string;
  model: string;
  cores: number;
  uptime: number;
  cpu: number | null;
  perCore: (number | null)[];
  gpu: number | null;
  memory: { total: number; used: number; compressed: number } | null;
  swap: { used: number; total: number } | null;
  disk: { total: number; available: number; used: number } | null;
  issues: string[];
}
export type DiskScanIssue = "permission" | "timeout" | "changed" | "excluded" | "failed";
export interface DiskEntry {
  id: string;
  name: string;
  path: string;
  bytes: number | null;
  status: "ready" | "missing" | "unavailable";
  issue?: DiskScanIssue;
}
export interface MacDiskScan {
  id: string;
  scannedAt: string;
  expiresAt: string;
  canTrash: boolean;
  folders: DiskEntry[];
  caches: DiskEntry[];
}
export interface MacCleanupResult {
  items: { id: string; path: string; status: "trashed" | "failed"; error?: string }[];
}
export function cpuPercent(before: { idle: number; total: number }, after: { idle: number; total: number }): number | null {
  const total = after.total - before.total, idle = after.idle - before.idle;
  return total > 0 && idle >= 0 && idle <= total ? 100 * (total - idle) / total : null;
}
export function parseGpu(text: string): number | null {
  const values = [...text.matchAll(/"(?:Device Utilization %|GPU Activity\(%\))"\s*=\s*(\d+(?:\.\d+)?)/g)]
    .map((match) => Number(match[1])).filter((n) => n >= 0 && n <= 100);
  // Multi-GPU machines report the busiest accelerator, not a made-up combined percentage.
  return values.length ? Math.max(...values) : null;
}
export function parseMemory(text: string, total: number): MacSnapshot["memory"] {
  const pageSize = Number(/page size of (\d+) bytes/.exec(text)?.[1]);
  const pages = new Map([...text.matchAll(/^([^:\n]+):\s+(\d+)\./gm)].map((m) => [m[1], Number(m[2])]));
  const anonymous = pages.get("Anonymous pages"), wired = pages.get("Pages wired down"), compressed = pages.get("Pages occupied by compressor"), purgeable = pages.get("Pages purgeable");
  if (!pageSize || anonymous === undefined || wired === undefined || compressed === undefined || purgeable === undefined) return null;
  // Physical anonymous + wired + compressor, excluding purgeable anonymous pages.
  const used = (Math.max(0, anonymous - purgeable) + wired + compressed) * pageSize;
  if (used > total || total <= 0) return null;
  return { total, used, compressed: compressed * pageSize };
}
export function parseSwap(text: string): MacSnapshot["swap"] {
  const match = /total\s*=\s*([\d.]+)M\s+used\s*=\s*([\d.]+)M/.exec(text);
  if (!match) return null;
  const total = Number(match[1]) * 1024 ** 2, used = Number(match[2]) * 1024 ** 2;
  return Number.isFinite(total) && Number.isFinite(used) && used <= total ? { total, used } : null;
}
/** A distribution of measured entries only, never a whole-disk accounting. */
export function diskBreakdown(entries: DiskEntry[]) {
  const measured = entries.filter((entry): entry is DiskEntry & { bytes: number } => entry.status === "ready" && entry.bytes !== null && Number.isFinite(entry.bytes) && entry.bytes >= 0);
  const total = measured.reduce((sum, entry) => sum + entry.bytes, 0);
  let offset = 0;
  return { total, measured: measured.map((entry) => {
    const share = total > 0 ? entry.bytes / total * 100 : 0;
    const segment = { ...entry, share, offset };
    offset += share;
    return segment;
  }) };
}
export function formatMacBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  const exponent = Math.min(4, Math.max(0, Math.floor(Math.log2(Math.max(1, bytes)) / 10)));
  return `${(bytes / 1024 ** exponent).toFixed(exponent ? 1 : 0)} ${["B", "KiB", "MiB", "GiB", "TiB"][exponent]}`;
}
