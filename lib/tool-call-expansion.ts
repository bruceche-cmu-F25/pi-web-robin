/**
 * Remembers which tool-call cards the user has expanded, keyed by toolCallId.
 *
 * A streaming assistant message is rendered from `streamState`, then re-rendered
 * from `messages` after `message_end`, and re-keyed again once `entryIds` arrive
 * from the session file. Each of those hops remounts `ToolCallBlock`, so plain
 * component state would collapse a card the user just opened. Keeping the set
 * outside React lets the remounted card start expanded without threading state
 * through every message component.
 */
// Keyed by session as well: providers that number calls per response
// (`call_0`, `call_1`) reuse ids across sessions.
const expandedToolCalls = new Set<string>();

// Insertion-ordered, so the oldest entries go first once a long-lived tab
// has opened this many cards.
const MAX_EXPANDED_TOOL_CALLS = 500;

function expansionKey(sessionId: string | undefined, toolCallId: string): string {
  return `${sessionId ?? ""}\u0000${toolCallId}`;
}

export function isToolCallExpanded(sessionId: string | undefined, toolCallId: string | undefined): boolean {
  return toolCallId !== undefined && expandedToolCalls.has(expansionKey(sessionId, toolCallId));
}

export function setToolCallExpanded(sessionId: string | undefined, toolCallId: string | undefined, expanded: boolean): void {
  if (!toolCallId) return;
  const key = expansionKey(sessionId, toolCallId);
  expandedToolCalls.delete(key);
  if (!expanded) return;
  expandedToolCalls.add(key);
  for (const oldest of expandedToolCalls) {
    if (expandedToolCalls.size <= MAX_EXPANDED_TOOL_CALLS) break;
    expandedToolCalls.delete(oldest);
  }
}

export function clearExpandedToolCalls(): void {
  expandedToolCalls.clear();
}
