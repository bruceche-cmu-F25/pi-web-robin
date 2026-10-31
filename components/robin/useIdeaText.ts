"use client";

import { useEffect, useRef, useState } from "react";
import type { Idea } from "@/extension/robin/product-domain";
import type { SaveState } from "./SaveStatus";
import { clearTextRecovery, newRecoveryId, removeTextRecoveries, saveTextRecovery, type RecoveryReceipt } from "@/lib/text-recovery";

const NOTE_AUTOSAVE_MS = 1_000;
type Field = "name" | "note";
type TextPatch = { name: string } | { note: string };

/**
 * One mounted idea's text editor. The adapter adopts a confirmed idea receipt
 * before returning true; false/rejection retains the draft for explicit retry.
 * Key the caller by idea.id. Stage/bet/link writes do not pass through this queue.
 */
export function useIdeaText(idea: Pick<Idea, "id" | "name" | "note">, persist: (patch: TextPatch) => Promise<boolean>) {
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const pendingNote = useRef<string | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const textWrites = useRef<Promise<void>>(Promise.resolve());
  const noteVersion = useRef(0);
  const nameVersion = useRef(0);
  const [writer] = useState(newRecoveryId);
  const recoveryWrites = useRef<{ name?: RecoveryReceipt; note?: RecoveryReceipt }>({});
  const [backupFailures, setBackupFailures] = useState({ name: false, note: false });
  const [writing, setWriting] = useState(0);
  const [failedWrites, setFailedWrites] = useState<{ name?: number; note?: number }>({});
  const retrying = useRef(false);
  // Fence callbacks immediately, including a retry resuming after an await.
  const closed = useRef(false);
  const [removing, setRemoving] = useState(false);
  const dirty = nameDraft !== null || noteDraft !== null;
  const failed = (nameDraft !== null && failedWrites.name === nameVersion.current)
    || (noteDraft !== null && failedWrites.note === noteVersion.current);
  const state: SaveState = writing ? "saving" : failed ? "error" : dirty ? "dirty" : "saved";

  useEffect(() => {
    if (!dirty && !writing) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty, writing]);
  useEffect(() => () => { clearTimeout(noteTimer.current); }, []);

  const backup = (field: Field, value: string) => {
    const receipt = saveTextRecovery("product", idea.id, `${writer}:${field}`, { [field]: value }, recoveryWrites.current[field]);
    if (receipt) recoveryWrites.current[field] = receipt;
    setBackupFailures(previous => previous[field] === !receipt ? previous : { ...previous, [field]: !receipt });
    return Boolean(receipt);
  };

  const writeText = async (patch: TextPatch) => {
    const field = "name" in patch ? "name" : "note";
    const generation = field === "name" ? nameVersion : noteVersion;
    const version = generation.current;
    setWriting(count => count + 1);
    // Both fields share one queue; failure must not strand later edits.
    const write = textWrites.current.then(() => persist(patch)).catch(() => false);
    textWrites.current = write.then(() => undefined);
    try {
      const saved = await write;
      if (version === generation.current) setFailedWrites(previous => ({ ...previous, [field]: saved ? undefined : version }));
      return saved;
    } finally { setWriting(count => count - 1); }
  };

  const saveName = async () => {
    const sent = nameDraft?.trim();
    // Empty names stay unsaved; even the stored name may need to undo a queued edit.
    if (closed.current || nameDraft === null || !sent) return;
    const version = nameVersion.current;
    const recovery = recoveryWrites.current.name;
    if (await writeText({ name: sent })) {
      clearTextRecovery(recovery);
      if (version === nameVersion.current) {
        setNameDraft(null);
        setBackupFailures(previous => previous.name ? { ...previous, name: false } : previous);
      }
    }
  };

  const saveNote = async () => {
    clearTimeout(noteTimer.current);
    const sent = pendingNote.current;
    if (closed.current || sent === null) return;
    const version = noteVersion.current;
    const recovery = recoveryWrites.current.note;
    pendingNote.current = null;
    const saved = await writeText({ note: sent });
    if (saved) clearTextRecovery(recovery);
    if (version !== noteVersion.current) return;
    if (saved) {
      setNoteDraft(null);
      setBackupFailures(previous => previous.note ? { ...previous, note: false } : previous);
    } else pendingNote.current ??= sent;
  };

  const edit = (field: Field, value: string) => {
    if (closed.current) return false;
    const backedUp = backup(field, value);
    if (field === "name") {
      nameVersion.current += 1;
      setNameDraft(value);
    } else {
      noteVersion.current += 1;
      pendingNote.current = value;
      setNoteDraft(value);
      clearTimeout(noteTimer.current);
      noteTimer.current = setTimeout(() => void saveNote(), NOTE_AUTOSAVE_MS);
    }
    return backedUp;
  };

  const retry = async () => {
    if (closed.current || retrying.current) return;
    retrying.current = true;
    try { await saveName(); await saveNote(); }
    finally { retrying.current = false; }
  };

  const discardName = () => {
    if (closed.current) return;
    nameVersion.current += 1;
    setNameDraft(null);
    clearTextRecovery(recoveryWrites.current.name);
  };

  /** Call only after user confirmation. No text callback may enqueue past DELETE. */
  const remove = async (destroy: () => Promise<boolean>) => {
    if (closed.current) return false;
    closed.current = true;
    setRemoving(true);
    clearTimeout(noteTimer.current);
    pendingNote.current = null;
    noteVersion.current += 1;
    nameVersion.current += 1;
    let removed = false;
    try {
      await textWrites.current;
      removed = await destroy();
      if (removed) {
        removeTextRecoveries("product", idea.id);
        setNameDraft(null);
        setNoteDraft(null);
      }
      return removed;
    } finally {
      if (!removed) {
        closed.current = false;
        pendingNote.current = noteDraft;
      }
      setRemoving(false);
    }
  };

  return {
    name: nameDraft ?? idea.name,
    note: noteDraft ?? idea.note,
    state, removing, writer,
    backupFailed: backupFailures.name || backupFailures.note,
    edit,
    save: (field: Field) => field === "name" ? saveName() : saveNote(),
    retry, discardName, remove,
  };
}
