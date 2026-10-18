import { fetchPublicWeb } from "./fetch-public-web.ts";
import { canonicalPaperUrl, paperText, paperUrl, PaperError, type PaperMetadata } from "./papers-domain.ts";

/** Bound decompressed bytes as well as Content-Length; all redirects use the shared DNS-pinned fetch. */
export async function readPaperResponse(response: Response, limit: number): Promise<Uint8Array> {
  if (!response.ok) { await response.body?.cancel(); throw new PaperError(`Paper source returned HTTP ${response.status}; try again later.`, 502); }
  if (Number(response.headers.get("content-length")) > limit) { await response.body?.cancel(); throw new PaperError("Paper source is too large", 413); }
  const reader = response.body?.getReader();
  if (!reader) throw new PaperError("Paper source was empty", 502);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw new PaperError("Paper source is too large", 413);
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return Buffer.concat(chunks, total);
}
function xmlText(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]*>/g, "")
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, code: string) => {
      const point = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "";
    }).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}
const element = (xml: string, tag: string) => xmlText(xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`))?.[1] ?? "");
/** arXiv's small Atom subset, not a general XML parser. No entities/DTD are evaluated. */
export function parseArxivPapers(xml: string): PaperMetadata[] {
  if (!/<feed[\s>]/.test(xml)) throw new PaperError("arXiv did not return a paper feed", 502);
  return [...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/g)].slice(0, 20).map(([, entry]) => {
    const id = element(entry, "id");
    if (!/^https?:\/\/(?:export\.)?arxiv\.org\/abs\//.test(id)) throw new PaperError(element(entry, "summary") || "Invalid arXiv entry", 502);
    const url = canonicalPaperUrl(id);
    return { title: element(entry, "title"), url, authors: [...entry.matchAll(/<author>([\s\S]*?)<\/author>/g)].slice(0, 100).map(([, author]) => element(author, "name")),
      year: element(entry, "published").slice(0, 4), abstract: element(entry, "summary"), pdfUrl: url.replace("/abs/", "/pdf/"), provider: "arXiv" };
  });
}
export function arxivId(input: string): string | null {
  let text = input.trim().replace(/^arxiv:/i, "");
  if (/^https?:\/\//i.test(text)) {
    const url = new URL(text);
    if (!/^(export\.)?arxiv\.org$/.test(url.hostname)) return null;
    text = url.pathname.replace(/^\/(abs|pdf|html)\//, "").replace(/\.pdf$/, "");
  }
  return /^(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?$/.test(text) ? text : null;
}
export function parseArxivPage(html: string, id: string): PaperMetadata {
  const fields = new Map<string, string[]>();
  for (const [tag] of html.matchAll(/<meta\s[^>]*>/gi)) {
    const attrs = Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(["'])([\s\S]*?)\2/g)].map(([, key, , value]) => [key.toLowerCase(), xmlText(value)]));
    if (attrs.name && attrs.content) fields.set(attrs.name, [...(fields.get(attrs.name) ?? []), attrs.content]);
  }
  const first = (key: string) => fields.get(`citation_${key}`)?.[0] ?? "";
  if (!first("title") || !first("arxiv_id")) throw new PaperError("arXiv metadata unavailable", 502);
  if (first("arxiv_id").replace(/v\d+$/, "") !== id.replace(/v\d+$/, "")) throw new PaperError("arXiv returned a different paper", 502);
  return { title: first("title").slice(0, 1000), url: canonicalPaperUrl(`https://arxiv.org/abs/${id}`),
    authors: (fields.get("citation_author") ?? []).slice(0, 100), year: first("date").slice(0, 4),
    abstract: first("abstract").slice(0, 30_000), pdfUrl: paperUrl(first("pdf_url"), true), provider: "arXiv" };
}
interface CrossrefWork {
  DOI?: string; title?: string[]; author?: Array<{ given?: string; family?: string }>;
  published?: { "date-parts"?: number[][] }; abstract?: string;
  link?: Array<{ "content-type"?: string; URL?: string }>;
}
export function parseCrossrefPaper(data: CrossrefWork): PaperMetadata {
  if (!data || typeof data.DOI !== "string" || !/^10\.\d{4,9}\/\S+$/i.test(data.DOI)) throw new PaperError("DOI metadata unavailable", 502);
  const pdf = Array.isArray(data.link) ? data.link.find((link) => link?.["content-type"] === "application/pdf") : null;
  let pdfUrl = "";
  try { pdfUrl = paperUrl(pdf?.URL, true); } catch { /* An unusable publisher link is not a readable PDF. */ }
  return { title: String(data.title?.[0] ?? data.DOI).slice(0, 1000), url: canonicalPaperUrl(`https://doi.org/${data.DOI}`),
    authors: (Array.isArray(data.author) ? data.author : []).slice(0, 100).map((author) => [author?.given, author?.family].filter(Boolean).join(" ").slice(0, 300)),
    year: String(data.published?.["date-parts"]?.[0]?.[0] ?? "").slice(0, 10), abstract: xmlText(String(data.abstract ?? "")).slice(0, 30_000), pdfUrl, provider: "Crossref" };
}
export async function searchPapers(query: string, sort: "relevance" | "submittedDate", signal?: AbortSignal): Promise<{ results: PaperMetadata[]; fallback?: true }> {
  paperText(query, 500, true);
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(35_000)]) : AbortSignal.timeout(35_000);
  const doi = query.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "");
  if (/^10\.\d{4,9}\/\S+$/i.test(doi)) {
    const response = await fetchPublicWeb(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, { signal: requestSignal });
    const data = JSON.parse(Buffer.from(await readPaperResponse(response, 2_000_000)).toString("utf8")).message;
    return { results: [parseCrossrefPaper(data)] };
  }
  const id = arxivId(query);
  if (/^https?:\/\//i.test(query) && !id) throw new PaperError("Search accepts arXiv links or a DOI. Use Add by URL for another paper.");
  if (id) {
    // The abstract page has authoritative citation metadata and is not subject to the API's separate rate limit.
    const response = await fetchPublicWeb(`https://arxiv.org/abs/${id}`, { signal: requestSignal });
    return { results: [parseArxivPage(Buffer.from(await readPaperResponse(response, 2_000_000)).toString("utf8"), id)] };
  }
  const params = new URLSearchParams({
    search_query: query.trim().split(/\s+/).map((word) => `all:${word.replace(/["():]/g, "")}`).join(" AND "),
    sortBy: sort, sortOrder: "descending", max_results: "12",
  });
  try {
    const response = await fetchPublicWeb(`https://export.arxiv.org/api/query?${params}`, { signal: AbortSignal.any([requestSignal, AbortSignal.timeout(10_000)]) });
    return { results: parseArxivPapers(Buffer.from(await readPaperResponse(response, 2_000_000)).toString("utf8")) };
  } catch (error) {
    requestSignal.throwIfAborted();
    // A public index must remain usable when arXiv throttles this server's IP. The UI labels the fallback explicitly.
    const crossref = new URLSearchParams({ "query.bibliographic": query, rows: "12", sort: sort === "submittedDate" ? "published" : "relevance", order: "desc" });
    try {
      const response = await fetchPublicWeb(`https://api.crossref.org/works?${crossref}`, { signal: requestSignal });
      const body = JSON.parse(Buffer.from(await readPaperResponse(response, 2_000_000)).toString("utf8"));
      if (!Array.isArray(body.message?.items)) throw new PaperError("Crossref returned no catalog", 502);
      return { results: body.message.items.map(parseCrossrefPaper), fallback: true };
    } catch { throw error; }
  }
}
export async function downloadPaperPdf(url: string, signal?: AbortSignal): Promise<Uint8Array> {
  const target = paperUrl(url);
  const response = await fetchPublicWeb(target, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45_000)]) : AbortSignal.timeout(45_000) });
  return readPaperResponse(response, 20 * 1024 * 1024);
}
