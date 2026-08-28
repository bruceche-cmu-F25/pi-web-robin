/**
 * Where Bay Area tech events actually get posted: Luma.
 *
 * Two feeds, because they answer different questions. A *place* feed is the
 * city's whole discovery page — it finds events from hosts you have never
 * heard of, which is the only way a new community reaches you, and it is also
 * where every book club comes from, so almost everything the classifier throws
 * away arrives through here. A *calendar* feed is one community's own page: it
 * finds nothing new but never misses that community's next night, including
 * the ones the discovery page does not promote.
 *
 * Neither endpoint is documented, so both are read the way the site itself
 * reads them and neither is trusted to keep its shape: every field is checked
 * on the way out, and a source that changes underneath us fails alone (see the
 * per-source error handling in ./tech-event-scan.ts) rather than emptying the
 * page.
 *
 * Server-only — it makes outbound requests. The classification it feeds is in
 * ./tech-events.ts and stays pure.
 *
 * Two guards travel with every slug, for the same reason as the ATS sweep in
 * ./job-directory.ts: a slug is configuration that ends up interpolated into a
 * URL. Every slug must match a conservative charset, and every constructed URL
 * is re-parsed and refused unless it lands on Luma's own hostnames.
 */
import { makeFetchContext, type FetchContext } from "./job-providers.ts";
import { classifyTechEvent, inBayArea, type TechEvent } from "./tech-events.ts";

const SITE_HOST = "luma.com";
const API_HOST = "api.lu.ma";
const SLUG_RE = /^[A-Za-z0-9._-]{1,80}$/;

/** One page of the site is read only for the id buried in it; 1MB is generous. */
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
/** Luma caps a page of results well below this; asking for more is free. */
const PAGE_SIZE = 100;
/** A place feed a year out is not a plan. Stops a runaway cursor loop too. */
const MAX_PAGES = 12;

export interface TechEventSource {
  /** Stable id, used as the scan-state key. */
  id: string;
  kind: "place" | "calendar";
  /** The Luma slug: `luma.com/<slug>`. */
  slug: string;
  /** What to call it on screen before the feed tells us its real name. */
  label: string;
}

/**
 * What a scan reads by default.
 *
 * The city page is the whole Bay Area as far as Luma is concerned — it has no
 * separate place for Palo Alto or Berkeley, and its San Francisco feed carries
 * the peninsula and East Bay events anyway, which the region filter in
 * ./tech-events.ts is what actually enforces.
 *
 * The named calendars are communities whose events the discovery page
 * under-promotes. They are seeds, not a curated set: add a slug here and it is
 * read on the next scan.
 */
export const DEFAULT_SOURCES: TechEventSource[] = [
  { id: "luma-place-sf", kind: "place", slug: "sf", label: "Luma · San Francisco" },
  { id: "luma-cal-genai-collective", kind: "calendar", slug: "genai-collective", label: "The AI Collective" },
  { id: "luma-cal-openrouter", kind: "calendar", slug: "openrouter", label: "OpenRouter" },
];

/** Re-parse a constructed URL and refuse anything off Luma's own hosts. */
function onLumaHost(url: string, expected: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error(`luma: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== expected) {
    throw new Error(`luma: untrusted hostname "${parsed.hostname}"`);
  }
  return parsed.toString();
}

function requireSlug(slug: string): string {
  if (!SLUG_RE.test(slug)) throw new Error(`luma: unusable slug "${slug}"`);
  return slug;
}

/* ─────────────────────────── the feeds ─────────────────────────── */

interface LumaEntry {
  event?: {
    api_id?: unknown;
    name?: unknown;
    url?: unknown;
    start_at?: unknown;
    end_at?: unknown;
    timezone?: unknown;
    cover_url?: unknown;
    location_type?: unknown;
    geo_address_info?: {
      city_state?: unknown;
      city?: unknown;
      short_address?: unknown;
      address?: unknown;
    } | null;
    coordinate?: { latitude?: unknown; longitude?: unknown } | null;
  };
  calendar?: { name?: unknown; description_short?: unknown } | null;
  guest_count?: unknown;
  ticket_info?: { is_free?: unknown; is_sold_out?: unknown; require_approval?: unknown } | null;
}

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** ISO instant, or undefined — a row Luma cannot date is a row we cannot place. */
function instant(value: unknown): string | undefined {
  const text = str(value);
  if (!text) return undefined;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

/**
 * One feed row into one event, or null.
 *
 * Both filters live here rather than in the caller so that the per-source
 * counts in the scan state mean what they say: `seen` is what the feed
 * returned, `kept` is what survived being neither local nor technical.
 */
function toTechEvent(entry: LumaEntry, source: TechEventSource, now: string): TechEvent | null {
  const raw = entry.event;
  if (!raw) return null;

  const id = str(raw.api_id);
  const title = str(raw.name);
  const slug = str(raw.url);
  const startAt = instant(raw.start_at);
  if (!id || !title || !slug || !startAt) return null;

  const online = str(raw.location_type) === "virtual";
  const geo = raw.geo_address_info ?? null;
  const city = str(geo?.city_state) ?? str(geo?.city);
  const coordinate = raw.coordinate ?? null;

  // An online event carries no address, so the region check would refuse every
  // one of them. Trusting the feed's own scoping is right for exactly this
  // case: a virtual event on the San Francisco page is a Bay Area community's
  // virtual event.
  if (!online && !inBayArea({
    latitude: num(coordinate?.latitude),
    longitude: num(coordinate?.longitude),
    ...(city ? { city } : {}),
  })) {
    return null;
  }

  const host = str(entry.calendar?.name);
  const verdict = classifyTechEvent({
    title,
    ...(host ? { host } : {}),
    ...(str(entry.calendar?.description_short)
      ? { hostDescription: str(entry.calendar?.description_short)! }
      : {}),
  });
  if (!verdict.admit) return null;

  const ticket = entry.ticket_info ?? null;
  const venue = str(geo?.short_address) ?? str(geo?.address);
  const endAt = instant(raw.end_at);
  const timezone = str(raw.timezone);
  const coverUrl = str(raw.cover_url);
  const guests = num(entry.guest_count);

  return {
    id: `luma:${id}`,
    title,
    // Never built from the API's own strings beyond the slug, and re-parsed
    // like every other constructed URL: the page renders this as an href.
    url: onLumaHost(`https://${SITE_HOST}/${encodeURIComponent(slug)}`, SITE_HOST),
    source: source.id,
    ...(host ? { host } : {}),
    startAt,
    ...(endAt ? { endAt } : {}),
    ...(timezone ? { timezone } : {}),
    ...(city ? { city } : {}),
    ...(venue ? { venue } : {}),
    online,
    ...(typeof ticket?.is_free === "boolean" ? { free: ticket.is_free } : {}),
    ...(ticket?.is_sold_out === true ? { soldOut: true } : {}),
    ...(ticket?.require_approval === true ? { requiresApproval: true } : {}),
    ...(guests !== undefined ? { guests } : {}),
    ...(coverUrl ? { coverUrl } : {}),
    topics: verdict.topics,
    score: verdict.score,
    matched: verdict.matched,
    discoveredAt: now,
  };
}

/**
 * Read the `api_id` Luma's own page was rendered with.
 *
 * Resolving the slug on every scan instead of storing the id is deliberate:
 * the id is an implementation detail of a site that redesigns itself, and a
 * stale hard-coded one fails as an empty feed — the failure mode a weekly
 * unattended job is least likely to have noticed.
 */
async function resolveApiId(
  source: TechEventSource,
  ctx: FetchContext,
): Promise<{ apiId: string; name?: string }> {
  const url = onLumaHost(`https://${SITE_HOST}/${requireSlug(source.slug)}`, SITE_HOST);
  const html = await ctx.fetchText(url, { timeoutMs: 30_000, maxBytes: MAX_PAGE_BYTES });
  const embedded = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
  );
  if (!embedded) throw new Error(`luma: ${source.slug} did not render an event feed`);

  const data = (JSON.parse(embedded[1]!) as {
    props?: { pageProps?: { initialData?: { data?: unknown } } };
  }).props?.pageProps?.initialData?.data as
    | { place?: { api_id?: unknown; name?: unknown }; calendar?: { api_id?: unknown; name?: unknown } }
    | undefined;

  const holder = source.kind === "place" ? data?.place : data?.calendar;
  const apiId = str(holder?.api_id);
  if (!apiId) throw new Error(`luma: ${source.slug} is not a ${source.kind} page`);
  const name = str(holder?.name);
  return { apiId, ...(name ? { name } : {}) };
}

/** The paged endpoint behind whichever feed this is. */
function feedUrl(source: TechEventSource, apiId: string, cursor?: string): string {
  const query = new URLSearchParams(
    source.kind === "place"
      ? { discover_place_api_id: apiId, pagination_limit: String(PAGE_SIZE) }
      : { calendar_api_id: apiId, period: "future", pagination_limit: String(PAGE_SIZE) },
  );
  if (cursor) query.set("pagination_cursor", cursor);
  const path = source.kind === "place" ? "discover/get-paginated-events" : "calendar/get-items";
  return onLumaHost(`https://${API_HOST}/${path}?${query}`, API_HOST);
}

export interface SourceHarvest {
  /** Rows the feed returned. */
  seen: number;
  events: TechEvent[];
  /** The feed's own name for itself, once it is known. */
  name?: string;
}

/** Walk one source to the end of its cursor and return what it is worth keeping. */
export async function harvestSource(
  source: TechEventSource,
  ctx: FetchContext = makeFetchContext(),
  now = new Date().toISOString(),
): Promise<SourceHarvest> {
  const { apiId, name } = await resolveApiId(source, ctx);
  const events: TechEvent[] = [];
  const ids = new Set<string>();
  let seen = 0;
  let cursor: string | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const body = await ctx.fetchJson(feedUrl(source, apiId, cursor), { timeoutMs: 30_000 }) as {
      entries?: unknown;
      has_more?: unknown;
      next_cursor?: unknown;
    };
    const entries = Array.isArray(body.entries) ? body.entries as LumaEntry[] : [];
    seen += entries.length;
    for (const entry of entries) {
      const event = toTechEvent(entry, source, now);
      // A place feed can list the same event twice across a cursor boundary;
      // the id set makes a page repeat cost nothing rather than double a row.
      if (event && !ids.has(event.id)) {
        ids.add(event.id);
        events.push(event);
      }
    }

    const next = str(body.next_cursor);
    if (body.has_more !== true || !next || entries.length === 0) break;
    cursor = next;
  }

  return { seen, events, ...(name ? { name } : {}) };
}
