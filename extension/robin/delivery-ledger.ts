/**
 * Which chat IDs have received which run. Registered production ledgers move
 * to SQLite in v3; custom filenames retain the same locked JSON interface.
 * pending/mark records delivery history, NOT an exactly-once network send:
 * sending remains outside transactions and needs the bridge's orchestration.
 */
import { readJsonObject, updateJsonObject } from "./paths.ts";
import { readRuntimeState, updateRuntimeState } from "./task-store.ts";
import { isRuntimeStateFile } from "./runtime-state-schema.ts";

const HISTORY = 20;

export interface DeliveryLedger {
  /** The chat ids in `audience` that have not yet been delivered for `key`. */
  pending(key: string, audience: number[]): number[];
  /** Record that `chatId` received `key`, once. */
  mark(key: string, chatId: number): void;
}

interface StoredRuns {
  runs?: Record<string, number[]>;
  date?: string;
  runKey?: string;
  chatIds?: number[];
}

function runsOf(stored: StoredRuns | null): Record<string, number[]> {
  if (!stored) return {};
  if (stored.runs && typeof stored.runs === "object" && !Array.isArray(stored.runs)) return stored.runs;
  // Interpret legacy single-run shapes without writing, clearing or resending.
  const key = typeof stored.runKey === "string" ? stored.runKey
    : typeof stored.date === "string" ? stored.date : null;
  return key ? { [key]: Array.isArray(stored.chatIds) ? stored.chatIds : [] } : {};
}

export function createDeliveryLedger(file: string): DeliveryLedger {
  const read = () => isRuntimeStateFile(file)
    ? readRuntimeState<StoredRuns>(file) : readJsonObject<StoredRuns>(file);
  return {
    pending(key, audience) {
      const sent = runsOf(read())[key] ?? [];
      return audience.filter((chatId) => !sent.includes(chatId));
    },
    mark(key, chatId) {
      const update = (stored: StoredRuns | null) => {
        const runs = runsOf(stored);
        const sent = runs[key] ?? [];
        if (sent.includes(chatId)) return { result: undefined, value: stored ?? {}, changed: false };
        const trimmed = Object.fromEntries(Object.entries({ ...runs, [key]: [...sent, chatId] })
          .sort(([a], [b]) => a.localeCompare(b)).slice(-HISTORY));
        // Preserve unknown fields; trim only when genuinely marking a delivery,
        // never during migration or a read. Read/merge/write is one transaction.
        return { result: undefined, value: { ...stored, runs: trimmed }, changed: true };
      };
      if (isRuntimeStateFile(file)) updateRuntimeState(file, update);
      else updateJsonObject(file, update);
    },
  };
}
