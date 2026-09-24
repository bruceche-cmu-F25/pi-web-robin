const STORAGE_KEY = "pi-thinking-expanded";

// Broadcast so already-mounted ThinkingBlock instances update when the
// preference changes in the settings panel.
export const THINKING_EXPANDED_EVENT = "pi-thinking-expanded-changed";

// Read during ThinkingBlock render, so storage that throws (Safari private
// mode, blocked site data) must fall back to collapsed rather than break chat.
export function isThinkingExpandedByDefault(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function setThinkingExpandedByDefault(expanded: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(expanded));
  } catch {
    // Not persisted; listeners re-read and keep the collapsed default.
  }
  window.dispatchEvent(new Event(THINKING_EXPANDED_EVENT));
}
