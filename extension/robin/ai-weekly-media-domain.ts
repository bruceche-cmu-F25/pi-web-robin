/** Source-owned editorial imagery, never model-invented image URLs.
 * Old editions benefit too: the preview is an optional cache, not a rewrite of the brief.
 */
import { fetchPublicWeb } from "./fetch-public-web.ts";
import { canonicalSource, sourceText } from "./ai-weekly-research.ts";
import { weeklyView } from "./ai-weekly-domain.ts";
import { calendarDay } from "./ai-weekly.ts";

export interface WeeklyImage { body: Uint8Array; contentType: string }
const MAX_IMAGE = 3 * 1024 * 1024;
const MAX_CACHE = 16 * 1024 * 1024;
const cache = new Map<string, { expires: number; image: WeeklyImage | null }>();
const pending = new Map<string, Promise<WeeklyImage | null>>();

/** Only declared article previews, not arbitrary images or scripts found in the page. */
export function weeklyImageUrl(html: string, pageUrl: string): string | null {
  const clean = html.replace(/<!--[\s\S]*?(?:-->|$)/g, " ")
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?(?:<\/\1>|$)/gi, " ");
  const images = new Map<string, string>();
  for (const tag of clean.match(/<meta\b[^<>]*>/gi) ?? []) {
    const attrs = new Map<string, string>();
    for (const match of tag.matchAll(/([a-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
      attrs.set(match[1]!.toLowerCase(), sourceText(match[2] ?? match[3] ?? match[4] ?? ""));
    }
    const name = (attrs.get("property") ?? attrs.get("name") ?? "").toLowerCase();
    if (["og:image:secure_url", "og:image", "twitter:image"].includes(name) && !images.has(name)) {
      const raw = attrs.get("content");
      if (!raw) continue;
      try { images.set(name, canonicalSource(new URL(raw, pageUrl).href)); } catch { /* Untrusted metadata, not a fetch permission. */ }
    }
  }
  return images.get("og:image:secure_url") ?? images.get("og:image") ?? images.get("twitter:image") ?? null;
}

async function boundedBody(response: Response, limit: number, prefix = false): Promise<Uint8Array> {
  if (!response.body) throw new Error("No response body");
  const reader = response.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (size < limit) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks);
      if (!prefix && size + value.byteLength > limit) throw new Error("Image too large");
      const chunk = value.subarray(0, limit - size);
      chunks.push(chunk); size += chunk.byteLength;
    }
    if (!prefix && !(await reader.read()).done) throw new Error("Image too large");
    return Buffer.concat(chunks);
  } finally { await reader.cancel().catch(() => {}); }
}
function rasterType(bytes: Uint8Array): string | null {
  const buffer = Buffer.from(bytes);
  if (buffer.length < 12) return null;
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return "image/jpeg";
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

/** Public URLs only, checked again at every redirect by fetchPublicWeb. */
export async function fetchWeeklyImage(source: string, fetchImpl: typeof fetch = fetch): Promise<WeeklyImage | null> {
  try {
    const pageUrl = canonicalSource(source);
    const signal = AbortSignal.timeout(15_000);
    const page = await fetchPublicWeb(pageUrl, { signal, headers: { Accept: "text/html", "User-Agent": "RobinAIWeekly/1.0" } }, fetchImpl);
    if (!page.ok || !/text\/html|application\/xhtml/i.test(page.headers.get("content-type") ?? "")) {
      await page.body?.cancel(); return null;
    }
    const html = new TextDecoder().decode(await boundedBody(page, 2 * 1024 * 1024, true));
    const imageUrl = weeklyImageUrl(html, page.url || pageUrl);
    if (!imageUrl) return null;
    const image = await fetchPublicWeb(imageUrl, { signal, headers: { Accept: "image/png,image/jpeg,image/webp" } }, fetchImpl);
    const type = (image.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (!image.ok || !["image/png", "image/jpeg", "image/webp"].includes(type)
      || Number(image.headers.get("content-length")) > MAX_IMAGE) {
      await image.body?.cancel(); return null;
    }
    const body = await boundedBody(image, MAX_IMAGE);
    if (rasterType(body) !== type) return null;
    return { body, contentType: type };
  } catch { return null; } // No image must never block reading a brief.
}

/** HTTP takes edition/day, NEVER a client-supplied URL: not an open image proxy. */
export async function weeklyImage(week: string, day: string): Promise<WeeklyImage | null> {
  if (!calendarDay(week) || !calendarDay(day)) throw new Error("Invalid reading day");
  const source = weeklyView(week).edition?.slots.find((s) => s.date === day)?.story?.source.url;
  if (!source) return null;
  const cached = cache.get(source);
  if (cached && cached.expires > Date.now()) return cached.image;
  cache.delete(source);
  if (pending.has(source)) return pending.get(source)!;
  if (pending.size >= 4) return null;
  const task = fetchWeeklyImage(source).then((image) => {
    cache.set(source, { image, expires: Date.now() + (image ? 24 * 3600_000 : 15 * 60_000) });
    let size = [...cache.values()].reduce((sum, entry) => sum + (entry.image?.body.byteLength ?? 0), 0);
    while (cache.size > 32 || size > MAX_CACHE) {
      const oldest = cache.keys().next().value!;
      size -= cache.get(oldest)?.image?.body.byteLength ?? 0;
      cache.delete(oldest);
    }
    return image;
  }).finally(() => pending.delete(source));
  pending.set(source, task);
  return task;
}
