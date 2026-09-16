import { readJsonObject, updateJsonObject } from "./paths.ts";

interface NotesAgentState {
  sessions?: Record<string, string>;
  updatedAt?: string;
}

const FILE = "note-agents.json";

function readState(): NotesAgentState {
  return readJsonObject<NotesAgentState>(FILE) ?? {};
}

export function readNotesAgentSessionIds(): string[] {
  return Object.values(readState().sessions ?? {});
}

export function readNotesAgentSessionId(draftId: string): string | null {
  return readState().sessions?.[draftId] ?? null;
}

export function writeNotesAgentSessionId(draftId: string, sessionId: string): void {
  updateJsonObject<NotesAgentState, void>(FILE, (current) => {
    const state = current ?? {};
    return {
      result: undefined,
      value: { ...state, sessions: { ...state.sessions, [draftId]: sessionId }, updatedAt: new Date().toISOString() },
      changed: true,
    };
  });
}

export function clearNotesAgentSession(draftId: string): boolean {
  return updateJsonObject<NotesAgentState, boolean>(FILE, (current) => {
    const state = current ?? {};
    if (!state.sessions?.[draftId]) return { result: false, value: state, changed: false };
    const sessions = { ...state.sessions };
    delete sessions[draftId];
    return { result: true, value: { ...state, sessions, updatedAt: new Date().toISOString() }, changed: true };
  });
}

/**
 * The result of "Prepare for Notion", kept on the server so the page can be
 * left while it runs and still find the finished note when it comes back.
 */
export interface NoteFinal {
  status: "running" | "ready" | "error";
  startedAt: string;
  finishedAt?: string;
  title?: string;
  content?: string;
  error?: string;
}

const FINALS_FILE = "note-finals.json";

export function readNoteFinals(): Record<string, NoteFinal> {
  return readJsonObject<Record<string, NoteFinal>>(FINALS_FILE) ?? {};
}

export function writeNoteFinal(draftId: string, final: NoteFinal): void {
  updateJsonObject<Record<string, NoteFinal>, void>(FINALS_FILE, (current) => ({
    result: undefined,
    value: { ...current, [draftId]: final },
    changed: true,
  }));
}

export function clearNoteFinal(draftId: string): boolean {
  return updateJsonObject<Record<string, NoteFinal>, boolean>(FINALS_FILE, (current) => {
    if (!current?.[draftId]) return { result: false, value: current ?? {}, changed: false };
    const next = { ...current };
    delete next[draftId];
    return { result: true, value: next, changed: true };
  });
}
