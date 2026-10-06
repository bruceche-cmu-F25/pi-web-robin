export const JARVIS_STATE_API = "/api/robin/jarvis";
export const JARVIS_RESEARCH_API = "/api/robin/jarvis/research";
export const JARVIS_OUTREACH_API = "/api/robin/jarvis/outreach";
export const JARVIS_PREFERENCES_API = "/api/robin/jarvis/preferences";
export const JARVIS_REPORT_API = "/api/robin/jarvis/report";

export const JARVIS_RESEARCH_ACTIONS = ["discover", "stop", "rescore", "stop-rescore", "website-enrich", "stop-website-enrich"] as const;
export const JARVIS_OUTREACH_ACTIONS = ["send", "plan-channel", "review-queue", "approve-for-send", "prepare-batch", "queue", "revert-outreach-change", "linkedin-connection", "social", "unqueue", "sync"] as const;
export const JARVIS_PREFERENCE_ACTIONS = ["daily", "outbox", "social-template", "follow-up-template", "template"] as const;

export type JarvisResearchAction = typeof JARVIS_RESEARCH_ACTIONS[number];
export type JarvisOutreachAction = typeof JARVIS_OUTREACH_ACTIONS[number];
export type JarvisPreferenceAction = typeof JARVIS_PREFERENCE_ACTIONS[number];
export type JarvisAction = JarvisResearchAction | JarvisOutreachAction | JarvisPreferenceAction;

const researchActions = new Set<string>(JARVIS_RESEARCH_ACTIONS);
const outreachActions = new Set<string>(JARVIS_OUTREACH_ACTIONS);
const preferenceActions = new Set<string>(JARVIS_PREFERENCE_ACTIONS);

/** Maps a command to the narrow HTTP adapter that owns its side effects. */
export function jarvisActionApi(action: string): string {
  if (researchActions.has(action)) return JARVIS_RESEARCH_API;
  if (outreachActions.has(action)) return JARVIS_OUTREACH_API;
  if (preferenceActions.has(action)) return JARVIS_PREFERENCES_API;
  throw new Error(`Unknown Jarvis action: ${action}`);
}
