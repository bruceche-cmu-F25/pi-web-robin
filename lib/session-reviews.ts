import type { SessionEntry, SessionInfo } from "./types";
import { sessionDisplayTitle } from "./session-fork-name";

/** One latest completed reply per chat. Reading a chat is not acceptance. */
export interface SessionReview {
  entryId: string;
  completedAt: number;
  reviewed?: boolean;
}
export interface SessionReviewItem extends SessionReview {
  id: string;
  title: string;
  cwd: string;
}
export interface SessionReviewsResponse { reviews: SessionReviewItem[] }

/** Only a finished answer, never a failed/stopped/truncated/tool-only turn. */
export function completedReplyId(branch: readonly SessionEntry[]): string | null {
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type !== "message") continue;
    const message = entry.message;
    if (message.role === "custom" || message.role === "system") continue;
    if (message.role !== "assistant" || message.stopReason !== "stop") return null;
    return message.content.some(block => block.type === "image" || (block.type === "text" && block.text.trim())) ? entry.id : null;
  }
  return null;
}

export function pendingSessionReviews(
  reviews: Readonly<Record<string, SessionReview>>,
  sessions: readonly SessionInfo[],
  running: ReadonlySet<string>,
): SessionReviewItem[] {
  return sessions.flatMap(session => {
    const review = reviews[session.id];
    if (!review || review.reviewed || running.has(session.id) || session.relation?.kind === "subagent") return [];
    return [{ ...review, id: session.id, title: sessionDisplayTitle(session), cwd: session.cwd }];
  }).sort((a, b) => b.completedAt - a.completedAt || a.id.localeCompare(b.id));
}
