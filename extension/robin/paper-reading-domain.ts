import { UNTITLED_PAPER, addPaper, canonicalPaperUrl, getPaper, listPapers, paperText, paperUrl, savePaperAccess, savePaperSource, type Paper, type PaperMetadata } from "./papers-domain.ts";
import { arxivId, downloadPaperPdf, parseArxivPage, readPaperResponse, searchPapers } from "./paper-sources.ts";
import { fetchPublicWeb } from "./fetch-public-web.ts";
import { readJsonArray, updateJsonArray } from "./paths.ts";

export const PAPER_TEXT_LIMIT = 400_000;
export type PdfExtractor = (bytes: Uint8Array, maxChars: number) => Promise<{ text: string; pages: number; truncated: boolean }>;

export function rememberPaperCandidates(results: PaperMetadata[]): void {
  updateJsonArray<PaperMetadata, void>("research-candidates.json", (current) => {
    const merged = [...results, ...current.filter((item) => !results.some((result) => result.url === item.url))].slice(0, 200);
    current.splice(0, current.length, ...merged);
    return { value: undefined, changed: true };
  });
}
function decode(value: string): string {
  return value.replace(/&#(\d+);/g, (_, n: string) => Number(n) <= 0x10ffff ? String.fromCodePoint(Number(n)) : "")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}
/** Citation metadata is source evidence; arbitrary page links are not silently treated as PDFs. */
export function paperPageMetadata(html: string, url: string): Partial<PaperMetadata> {
  const fields = new Map<string, string[]>();
  for (const [tag] of html.matchAll(/<meta\s[^>]*>/gi)) {
    const attrs = Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(["'])([\s\S]*?)\2/g)].map(([, key, , value]) => [key.toLowerCase(), decode(value)]));
    const name = attrs.name ?? attrs.property;
    if (name && attrs.content) fields.set(name.toLowerCase(), [...(fields.get(name.toLowerCase()) ?? []), attrs.content]);
  }
  const first = (...names: string[]) => names.map((name) => fields.get(name)?.[0]).find(Boolean) ?? "";
  let pdfUrl = "";
  try { const raw = first("citation_pdf_url", "eprints.document_url"); if (raw) pdfUrl = paperUrl(new URL(raw, url).href); } catch { /* Ignore an unsafe metadata URL. */ }
  return { title: first("citation_title", "dc.title", "og:title") || decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ""),
    authors: (fields.get("citation_author") ?? []).slice(0, 100).map((name) => name.slice(0, 300)),
    year: first("citation_publication_date", "citation_date").slice(0, 4),
    abstract: first("citation_abstract", "dc.description", "description").slice(0, 30_000), pdfUrl };
}
export function knownPdfLinks(url: string): string[] {
  const parsed = new URL(url);
  if (parsed.hostname === "arxiv.org") return [url.replace("/abs/", "/pdf/")];
  if (parsed.hostname === "aclanthology.org") return [`${url.split("?")[0].replace(/\/$/, "").replace(/\.pdf$/, "")}.pdf`];
  if (parsed.hostname === "openreview.net") {
    const id = parsed.searchParams.get("id");
    if (id) return [`https://openreview.net/pdf?id=${encodeURIComponent(id)}`];
  }
  if (/\.pdf$/i.test(parsed.pathname)) return [url];
  return [];
}
interface ReadOptions {
  extract: PdfExtractor; signal?: AbortSignal;
  download?: typeof downloadPaperPdf;
  fetchPage?: typeof fetchPublicWeb;
}
/** Select -> resolve -> obtain -> extract -> persist. No human Add/Fetch step is required. */
export async function readResearchPaper(input: string, options: ReadOptions, alternativePdf?: string): Promise<Paper> {
  paperText(input, 3000, true);
  const signal = options.signal ?? AbortSignal.timeout(120_000);
  const fetchPage = options.fetchPage ?? fetchPublicWeb;
  const download = options.download ?? downloadPaperPdf;
  let paper = listPapers().find((item) => item.id === input);
  let landing: Partial<PaperMetadata> | null = null;
  let landingRead = false;
  let initialPdf: Uint8Array | null = null;
  const attempts: Array<{ url: string; error: string }> = [];
  if (!paper) {
    const isId = arxivId(input);
    const url = isId ? `https://arxiv.org/abs/${isId}` : /^10\.\d{4,9}\//.test(input) ? `https://doi.org/${input}` : paperUrl(input);
    const canonical = canonicalPaperUrl(url);
    paper = listPapers().find((item) => item.url === canonical);
    if (!paper) {
      let metadata = readJsonArray<PaperMetadata>("research-candidates.json").find((item) => item.url === canonical);
      if (!metadata) {
        try {
          if (isId || new URL(url).hostname === "doi.org") metadata = (await searchPapers(url, "relevance", signal)).results[0];
          else if (!/\.pdf$/i.test(new URL(url).pathname)) {
            const response = await fetchPage(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) });
            if (/application\/(pdf|octet-stream)/i.test(response.headers.get("content-type") ?? "")) {
              initialPdf = await readPaperResponse(response, 20 * 1024 * 1024);
              landing = { pdfUrl: url };
            } else {
              const html = Buffer.from(await readPaperResponse(response, 2_000_000)).toString("utf8");
              landing = paperPageMetadata(html, response.url || url);
            }
            landingRead = true;
          }
        } catch (error) {
          signal.throwIfAborted();
          landingRead = true;
          attempts.push({ url, error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500) });
        }
      }
      signal.throwIfAborted();
      paper = addPaper(metadata ?? { title: landing?.title?.slice(0, 1000) || UNTITLED_PAPER, url,
        authors: landing?.authors ?? [], year: landing?.year ?? "", abstract: landing?.abstract ?? "", pdfUrl: landing?.pdfUrl ?? knownPdfLinks(url)[0] ?? "", provider: new URL(url).hostname });
    }
  }
  if (paper.source && !alternativePdf) return paper;
  if (paper.access && !alternativePdf && Date.now() - Date.parse(paper.access.checkedAt) < 5 * 60_000) return paper;
  const seen = new Set<string>();
  async function tryPdf(url: string): Promise<Paper | null> {
    if (!url || seen.has(url)) return null;
    seen.add(url);
    try {
      const bytes = initialPdf && url === paper!.pdfUrl ? initialPdf : await download(url, signal);
      const extracted = await options.extract(bytes, PAPER_TEXT_LIMIT);
      signal.throwIfAborted();
      return savePaperSource(paper!.id, paper!.revision, { ...extracted, kind: "pdf", label: url, loadedAt: new Date().toISOString() });
    } catch (error) {
      signal.throwIfAborted();
      // A conflicting human upload/edit is not a download failure and must not be replaced.
      if (getPaper(paper!.id).revision !== paper!.revision) throw error;
      attempts.push({ url, error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500) });
      return null;
    }
  }
  for (const url of [alternativePdf ? paperUrl(alternativePdf) : "", paper.pdfUrl, ...knownPdfLinks(paper.url)]) {
    const loaded = await tryPdf(url); if (loaded) return loaded;
  }
  if (!landingRead) {
    try {
      const response = await fetchPage(paper.url, { signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) });
      const html = Buffer.from(await readPaperResponse(response, 2_000_000)).toString("utf8");
      const id = arxivId(paper.url);
      landing = id ? parseArxivPage(html, id) : paperPageMetadata(html, response.url || paper.url);
    } catch (error) {
      signal.throwIfAborted();
      attempts.push({ url: paper.url, error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500) });
    }
  }
  if (landing?.pdfUrl) { const loaded = await tryPdf(landing.pdfUrl); if (loaded) return loaded; }
  signal.throwIfAborted();
  return savePaperAccess(paper.id, paper.revision, attempts, [paper.url, paper.pdfUrl, ...seen].filter(Boolean));
}

export function paperReadText(paper: Paper): string { return paper.source?.text ?? paper.abstract; }
