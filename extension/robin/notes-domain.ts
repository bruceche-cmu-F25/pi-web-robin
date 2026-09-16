import { newId, readJsonArray, updateJsonArray } from "./paths.ts";

const FILE = "note-drafts.json";

export interface NoteDraft {
  id: string;
  title: string;
  text: string;
  notionParentId: string;
  createdAt: string;
  updatedAt: string;
}

export function readNoteDrafts(): NoteDraft[] {
  return readJsonArray<NoteDraft>(FILE)
    .filter((draft) => draft && typeof draft.id === "string")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function createNoteDraft(input: { title: string; text?: string; notionParentId?: string }): NoteDraft {
  const now = new Date().toISOString();
  const draft: NoteDraft = {
    id: newId(),
    title: input.title,
    text: input.text ?? "",
    notionParentId: input.notionParentId ?? "",
    createdAt: now,
    updatedAt: now,
  };
  updateJsonArray<NoteDraft, void>(FILE, (drafts) => {
    drafts.push(draft);
    return { value: undefined, changed: true };
  });
  return draft;
}

export function updateNoteDraft(
  id: string,
  patch: Partial<Pick<NoteDraft, "title" | "text" | "notionParentId">>,
): NoteDraft | null {
  return updateJsonArray<NoteDraft, NoteDraft | null>(FILE, (drafts) => {
    const index = drafts.findIndex((draft) => draft.id === id);
    if (index < 0) return { value: null, changed: false };
    const updated = { ...drafts[index], ...patch, updatedAt: new Date().toISOString() };
    drafts[index] = updated;
    return { value: updated, changed: true };
  });
}

export function deleteNoteDraft(id: string): boolean {
  return updateJsonArray<NoteDraft, boolean>(FILE, (drafts) => {
    const index = drafts.findIndex((draft) => draft.id === id);
    if (index < 0) return { value: false, changed: false };
    drafts.splice(index, 1);
    return { value: true, changed: true };
  });
}
