/** Fixed public publisher feeds only. No private inputs, cookies, search strings or model tools. */
import { createHash } from "node:crypto";
import { fetchPublicWeb } from "./fetch-public-web.ts";
import { decodeEntities } from "./podcasts.ts";
import { addDays } from "./dates.ts";
import { BriefAcquisitionStorageError, type BriefAcquisitionContext } from "./brief-acquisition.ts";
import type { BriefInput, BriefScope } from "./brief.ts";
import { collectSearchBrief } from "./brief-search.ts";
export const BRIEF_PUBLIC_FEEDS = ["https://openai.com/news/rss.xml", "https://hacks.mozilla.org/feed/"] as const;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const plain = (s: string) => decodeEntities(s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
/** Restricted RSS 2.0 reader, not arbitrary XML ingestion; external entities/DTDs are refused. */
export function parseBriefFeed(xml: string, day: string, asOf = Date.parse(`${addDays(day, 1)}T00:00:00Z`) - 1) {
  if (xml.length > 1_048_576 || !/<rss\b/i.test(xml) || !/<channel\b/i.test(xml) || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Unsupported public feed");
  const entries = xml.split(/<item\b[^>]*>/i).slice(1);
  const items: { id: string; title: string; href: string; date: string; text: string; excerptOnly: boolean }[] = [];
  let omitted = entries.length > 40;
  for (const chunk of entries.slice(0, 40)) {
    const end = chunk.indexOf("</item>");
    if (end < 0 || end > 65_536) { omitted = true; continue; }
    const entry = chunk.slice(0, end);
    const tag = (name: string) => plain(entry.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1] ?? "");
    const title = tag("title"), href = tag("link"), stamp = Date.parse(tag("pubDate"));
    if (!title || title.length > 1000 || !Number.isFinite(stamp)) { omitted = true; continue; }
    const date = new Date(stamp).toISOString().slice(0, 10);
    if (date < addDays(day, -7) || stamp > asOf) continue;
    let url: URL; try { url = new URL(href); } catch { omitted = true; continue; }
    if (url.protocol !== "https:" || url.username || url.password || href.length > 2500 || /[\\\u0000-\u0020]/.test(href)) { omitted = true; continue; }
    const description = tag("description");
    const text = [title, description.slice(0, 1800)].filter(Boolean).join("\n");
    items.push({ id: hash(href), title, href, date, text, excerptOnly: !description || description.length > 1800 });
  }
  const unique = [...new Map(items.map(item => [item.id, item])).values()].sort((a, b) => b.date.localeCompare(a.date));
  return { items: unique.slice(0, 4), partial: omitted || unique.length > 4 || unique.some(i => i.excerptOnly) };
}
export async function collectPublicBrief(scope: BriefScope, signal: AbortSignal, acquisition: BriefAcquisitionContext, deps: { fetchImpl?: typeof fetch; now?: () => number; search?: Parameters<typeof collectSearchBrief>[3] } = {}): Promise<BriefInput> {
  const fetchImpl = deps.fetchImpl ?? fetch, now = deps.now ?? Date.now;
  const items: BriefInput["items"] = []; let successful = 0, partial = false;
  for (const url of BRIEF_PUBLIC_FEEDS) {
    try {
      signal.throwIfAborted(); acquisition.reserveRequest();
      const response = await fetchPublicWeb(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]), headers: { Accept: "application/rss+xml, application/xml, text/xml" }, cache: "no-store" }, fetchImpl, 0);
      if (!response.ok) { await response.body?.cancel(); throw new Error("Public feed unavailable"); }
      const reader = response.body?.getReader(); if (!reader) throw new Error("Missing public body");
      const chunks: Uint8Array[] = []; let size = 0;
      try { for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 1_048_576) throw new Error("Public feed exceeds limit"); chunks.push(value); } }
      finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      const parsed = parseBriefFeed(Buffer.concat(chunks).toString("utf8"), scope.day, now());
      const ownArticles = parsed.items.filter(item => new URL(item.href).hostname === new URL(url).hostname);
      parsed.partial ||= ownArticles.length !== parsed.items.length;
      parsed.items = ownArticles;
      const observedAt = new Date(now()).toISOString(), sourceKey = `world:feed-v1:${hash(url)}`;
      for (const item of parsed.items) acquisition.checkpoint(sourceKey, { day: scope.day, observedAt }, { itemId: item.id, generation: scope.day, evidence: { observedAt, text: item.text, metadata: { title: item.title, href: item.href, date: item.date, feed: url } } });
      const ids = new Set(parsed.items.map(item => item.id));
      for (const evidence of acquisition.evidence(sourceKey, scope.day).filter(e => ids.has(e.itemId))) items.push({
        id: `world:${evidence.id}`, source: "world", section: "world", title: String(evidence.metadata.title), summary: evidence.text.slice(0, 800), href: String(evidence.metadata.href), publishedOn: String(evidence.metadata.date),
        evidence: { kind: "public-feed", reference: evidence.id, quote: evidence.text.slice(0, 1200), checkedAt: evidence.observedAt },
      });
      successful++; partial ||= parsed.partial;
    } catch (error) { signal.throwIfAborted(); if (error instanceof BriefAcquisitionStorageError) throw error; partial = true; }
  }
  let searchDetail = "";
  if (deps.search) {
    const result = await collectSearchBrief(scope, signal, acquisition, deps.search);
    items.unshift(...result.items.filter(item => !items.some(existing => existing.href === item.href)));
    partial ||= !result.complete;
    searchDetail = `; ${result.detail}`;
  }
  return { source: "world", observedAt: new Date(now()).toISOString(), coverage: successful === 0 && items.length === 0 ? "unavailable" : partial || successful !== 2 ? "partial" : "ready",
    detail: `${successful}/2 fixed publisher feeds read (OpenAI, Mozilla Hacks); UTC publication dates within seven days, up to acquisition time; feed excerpts only, not independently verified articles or comprehensive world news${searchDetail}`, items };
}
