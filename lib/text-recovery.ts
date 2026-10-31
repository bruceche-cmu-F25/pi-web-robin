/** Browser-only recovery copies of unsaved editor text. No requests or automatic replay. */
export type RecoveryScope = "notes" | "product" | "resume";
export interface RecoveryReceipt { key: string; value: string }
export interface TextRecovery extends RecoveryReceipt { savedAt: string; fields: Record<string, string> }
const PREFIX = "pi-web:text-recovery:v1:";
// Bound synchronous storage work; never truncate text or evict another draft to fit.
const MAX_CHARS = 256_000;
const fieldsFor = { notes: ["title", "text", "notionParentId"], product: ["name", "note"], resume: ["source"] };
// getRandomValues also works on HTTP LAN origins; randomUUID requires HTTPS.
export function newRecoveryId(): string {
  return Array.from(crypto.getRandomValues(new Uint32Array(4)), (part) => part.toString(16).padStart(8, "0")).join("");
}
const prefix = (scope: RecoveryScope, id: string) => `${PREFIX}${scope}:${encodeURIComponent(id)}:`;

export function saveTextRecovery(scope: RecoveryScope, id: string, writer: string, fields: Record<string, string>, previous?: RecoveryReceipt): RecoveryReceipt | null {
  try {
    if (Object.values(fields).reduce((length, text) => length + text.length, 0) > MAX_CHARS) return null;
    const revision = newRecoveryId();
    const value = JSON.stringify({ version: 1, revision, savedAt: new Date().toISOString(), fields });
    if (value.length > MAX_CHARS) return null;
    // Immutable keys: another tab discarding the displayed copy cannot delete
    // a keystroke written between its getItem and removeItem (storage has no CAS).
    const key = `${prefix(scope, id)}${writer}:${revision}`;
    window.localStorage.setItem(key, value);
    clearTextRecovery(previous); // Only after the replacement exists; never evict to fit.
    return { key, value };
  } catch { return null; } // Live editing remains usable; the caller must show a warning.
}

export function readTextRecoveries(scope: RecoveryScope, id: string, writer: string): { drafts: TextRecovery[]; unavailable: boolean } {
  const drafts: TextRecovery[] = [];
  let unavailable = false;
  try {
    const storage = window.localStorage, start = prefix(scope, id);
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key?.startsWith(start) || key.startsWith(start + writer + ":")) continue;
      try {
        const value = storage.getItem(key);
        if (!value || value.length > MAX_CHARS) throw new Error("Invalid recovery");
        const entry = JSON.parse(value);
        if (entry?.version !== 1 || typeof entry.revision !== "string" || typeof entry.savedAt !== "string"
          || !Number.isFinite(Date.parse(entry.savedAt)) || !entry.fields || Array.isArray(entry.fields)) throw new Error("Invalid recovery");
        const pairs = Object.entries(entry.fields);
        if (!pairs.length || pairs.some(([field, text]) => !fieldsFor[scope].includes(field) || typeof text !== "string")) throw new Error("Invalid recovery");
        drafts.push({ key, value, savedAt: entry.savedAt, fields: Object.fromEntries(pairs) as Record<string, string> });
      } catch { unavailable = true; } // Keep malformed/unknown data intact, never apply it.
    }
  } catch { unavailable = true; }
  return { drafts: drafts.sort((a, b) => b.savedAt.localeCompare(a.savedAt)), unavailable };
}

/** A late acknowledgement cannot delete a newer edit (including A → B → A). */
export function clearTextRecovery(receipt: RecoveryReceipt | null | undefined): boolean {
  if (!receipt) return true;
  try {
    if (window.localStorage.getItem(receipt.key) !== receipt.value) return false;
    window.localStorage.removeItem(receipt.key);
    return true;
  } catch { return false; }
}

/** Called only after the user-confirmed server deletion/archive succeeds. */
export function removeTextRecoveries(scope: RecoveryScope, id: string): void {
  try {
    const storage = window.localStorage, start = prefix(scope, id);
    for (let i = storage.length - 1; i >= 0; i--) {
      const key = storage.key(i);
      if (key?.startsWith(start)) storage.removeItem(key);
    }
  } catch { /* Unavailable storage does not undo an acknowledged server operation. */ }
}
