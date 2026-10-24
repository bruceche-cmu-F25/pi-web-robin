import {
  MAX_ATTACHED_IMAGES,
  isBase64ImageWithinLimits,
} from "./image-attachments";

export interface ChatDraftImage {
  data: string;
  mimeType: string;
}

export interface ChatDraft {
  value: string;
  images: ChatDraftImage[];
}

const drafts = new Map<string, ChatDraft>();
const STORAGE_PREFIX = "pi-web:chat-draft:";

// Persist text per tab across native navigation/reloads. Images stay in memory:
// serializing multi-MB attachments on every keystroke would exhaust Web Storage.
function readStoredText(key: string): string {
  try {
    return typeof window === "undefined" ? "" : window.sessionStorage.getItem(STORAGE_PREFIX + key) ?? "";
  } catch {
    return "";
  }
}

function writeStoredText(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    if (value) window.sessionStorage.setItem(STORAGE_PREFIX + key, value);
    else window.sessionStorage.removeItem(STORAGE_PREFIX + key);
  } catch {
    // Keep the live draft usable if storage is blocked/full; don't restore an
    // older persisted value after a failed update if removal is still allowed.
    try { window.sessionStorage.removeItem(STORAGE_PREFIX + key); } catch { /* unavailable */ }
  }
}

function cloneDraft(draft: ChatDraft): ChatDraft {
  return {
    value: draft.value,
    images: draft.images.map((image) => ({ ...image })),
  };
}

function isEmptyDraft(draft: ChatDraft): boolean {
  return !draft.value && draft.images.length === 0;
}

export function getDraft(key: string): ChatDraft | null {
  const draft = drafts.get(key);
  if (draft) return cloneDraft(draft);
  const value = readStoredText(key);
  return value ? { value, images: [] } : null;
}

export function setDraft(key: string, draft: ChatDraft): void {
  if (isEmptyDraft(draft)) {
    clearDraft(key);
    return;
  }
  drafts.set(key, cloneDraft(draft));
  writeStoredText(key, draft.value);
}

export function clearDraft(key: string): void {
  drafts.delete(key);
  writeStoredText(key, "");
}

export function mergeRestoredSubmissionText(submitted: string, current: string): string {
  if (!submitted.trim()) return current;
  if (!current.trim()) return submitted;
  return `${submitted}\n\n${current}`;
}

export function mergeRestoredSubmissionDraft(
  submittedText: string,
  submittedImages: ChatDraftImage[] | undefined,
  currentText: string,
  currentImages: ChatDraftImage[],
): ChatDraft {
  const images = [...(submittedImages ?? []), ...currentImages]
    .filter(isBase64ImageWithinLimits)
    .slice(0, MAX_ATTACHED_IMAGES)
    .map(({ data, mimeType }) => ({ data, mimeType }));

  return {
    value: mergeRestoredSubmissionText(submittedText, currentText),
    images,
  };
}

export function restoreDraftSubmission(
  key: string,
  text: string,
  images?: ChatDraftImage[],
): ChatDraft {
  const current = getDraft(key) ?? { value: "", images: [] };
  const restored = mergeRestoredSubmissionDraft(
    text,
    images,
    current.value,
    current.images,
  );
  setDraft(key, restored);
  return restored;
}

export function rekeyDraft(
  previousKey: string,
  nextKey: string,
  currentDraft?: ChatDraft,
): ChatDraft | null {
  if (previousKey === nextKey) return currentDraft ? cloneDraft(currentDraft) : getDraft(nextKey);

  const storedPrevious = getDraft(previousKey);
  const previous = currentDraft && !isEmptyDraft(currentDraft)
    ? cloneDraft(currentDraft)
    : (storedPrevious ?? (currentDraft ? cloneDraft(currentDraft) : null));
  const next = getDraft(nextKey);
  clearDraft(previousKey);
  if (!previous) return next;

  const merged = next
    ? mergeRestoredSubmissionDraft(next.value, next.images, previous.value, previous.images)
    : previous;
  setDraft(nextKey, merged);
  return cloneDraft(merged);
}
