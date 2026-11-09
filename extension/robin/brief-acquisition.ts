/** Private acquisition seam: owned checkpoints, immutable evidence and durable call budgets. */
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { BriefInput, BriefSource } from "./brief.ts";

export const BRIEF_REQUEST_LIMIT = 32;
export const BRIEF_RESPONSE_LIMIT = 2 * 1024 * 1024;
export class BriefBudgetExhausted extends Error {
  constructor() { super("Brief acquisition request budget exhausted"); }
}
/** Planned continuation between bounded batches; no incomplete edition is published. */
export class BriefWorkPending extends Error {}
export class BriefAcquisitionStorageError extends Error {
  constructor(cause: unknown) { super("Brief acquisition checkpoint failed", { cause }); }
}
export interface BriefEvidence {
  id: string;
  sourceKey: string;
  itemId: string;
  observedAt: string;
  text: string;
  digest: string;
  metadata: Record<string, unknown>;
}
export interface BriefEvidenceChange {
  itemId: string; generation: string;
  evidence: { observedAt: string; text: string; metadata: Record<string, unknown> } | null;
}
export interface BriefAcquisitionContext {
  /** Reserve BEFORE dispatch. Each request permits at most 2 MiB; retries share 32 reservations. */
  reserveRequest(): void;
  state(sourceKey: string): unknown | null;
  checkpoint(sourceKey: string, state: unknown, change?: BriefEvidenceChange | BriefEvidenceChange[]): void;
  /** Bounded latest records in this bootstrap generation, not older accounts or reset snapshots. */
  evidence(sourceKey: string, generation: string, offset?: number): BriefEvidence[];
}
const digest = (text: string, metadata: Record<string, unknown>) => createHash("sha256").update(JSON.stringify({ text, metadata })).digest("hex");
function decode(row: Record<string, unknown>): BriefEvidence {
  const evidence = {
    id: String(row.id), sourceKey: String(row.source_key), itemId: String(row.item_id),
    observedAt: String(row.observed_at), text: String(row.text), digest: String(row.digest),
    metadata: JSON.parse(row.metadata as string) as Record<string, unknown>,
  };
  if (digest(evidence.text, evidence.metadata) !== evidence.digest) throw new Error("Brief evidence integrity check failed");
  return evidence;
}
export function createBriefAcquisitionContext(runId: string, source: BriefSource, commit: <T>(action: (db: DatabaseSync) => T) => T, now = Date.now, requestLimit = BRIEF_REQUEST_LIMIT): BriefAcquisitionContext {
  const persist = <T>(action: (db: DatabaseSync) => T): T => {
    try { return commit(action); }
    catch (error) { if (error instanceof BriefBudgetExhausted) throw error; throw new BriefAcquisitionStorageError(error); }
  };
  const key = (value: string) => {
    if (!value.startsWith(`${source}:`) || !/^[a-zA-Z0-9:_-]{1,200}$/.test(value)) throw new Error("Invalid Brief source key");
  };
  return {
    reserveRequest() {
      persist(db => {
        const used = Number(db.prepare("SELECT requests FROM brief_budgets WHERE run_id = ?").get(runId)?.requests ?? 0);
        if (used >= requestLimit) throw new BriefBudgetExhausted();
        db.prepare("INSERT INTO brief_budgets VALUES(?, 1) ON CONFLICT(run_id) DO UPDATE SET requests = requests + 1").run(runId);
      });
    },
    state(sourceKey) {
      key(sourceKey);
      return persist(db => {
        const row = db.prepare("SELECT payload FROM brief_source_state WHERE source_key = ?").get(sourceKey);
        return row ? JSON.parse(row.payload as string) : null;
      });
    },
    checkpoint(sourceKey, state, change) {
      key(sourceKey);
      const payload = JSON.stringify(state);
      if (!payload || payload.length > 512_000) throw new Error("Invalid Brief checkpoint size");
      const changes = change ? (Array.isArray(change) ? change : [change]) : [];
      for (const item of changes) {
        if (!/^[a-zA-Z0-9_-]{1,128}$/.test(item.itemId) || !/^[a-zA-Z0-9_-]{1,128}$/.test(item.generation)) throw new Error("Invalid Brief record identity");
        if (item.evidence && (item.evidence.text.length > 30_000 || !Number.isFinite(Date.parse(item.evidence.observedAt)) || JSON.stringify(item.evidence.metadata).length > 30_000)) throw new Error("Invalid Brief evidence size or date");
      }
      persist(db => {
        for (const change of changes) {
          let evidenceId: string | null = null;
          if (change.evidence) {
            const e = change.evidence, hash = digest(e.text, e.metadata);
            evidenceId = `${sourceKey}:${change.itemId}:${hash}`;
            db.prepare("INSERT OR IGNORE INTO brief_evidence VALUES(?, ?, ?, ?, ?, ?, ?)").run(evidenceId, sourceKey, change.itemId, e.observedAt, e.text, hash, JSON.stringify(e.metadata));
          }
          db.prepare("INSERT INTO brief_source_items VALUES(?, ?, ?, ?) ON CONFLICT(source_key, item_id) DO UPDATE SET generation = excluded.generation, evidence_id = excluded.evidence_id").run(sourceKey, change.itemId, change.generation, evidenceId);
        }
        // The remaining queue and the saved observation (or deletion) always move together.
        db.prepare("INSERT INTO brief_source_state VALUES(?, ?) ON CONFLICT(source_key) DO UPDATE SET payload = excluded.payload").run(sourceKey, payload);
        db.prepare("INSERT INTO brief_steps(run_id, stage, at, outcome) VALUES(?, ?, ?, ?)").run(runId, `acquire:${source}`, new Date(now()).toISOString(), changes.length ? (changes.some(c => c.evidence) ? "evidence-saved" : "record-removed") : "cursor-saved");
      });
    },
    evidence(sourceKey, generation, offset = 0) {
      key(sourceKey);
      return persist(db => db.prepare(`SELECT e.* FROM brief_source_items i JOIN brief_evidence e ON e.id = i.evidence_id
        WHERE i.source_key = ? AND i.generation = ? ORDER BY json_extract(e.metadata, '$.date') DESC, e.id LIMIT 101 OFFSET ?`).all(sourceKey, generation, offset).map(decode));
    },
  };
}

/** Provenance is not truth verification: require the exact saved passage, never a generated quote. */
export function verifyAcquiredBriefEvidence(db: DatabaseSync, input: BriefInput): void {
  for (const item of input.items) {
    if (item.evidence.kind !== "mail-message" && item.evidence.kind !== "public-feed" && item.evidence.kind !== "public-search") continue;
    const row = db.prepare("SELECT * FROM brief_evidence WHERE id = ?").get(item.evidence.reference);
    if (!row) throw new Error("Brief item cites missing evidence");
    const e = decode(row);
    const identity = item.evidence.kind === "mail-message"
      ? input.source === "mail" && e.sourceKey.startsWith("mail:") && item.id === `mail:${e.id}` && item.title === e.metadata.subject
      : input.source === "world" && e.sourceKey.startsWith(item.evidence.kind === "public-feed" ? "world:feed-v1:" : "world:search-v1:")
        && item.id === `world:${e.id}` && item.title === e.metadata.title && item.publishedOn === e.metadata.date
        && (item.evidence.kind === "public-feed" ? item.topic === undefined : item.topic === e.metadata.topic
          && item.evidence.dateQuote === e.metadata.dateQuote && e.text.includes(item.evidence.dateQuote ?? "\u0000")
          && Number.isFinite(Date.parse(`${item.evidence.dateQuote} UTC`))
          && new Date(Date.parse(`${item.evidence.dateQuote} UTC`)).toISOString().slice(0, 10) === item.publishedOn);
    if (!identity || item.href !== e.metadata.href || !e.text.includes(item.summary)
      || item.evidence.checkedAt !== e.observedAt || !item.evidence.quote || !e.text.includes(item.evidence.quote)) throw new Error("Brief item does not match its saved evidence");
  }
}
