/** Fresh bounded calendar snapshots, no calendar writes and no private data in public queries. */
import { calendarBoard, type CalendarBoard } from "./calendar-domain.ts";
import { getAccessToken, googleConnectionGuard, mapGoogleEvent, type GoogleEvent } from "./google-calendar.ts";
import { googleCalendarSources } from "./settings.ts";
import { addDays, localDate } from "./dates.ts";
import { calendarBriefInput } from "./brief-sources.ts";
import { BriefAcquisitionStorageError, BRIEF_RESPONSE_LIMIT, type BriefAcquisitionContext } from "./brief-acquisition.ts";
import type { BriefInput, BriefScope } from "./brief.ts";
interface CalendarDeps {
  local?: () => Promise<CalendarBoard>; token?: (signal: AbortSignal) => Promise<string>;
  connected?: () => boolean; sources?: () => { id: string; label?: string; enabled: boolean }[];
  fetch?: typeof fetch; now?: () => Date;
}
export async function collectCalendarBrief(scope: BriefScope, signal: AbortSignal, acquisition: BriefAcquisitionContext, deps: CalendarDeps = {}): Promise<BriefInput> {
  const now = deps.now ?? (() => new Date());
  if (scope.day !== localDate(now()) || scope.timezone !== Intl.DateTimeFormat().resolvedOptions().timeZone) return { source: "calendar", observedAt: now().toISOString(), coverage: "unavailable", detail: "Cannot refresh a past or differently zoned calendar day; use a new request", items: [] };
  const board = await (deps.local ?? (() => calendarBoard({ localOnly: true })))();
  const connected = deps.connected ?? googleConnectionGuard();
  if (!connected()) return calendarBriefInput({ ...board, google: { connected: false } }, scope, now().toISOString(), true);
  const sources = [{ id: "primary", label: "Google" }, ...(deps.sources ?? googleCalendarSources)().filter(s => s.enabled && s.id !== "primary")];
  let incomplete = sources.length > 4;
  const events = [...board.events];
  try {
    acquisition.reserveRequest();
    const token = await (deps.token ?? (s => getAccessToken("primary", s)))(signal);
    for (const source of sources.slice(0, 4)) {
      try {
        let pageToken: string | undefined;
        for (let page = 0; page < 2; page++) {
          signal.throwIfAborted(); if (!connected()) throw new Error("Google connection changed");
          acquisition.reserveRequest();
          const query = new URLSearchParams({ timeMin: new Date(`${scope.day}T00:00:00`).toISOString(), timeMax: new Date(`${addDays(scope.day, 1)}T00:00:00`).toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "100", ...(pageToken ? { pageToken } : {}) });
          const response = await (deps.fetch ?? fetch)(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(source.id)}/events?${query}`, { headers: { Authorization: `Bearer ${token}` }, redirect: "error", cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]) });
          if (!response.ok) { await response.body?.cancel(); throw new Error("Calendar response unavailable"); }
          const reader = response.body?.getReader(); if (!reader) throw new Error("Missing calendar body");
          const chunks: Uint8Array[] = []; let size = 0;
          try {
            for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > BRIEF_RESPONSE_LIMIT) throw new Error("Calendar response exceeds limit"); chunks.push(value); }
          } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
          const data = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { items?: GoogleEvent[]; nextPageToken?: string };
          if (!data || typeof data !== "object" || Array.isArray(data) || (data.items !== undefined && (!Array.isArray(data.items) || data.items.length > 100))) throw new Error("Invalid calendar response");
          if (!connected()) throw new Error("Google connection changed");
          for (const item of data.items ?? []) {
            if (typeof item?.id !== "string" || !item.id || item.id.length > 250) { incomplete = true; continue; }
            const event = mapGoogleEvent(item, source.label ?? source.id, source.id);
            if (event) events.push(event);
          }
          if (data.nextPageToken === undefined) { pageToken = undefined; break; }
          if (typeof data.nextPageToken !== "string" || !data.nextPageToken || data.nextPageToken.length > 4096 || data.nextPageToken === pageToken) throw new Error("Invalid calendar page token");
          pageToken = data.nextPageToken;
        }
        if (pageToken) incomplete = true;
      } catch (error) { signal.throwIfAborted(); if (error instanceof BriefAcquisitionStorageError) throw error; incomplete = true; }
    }
  } catch (error) { signal.throwIfAborted(); if (error instanceof BriefAcquisitionStorageError) throw error; incomplete = true; }
  // A changed grant invalidates the whole remote snapshot, not merely its last page.
  return calendarBriefInput({ ...board, events: connected() ? events : board.events, google: { connected: true, ...(incomplete || !connected() ? { error: "incomplete" } : {}) } }, scope, now().toISOString(), true);
}
