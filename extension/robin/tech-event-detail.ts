/**
 * One event's own page: the introduction, the people behind it, the address.
 *
 * The feeds in ./tech-event-sources.ts only carry what fits in a list row — a
 * title, a time, a host name. Everything that tells you whether an evening is
 * worth it (what the talks are, who is speaking, who else is going) lives on
 * the event's Luma page, so it is read from there on demand when you open the
 * event, not for all forty rows on every weekly scan.
 *
 * Pure: it takes the page's HTML and returns plain data. The fetch lives with
 * the other Luma requests in ./tech-event-sources.ts.
 *
 * Nothing here is rendered as HTML. Luma stores the description as a
 * ProseMirror document, and it is flattened into a small block tree whose
 * only markup is bold, italic and an http(s) link — the page turns that into
 * React elements, so a host's description can never inject markup. Every URL
 * that survives (links, avatars, the host calendar) is re-checked here.
 */

export type DetailInline =
  | { text: string; bold?: true; italic?: true; href?: string }
  | { br: true };

export type DetailBlock =
  | { kind: "p"; inlines: DetailInline[] }
  | { kind: "h"; inlines: DetailInline[] }
  | { kind: "ul" | "ol"; items: DetailBlock[][] }
  | { kind: "quote"; blocks: DetailBlock[] }
  | { kind: "hr" };

export interface TechEventPersonLink {
  kind: "x" | "linkedin" | "website";
  url: string;
}

export interface TechEventPerson {
  name: string;
  avatarUrl?: string;
  bio?: string;
  links: TechEventPersonLink[];
}

export interface TechEventDetail {
  id: string;
  /** UTC instant, ISO 8601 — when this copy was read from Luma. */
  fetchedAt: string;
  description: DetailBlock[];
  /** The community calendar that published it. */
  calendar?: { name: string; avatarUrl?: string; about?: string; url?: string };
  hosts: TechEventPerson[];
  /** A handful of people who registered and let Luma show them. */
  featuredGuests: TechEventPerson[];
  guestCount?: number;
  fullAddress?: string;
  /** "Mission Bay", when Luma knows it. */
  neighborhood?: string;
  coordinate?: { latitude: number; longitude: number };
  spotsRemaining?: number;
  nearCapacity?: boolean;
  waitlist?: boolean;
}

/** A description longer than this is a wall, and a stored copy has to stay small. */
const MAX_TEXT = 12_000;
const MAX_BLOCKS = 120;
const MAX_GUESTS = 12;
const MAX_HOSTS = 8;

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** http(s) only; everything else — javascript:, data:, mailto: — is dropped. */
export function safeHttpUrl(value: unknown): string | undefined {
  const text = str(value);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** Images are only ever Luma's own CDN, over HTTPS. */
export function safeLumaImage(value: unknown): string | undefined {
  const href = safeHttpUrl(value);
  if (!href) return undefined;
  const url = new URL(href);
  return url.protocol === "https:" && (url.hostname === "lumacdn.com" || url.hostname.endsWith(".lumacdn.com"))
    ? href
    : undefined;
}

const HANDLE_RE = /^[A-Za-z0-9_.-]{1,60}$/;

function person(raw: unknown): TechEventPerson | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const name = str(row.name)
    ?? [str(row.first_name), str(row.last_name)].filter(Boolean).join(" ")
    ?? "";
  if (!name) return null;

  const links: TechEventPersonLink[] = [];
  const twitter = str(row.twitter_handle)?.replace(/^@/, "");
  if (twitter && HANDLE_RE.test(twitter)) links.push({ kind: "x", url: `https://x.com/${twitter}` });
  // Luma stores LinkedIn as a path ("/in/someone"), not a URL.
  const linkedin = str(row.linkedin_handle)?.replace(/^\/+/, "");
  if (linkedin && /^(in|company)\/[A-Za-z0-9_%-]{1,100}\/?$/.test(linkedin)) {
    links.push({ kind: "linkedin", url: `https://www.linkedin.com/${linkedin}` });
  }
  const website = safeHttpUrl(row.website);
  if (website) links.push({ kind: "website", url: website });

  const avatarUrl = safeLumaImage(row.avatar_url);
  const bio = str(row.bio_short)?.slice(0, 280);
  return { name: name.slice(0, 120), ...(avatarUrl ? { avatarUrl } : {}), ...(bio ? { bio } : {}), links };
}

interface MirrorNode {
  type?: unknown;
  text?: unknown;
  content?: unknown;
  marks?: unknown;
  attrs?: unknown;
}

const children = (node: MirrorNode): MirrorNode[] =>
  Array.isArray(node.content) ? node.content.filter((child) => child && typeof child === "object") as MirrorNode[] : [];

/**
 * Flatten a ProseMirror document into the block tree above.
 *
 * Unknown node types keep their text rather than vanishing, since Luma adds
 * node types without notice and a missing paragraph is worse than a plain one.
 * The budget is shared across the whole walk so a pathological document stops
 * cleanly instead of being cut mid-word in the store.
 */
export function mirrorToBlocks(doc: unknown): DetailBlock[] {
  let budget = MAX_TEXT;
  let blocks = 0;

  const inlines = (node: MirrorNode): DetailInline[] => {
    const out: DetailInline[] = [];
    const walk = (current: MirrorNode) => {
      if (budget <= 0) return;
      if (current.type === "hard_break") {
        out.push({ br: true });
        return;
      }
      if (current.type === "text" && typeof current.text === "string") {
        const text = current.text.slice(0, budget);
        budget -= text.length;
        const marks = Array.isArray(current.marks) ? current.marks as MirrorNode[] : [];
        const link = marks.find((mark) => mark?.type === "link");
        const href = link && typeof link.attrs === "object" && link.attrs
          ? safeHttpUrl((link.attrs as Record<string, unknown>).href)
          : undefined;
        out.push({
          text,
          ...(marks.some((mark) => mark?.type === "bold") ? { bold: true as const } : {}),
          ...(marks.some((mark) => mark?.type === "italic") ? { italic: true as const } : {}),
          ...(href ? { href } : {}),
        });
        return;
      }
      for (const child of children(current)) walk(child);
    };
    for (const child of children(node)) walk(child);
    return out;
  };

  const hasText = (line: DetailInline[]) => line.some((part) => "text" in part && part.text.trim());

  const block = (node: MirrorNode): DetailBlock[] => {
    if (budget <= 0 || blocks >= MAX_BLOCKS) return [];
    blocks += 1;
    switch (node.type) {
      case "paragraph": {
        const line = inlines(node);
        return hasText(line) ? [{ kind: "p", inlines: line }] : [];
      }
      case "heading": {
        const line = inlines(node);
        return hasText(line) ? [{ kind: "h", inlines: line }] : [];
      }
      case "bullet_list":
      case "bulletList":
      case "ordered_list":
      case "orderedList": {
        const items = children(node)
          .map((item) => children(item).flatMap(block))
          .filter((item) => item.length > 0);
        const kind = String(node.type).startsWith("ordered") ? "ol" : "ul";
        return items.length ? [{ kind, items }] : [];
      }
      case "blockquote": {
        const inner = children(node).flatMap(block);
        return inner.length ? [{ kind: "quote", blocks: inner }] : [];
      }
      case "horizontal_rule":
      case "horizontalRule":
        return [{ kind: "hr" }];
      default: {
        // Containers (doc, list_item) descend; leaf-ish unknowns keep their text.
        const nested = children(node);
        if (nested.some((child) => child.type !== "text" && child.type !== "hard_break")) {
          return nested.flatMap(block);
        }
        const line = inlines(node);
        return hasText(line) ? [{ kind: "p", inlines: line }] : [];
      }
    }
  };

  if (!doc || typeof doc !== "object") return [];
  return children(doc as MirrorNode).flatMap(block);
}

/** Pull the page's embedded data out of its Next.js payload. */
function pageData(html: string): Record<string, unknown> | null {
  const embedded = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
  );
  if (!embedded) return null;
  try {
    const data = (JSON.parse(embedded[1]!) as {
      props?: { pageProps?: { initialData?: { data?: unknown } } };
    }).props?.pageProps?.initialData?.data;
    return data && typeof data === "object" ? data as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/**
 * Read an event page into a `TechEventDetail`, or throw if it is not one.
 *
 * Throwing (rather than returning an empty detail) is what lets the domain
 * keep serving the last good copy when Luma changes shape underneath us.
 */
export function parseLumaEventPage(html: string, id: string, now = new Date().toISOString()): TechEventDetail {
  const data = pageData(html);
  const event = data?.event as Record<string, unknown> | undefined;
  if (!data || !event || typeof event !== "object") throw new Error("luma: page carried no event");

  const calendarRaw = data.calendar as Record<string, unknown> | undefined;
  const calendarName = str(calendarRaw?.name);
  const calendarSlug = str(calendarRaw?.slug);
  const calendarAvatar = safeLumaImage(calendarRaw?.avatar_url);
  const calendarAbout = str(calendarRaw?.description_short)?.slice(0, 500);
  const calendar = calendarName
    ? {
      name: calendarName,
      ...(calendarAvatar ? { avatarUrl: calendarAvatar } : {}),
      ...(calendarAbout ? { about: calendarAbout } : {}),
      ...(calendarSlug && /^[A-Za-z0-9._-]{1,80}$/.test(calendarSlug)
        ? { url: `https://luma.com/${calendarSlug}` }
        : {}),
    }
    : undefined;

  const list = (value: unknown, max: number) => (Array.isArray(value) ? value : [])
    .map(person)
    .filter((row): row is TechEventPerson => row !== null)
    .slice(0, max);

  const geo = event.geo_address_info as Record<string, unknown> | null | undefined;
  const place = (geo?.place_coordinate ?? event.coordinate) as Record<string, unknown> | null | undefined;
  const latitude = num(place?.latitude);
  const longitude = num(place?.longitude);
  const ticket = data.ticket_info as Record<string, unknown> | null | undefined;
  const fullAddress = str(geo?.full_address);
  const neighborhood = str(geo?.sublocality);
  const guestCount = num(data.guest_count);
  const spotsRemaining = num(ticket?.spots_remaining);

  return {
    id,
    fetchedAt: now,
    description: mirrorToBlocks(data.description_mirror),
    ...(calendar ? { calendar } : {}),
    hosts: list(data.hosts, MAX_HOSTS),
    featuredGuests: list(data.featured_guests, MAX_GUESTS),
    ...(guestCount !== undefined ? { guestCount } : {}),
    ...(fullAddress ? { fullAddress } : {}),
    ...(neighborhood ? { neighborhood } : {}),
    ...(latitude !== undefined && longitude !== undefined ? { coordinate: { latitude, longitude } } : {}),
    ...(spotsRemaining !== undefined ? { spotsRemaining } : {}),
    ...(ticket?.is_near_capacity === true ? { nearCapacity: true } : {}),
    ...(event.waitlist_status === "enabled" || data.waitlist_active === true ? { waitlist: true } : {}),
  };
}

/** A cached copy is good for a day; hosts edit descriptions, not hourly. */
export const DETAIL_TTL_MS = 24 * 60 * 60 * 1_000;

export function isDetailFresh(detail: TechEventDetail | undefined, now = Date.now()): boolean {
  if (!detail) return false;
  const fetched = Date.parse(detail.fetchedAt);
  return Number.isFinite(fetched) && now - fetched < DETAIL_TTL_MS;
}
