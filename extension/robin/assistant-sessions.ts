/**
 * Which pi session each assistant mode is talking to.
 *
 * Remembered across server restarts so a conversation survives one, and
 * separated by mode because they are different conversations: the coach and
 * the mentor are asked opposite questions, and the scoring turn must not
 * inherit whatever the dashboard was just discussing.
 *
 * Moved out of the store because it is behaviour, not file access — the route
 * that offers "start a new conversation" should not have to reach into the
 * JSON layer to find it.
 */
import { dataPath, readJsonObject, writeJsonObject } from "./paths.ts";

const ASSISTANT_FILE = "assistant.json";

export function assistantStatePath(): string {
  return dataPath(ASSISTANT_FILE);
}

/**
 * The pi session the dashboard assistant talks to, remembered across server
 * restarts so the conversation keeps its context ("move it to Thursday").
 */
interface AssistantState {
  sessionId?: string;
  dailyAgendaSessionId?: string;
  /**
   * Kept apart from the conversational session on purpose: the scoring turn
   * reads employer-authored job descriptions, and anything a posting tries to
   * talk the model into must not survive into the session you chat with later.
   */
  jobScorerSessionId?: string;
  /**
   * Same isolation for the mail review: email is untrusted third-party text,
   * so the turn that reads it and writes todos/events runs in its own session.
   */
  mailReviewSessionId?: string;
  /**
   * The coding coach's own conversation, kept apart from the dashboard
   * assistant for the plain reason that it is a different conversation: weeks
   * of "why is this O(n log n)" should not dilute the context you ask about
   * rent and calendars in, and either one must be restartable without taking
   * the other with it.
   */
  coachSessionId?: string;
  /**
   * The curriculum mentor's conversation.
   *
   * Apart from the coach for the same reason the coach is apart from the
   * assistant, and one more: the two are asked opposite questions. The coach
   * must withhold answers to keep a problem worth solving; the mentor is being
   * asked to explain, and explaining fully is the whole job. Sharing a session
   * would leave one persona reading the other's instructions.
   */
  mentorSessionId?: string;
  updatedAt?: string;
}

function readAssistantState(): AssistantState {
  return readJsonObject<AssistantState>(ASSISTANT_FILE) ?? {};
}

function writeAssistantState(patch: Partial<AssistantState>): void {
  writeJsonObject(ASSISTANT_FILE, {
    ...readAssistantState(),
    ...patch,
    updatedAt: new Date().toISOString(),
  });
}

export function readAssistantSessionId(): string | null {
  return readAssistantState().sessionId ?? null;
}

export function writeAssistantSessionId(sessionId: string): void {
  writeAssistantState({ sessionId });
}

export function readDailyAgendaSessionId(): string | null {
  return readAssistantState().dailyAgendaSessionId ?? null;
}

export function writeDailyAgendaSessionId(dailyAgendaSessionId: string): void {
  writeAssistantState({ dailyAgendaSessionId });
}

export function readJobScorerSessionId(): string | null {
  return readAssistantState().jobScorerSessionId ?? null;
}

export function writeJobScorerSessionId(jobScorerSessionId: string): void {
  writeAssistantState({ jobScorerSessionId });
}

export function readMailReviewSessionId(): string | null {
  return readAssistantState().mailReviewSessionId ?? null;
}

export function writeMailReviewSessionId(mailReviewSessionId: string): void {
  writeAssistantState({ mailReviewSessionId });
}

export function readCoachSessionId(): string | null {
  return readAssistantState().coachSessionId ?? null;
}

export function writeCoachSessionId(coachSessionId: string): void {
  writeAssistantState({ coachSessionId });
}

export function readMentorSessionId(): string | null {
  return readAssistantState().mentorSessionId ?? null;
}

export function writeMentorSessionId(mentorSessionId: string): void {
  writeAssistantState({ mentorSessionId });
}

/** The assistant sessions a caller may ask to start over. */
export const ASSISTANT_SESSION_KINDS = ["default", "readOnly", "scoring", "mail", "coach", "mentor"] as const;

export type AssistantSessionKind = (typeof ASSISTANT_SESSION_KINDS)[number];

const SESSION_FIELDS: Record<AssistantSessionKind, keyof AssistantState> = {
  default: "sessionId",
  readOnly: "dailyAgendaSessionId",
  scoring: "jobScorerSessionId",
  mail: "mailReviewSessionId",
  coach: "coachSessionId",
  mentor: "mentorSessionId",
};

/**
 * Forget a remembered session id, so the next turn of that mode starts fresh.
 *
 * The session file itself is left alone: this is "start a new conversation",
 * not "delete the old one", and the transcript is still worth having. What it
 * buys is a way out of a context that has drifted or grown expensive without
 * reaching for the filesystem from a chat message.
 */
export function clearAssistantSession(kind: AssistantSessionKind): boolean {
  const field = SESSION_FIELDS[kind];
  const state = readAssistantState();
  if (state[field] === undefined) return false;
  const { [field]: _dropped, ...rest } = state;
  void _dropped;
  writeJsonObject(ASSISTANT_FILE, { ...rest, updatedAt: new Date().toISOString() });
  return true;
}
