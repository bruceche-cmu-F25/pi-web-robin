"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { NoteDraft } from "@/extension/robin/notes-domain";
import type { SaveState } from "./SaveStatus";
import { clearTextRecovery, newRecoveryId, removeTextRecoveries, saveTextRecovery, type RecoveryReceipt } from "@/lib/text-recovery";

export type DraftPatch = Partial<Pick<NoteDraft, "title" | "text" | "notionParentId">>;
const SAVE_DELAY_MS = 400;
// A browser's keepalive budget is 64 KiB; measure the serialized UTF-8 body.
const KEEPALIVE_MAX_BYTES = 60_000;
interface DraftWrites {
  dirty: NoteDraft | null;
  pending: NoteDraft | null;
  writes: number;
  timer?: number;
  error: string | null;
  backupFailed: boolean;
  saved: boolean;
  removing: boolean;
}

/**
 * This workspace's drafts and text-write lifetime. Loading/creation, navigation,
 * confirmation and archive destinations remain with the caller. Install loaded or
 * newly created drafts with replaceDrafts; all text changes go through patchDraft.
 * Removal drains accepted writes and fences edits/retries through its receipt.
 */
export function useNoteDrafts(unsavedMessage: string) {
  const [drafts, setDrafts] = useState<NoteDraft[]>([]);
  const draftsRef = useRef<NoteDraft[]>([]);
  const entries = useRef(new Map<string, DraftWrites>());
  const recoveryWrites = useRef(new WeakMap<NoteDraft, RecoveryReceipt>());
  const queue = useRef<Promise<void>>(Promise.resolve());
  const [recoveryWriter] = useState(newRecoveryId);
  const [, render] = useState(0);
  const notify = useCallback(() => render(version => version + 1), []);
  const getDrafts = useCallback(() => draftsRef.current, []);
  const replaceDrafts = useCallback((value: NoteDraft[] | ((current: NoteDraft[]) => NoteDraft[])) => {
    const next = typeof value === "function" ? value(draftsRef.current) : value;
    draftsRef.current = next;
    setDrafts(next);
  }, []);

  const writeDraft = useCallback((id: string, keepalive = false, allowRemoving = false): Promise<void> => {
    const entry = entries.current.get(id);
    if (!entry || (entry.removing && !allowRemoving)) return queue.current;
    window.clearTimeout(entry.timer);
    entry.timer = undefined;
    const draft = entry.pending;
    if (!draft) return queue.current;
    entry.pending = null;
    entry.writes += 1;
    notify();
    const recovery = recoveryWrites.current.get(draft);
    const body = JSON.stringify({ id, title: draft.title, text: draft.text, notionParentId: draft.notionParentId });
    queue.current = queue.current.then(async () => {
      try {
        const response = await fetch("/api/robin/notes", {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body,
          keepalive: keepalive && new TextEncoder().encode(body).length <= KEEPALIVE_MAX_BYTES,
        });
        if (!response.ok) {
          const result = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(result?.error ?? `Could not save draft (${response.status})`);
        }
        clearTextRecovery(recovery);
        entry.saved = true;
        if (entry.dirty === draft) {
          entry.dirty = null;
          entry.error = null;
          entry.backupFailed = false;
        }
      } catch (caught) {
        // Identity distinguishes A → B → A and newer edits already in the queue.
        if (entry.dirty === draft) {
          if (!entry.removing) entry.pending = draft;
          entry.error = caught instanceof Error ? caught.message : String(caught);
        }
      } finally {
        entry.writes -= 1;
        notify();
      }
    });
    return queue.current;
  }, [notify]);

  /** Flush one note or the workspace; false means some requested text is unconfirmed. */
  const flushSaves = useCallback(async (id?: string, keepalive = false): Promise<boolean> => {
    for (const key of id === undefined ? [...entries.current.keys()] : [id]) void writeDraft(key, keepalive);
    await queue.current;
    return id === undefined ? [...entries.current.values()].every(entry => !entry.dirty)
      : !entries.current.get(id)?.dirty;
  }, [writeDraft]);

  useEffect(() => {
    const flush = () => { void flushSaves(undefined, true); };
    const onVisibility = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
    };
  }, [flushSaves]);

  const patchDraft = useCallback((id: string, patch: DraftPatch) => {
    const current = draftsRef.current.find(draft => draft.id === id);
    if (!current || entries.current.get(id)?.removing) return false;
    const entry = entries.current.get(id) ?? {
      dirty: null, pending: null, writes: 0, error: null, backupFailed: false, saved: false, removing: false,
    };
    entries.current.set(id, entry);
    const updated = { ...current, ...patch, updatedAt: new Date().toISOString() };
    const previous = recoveryWrites.current.get(current);
    const receipt = saveTextRecovery("notes", id, `${recoveryWriter}:text`, {
      title: updated.title, text: updated.text, notionParentId: updated.notionParentId ?? "",
    }, previous);
    if (receipt || previous) recoveryWrites.current.set(updated, (receipt ?? previous)!);
    entry.backupFailed = !receipt;
    entry.dirty = entry.pending = updated;
    entry.error = null;
    window.clearTimeout(entry.timer);
    entry.timer = window.setTimeout(() => { void writeDraft(id); }, SAVE_DELAY_MS);
    replaceDrafts(items => items.map(draft => draft.id === id ? updated : draft));
    return Boolean(receipt);
  }, [replaceDrafts, recoveryWriter, writeDraft]);

  const retire = useCallback(async <T,>(id: string, saveFirst: boolean, operation: () => Promise<T>): Promise<T | null> => {
    if (!draftsRef.current.some(draft => draft.id === id) || entries.current.get(id)?.removing) return null;
    const entry = entries.current.get(id) ?? {
      dirty: null, pending: null, writes: 0, error: null, backupFailed: false, saved: false, removing: false,
    };
    entries.current.set(id, entry);
    entry.removing = true;
    window.clearTimeout(entry.timer);
    entry.timer = undefined;
    notify();
    let removed = false;
    try {
      if (saveFirst) {
        await writeDraft(id, false, true);
        if (entry.dirty) throw new Error(unsavedMessage);
      } else {
        entry.pending = null;
        await queue.current;
      }
      const result = await operation();
      removed = true;
      removeTextRecoveries("notes", id);
      entries.current.delete(id);
      replaceDrafts(items => items.filter(draft => draft.id !== id));
      return result;
    } finally {
      if (!removed) {
        // A rejected DELETE/archive must not strand the live text without a retry.
        entry.pending = entry.dirty;
        entry.removing = false;
      }
      notify();
    }
  }, [notify, replaceDrafts, writeDraft, unsavedMessage]);

  /** Caller confirms first. Failed requests throw without discarding the draft or backup. */
  const deleteDraft = useCallback((id: string) => retire(id, false, async () => {
    const response = await fetch("/api/robin/notes", {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(body?.error ?? `Request failed (${response.status})`);
    }
    return true;
  }), [retire]);

  /** The confirmed destination adapter returns its receipt, or throws on failure. */
  const archiveDraft = useCallback(<T,>(id: string, publish: () => Promise<T>) => retire(id, true, publish), [retire]);

  const status = (id: string) => {
    const entry = entries.current.get(id);
    const state: SaveState = entry?.writes ? "saving" : entry?.dirty ? entry.error ? "error" : "dirty" : entry?.saved ? "saved" : "idle";
    return { state, error: entry?.error ?? null, backupFailed: entry?.backupFailed ?? false };
  };

  return { drafts, replaceDrafts, getDrafts, patchDraft, flushSaves, deleteDraft, archiveDraft, status, recoveryWriter,
    removing: [...entries.current.values()].some(entry => entry.removing) };
}
