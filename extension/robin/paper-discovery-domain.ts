import { setTimeout as delay } from "node:timers/promises";
import { canonicalPaperUrl, listPapers, paperProjects, paperText, paperUrl, PaperError } from "./papers-domain.ts";
import { getResearchProject } from "./research-domain.ts";
import { searchPaperCatalog, type CatalogPaper, type PaperCatalog } from "./paper-sources.ts";

export type VenueFilter = "all" | "nlp" | "ml" | "journals";
export interface DiscoveryInput { projectId: string; query: string; sources?: PaperCatalog[]; fromYear?: number; venue?: VenueFilter }
export interface DiscoveredPaper extends CatalogPaper {
  catalogs: PaperCatalog[]; abstractSource: string; score: number; queryMatches: string[]; projectMatches: string[];
  libraryId?: string; inProject: boolean; differentModality: boolean;
}
export interface PaperDiscovery {
  queries: string[]; projectTerms: string[]; results: DiscoveredPaper[];
  sources: { source: PaperCatalog; count: number; errors: string[] }[];
  found: number; filtered: number; fromYear?: number; venue: VenueFilter; searchedAt: string; scholarUrl: string;
}
const CATALOGS: PaperCatalog[] = ["arxiv", "crossref", "semantic-scholar"];
// Curated public terminology, not arbitrary regex supplied by the user. Raw project notes never leave the server.
const TOPICS: [RegExp, string][] = [
  [/hallucinat|幻觉|幻覺/i, "hallucination"], [/\bRAG\b|retrieval.augmented|检索增强|檢索增強/i, "retrieval augmented generation"],
  [/false.positive|\bFP(?:R)?\b|误报|誤報/i, "false positive"], [/consisten|一致性|自洽/i, "consistency"],
  [/\bNLI\b|natural.language.inference|蕴含|蘊含|自然语言推理|自然語言推理/i, "natural language inference"],
  [/atomic.fact|fact.level|原子事实|原子事實/i, "atomic facts"],
  [/sampl(?:ed|ing).{0,30}(?:answer|response)|alternative.answer|重复采样|重複採樣/i, "sampled answers"], [/uncertainty|不确定性|不確定性/i, "uncertainty"],
  [/calibrat|校准|校準/i, "calibration"], [/\bLLMs?\b|large.language.model|大语言模型|大語言模型/i, "large language models"],
  [/fact.check|事实核查|事實核查/i, "fact checking"], [/faithful|忠实|忠實/i, "faithfulness"],
  [/self.check|selfcheck/i, "selfcheck"], [/retriev|检索|檢索/i, "retrieval"],
];
const STOP = new Set("the a an and or for to of in on with by from is are be as this that these those its it my our your their we i do how why what which can using use based study research project current week focus improve improving compare paper papers literature find search detection".split(" "));
function topics(text: string) { return TOPICS.filter(([pattern]) => pattern.test(text)).map(([, term]) => term); }
function terms(text: string): string[] {
  return [...new Set([...topics(text), ...(text.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? []).filter((word) => !STOP.has(word))])].slice(0, 24);
}
const normalize = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
function matches(text: string, term: string) {
  const words = ` ${normalize(text)} `;
  return TOPICS.find(([, label]) => label === term)?.[0].test(text) || words.includes(` ${normalize(term)} `);
}
/** Public concept expansion only. Unrecognised project subjects require an explicit user query. */
export function discoveryQueries(query: string, brief: string, objective: string): string[] {
  if (query.trim()) {
    const input = query.trim();
    if (/https?:\/\//i.test(input)) throw new PaperError("Use keywords here; paste paper links in the reading conversation.");
    if (/[\u3400-\u9fff]/.test(input)) {
      const translated = [...new Set([...topics(input), ...(input.match(/[a-z][a-z0-9-]{2,}/gi) ?? []).filter((word) => !STOP.has(word.toLowerCase()))])];
      if (!translated.length) throw new PaperError("Please enter English scholarly keywords for this topic; no automatic translation is available.");
      const anchor = topics(brief)[0];
      if (anchor && !translated.includes(anchor)) translated.push(anchor);
      return [translated.slice(0, 3).join(" ")];
    }
    return [input];
  }
  const context = topics(`${brief} ${objective}`);
  if (!context.length) throw new PaperError("Enter scholarly keywords; this project's topic could not be mapped to public search terms.");
  const focus = topics(objective).find((term) => term !== context[0]);
  const broad = context[0] === "hallucination" && context.includes("retrieval augmented generation") ? "hallucination retrieval augmented generation"
    : context[0] === "hallucination" && context.includes("large language models") ? "hallucination language models" : context[0];
  return [...new Set([broad, `${context[0]} ${focus ?? context[1] ?? ""}`.trim()])];
}
const VENUES: Record<Exclude<VenueFilter, "all">, RegExp> = {
  nlp: /\b(ACL|EMNLP|NAACL|EACL|COLING|TACL)\b|association for computational linguistics|empirical methods in natural language processing|computational linguistics/i,
  ml: /\b(NeurIPS|NIPS|ICML|ICLR)\b|neural information processing systems|international conference on machine learning|international conference on learning representations/i,
  journals: /^(?:Nature\b|Science(?:$|\s+(?:Advances|Robotics|Immunology|Translational Medicine)\b))|\b(TACL|JMLR)\b|journal of machine learning research|transactions of the association for computational linguistics/i,
};
function keys(paper: CatalogPaper): string[] {
  const url = paper.url ? canonicalPaperUrl(paper.url) : "";
  const doi = paper.doi ?? (url.startsWith("https://doi.org/") ? decodeURIComponent(url.slice(16)) : "");
  const title = normalize(paper.title), author = normalize(paper.authors[0] ?? "").split(" ").at(-1);
  return [...(url ? [url] : []), ...(/^10\.\d{4,9}\/\S+$/i.test(doi) ? [`doi:${doi.toLowerCase()}`] : []),
    ...(title.length >= 24 && author ? [`title:${title}:${author}`] : [])];
}
function clean(paper: CatalogPaper): CatalogPaper {
  return { title: paperText(paper.title, 1000, true), url: canonicalPaperUrl(paper.url), authors: paper.authors.slice(0, 100).map((s) => paperText(s, 300)),
    year: paperText(paper.year, 10), abstract: paperText(paper.abstract, 30_000), pdfUrl: paperUrl(paper.pdfUrl, true), provider: paperText(paper.provider, 100),
    ...(paper.doi ? { doi: paperText(paper.doi, 300) } : {}), ...(paper.venue ? { venue: paperText(paper.venue, 500) } : {}) };
}

// Only public catalog metadata is cached, never a project profile or its rankings. Bounded, process-local cache.
const cache = new Map<string, { at: number; papers: CatalogPaper[] }>();
let arxivQueue: Promise<void> = Promise.resolve(), nextArxiv = 0;
async function cachedSearch(source: PaperCatalog, query: string, signal: AbortSignal): Promise<CatalogPaper[]> {
  const key = `${source}:${query}`, previous = cache.get(key);
  if (previous && Date.now() - previous.at < 10 * 60_000) return structuredClone(previous.papers);
  if (source === "arxiv") {
    const wait = arxivQueue.then(async () => { signal.throwIfAborted(); await delay(Math.max(0, nextArxiv - Date.now()), undefined, { signal }); nextArxiv = Date.now() + 3100; });
    arxivQueue = wait.catch(() => {}); await wait;
  }
  signal.throwIfAborted();
  const papers = await searchPaperCatalog(source, query, signal);
  if (cache.size >= 100) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: Date.now(), papers });
  return structuredClone(papers);
}

export async function discoverPapers(input: DiscoveryInput, signal?: AbortSignal,
  search: (source: PaperCatalog, query: string, signal: AbortSignal) => Promise<CatalogPaper[]> = cachedSearch): Promise<PaperDiscovery> {
  if (!input || typeof input !== "object") throw new PaperError("Invalid paper search");
  const project = getResearchProject(paperText(input.projectId, 100, true));
  const query = paperText(input.query, 500).trim();
  const sources = input.sources ?? CATALOGS;
  if (!Array.isArray(sources) || !sources.length || sources.length > 3 || sources.some((s) => !CATALOGS.includes(s))) throw new PaperError("Choose supported paper catalogs");
  const year = input.fromYear;
  if (year !== undefined && (!Number.isInteger(year) || year < 1900 || year > new Date().getFullYear() + 1)) throw new PaperError("Invalid publication year");
  const venue = input.venue ?? "all";
  if (venue !== "all" && !Object.hasOwn(VENUES, venue)) throw new PaperError("Unknown venue filter");
  const queries = discoveryQueries(query, project.brief, project.objective);
  const context = `${project.objective} ${project.brief}`;
  const concepts = topics(context);
  const projectTerms = concepts.length ? concepts : terms(context);
  const queryTerms = terms(queries.join(" "));
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(32_000)]) : AbortSignal.timeout(32_000);
  const records: { paper: CatalogPaper; source: PaperCatalog }[] = [];
  const statuses = await Promise.all([...new Set(sources)].map(async (source) => {
    const status = { source, count: 0, errors: [] as string[] };
    for (const q of queries) {
      try {
        const papers = await search(source, q, requestSignal);
        for (const raw of papers.slice(0, 12)) {
          try { records.push({ paper: clean(raw), source }); status.count++; }
          catch { status.errors.push("Invalid catalog record omitted"); }
        }
      } catch (error) {
        signal?.throwIfAborted();
        status.errors.push(error instanceof Error ? error.message.slice(0, 300) : "Catalog unavailable");
        break; // Do not immediately repeat a rate-limited/failed provider request.
      }
    }
    status.errors = [...new Set(status.errors)];
    return status;
  }));
  signal?.throwIfAborted();
  // At most 72 candidates. Union all aliases, including a bridge linking DOI and preprint groups.
  const groups: { aliases: Set<string>; records: typeof records }[] = [];
  for (const record of records) {
    const aliases = new Set(keys(record.paper));
    const intersecting = groups.filter((group) => [...aliases].some((key) => group.aliases.has(key)));
    const merged = { aliases, records: [record] };
    for (const group of intersecting) { group.aliases.forEach((key) => aliases.add(key)); merged.records.push(...group.records); groups.splice(groups.indexOf(group), 1); }
    groups.push(merged);
  }
  const library = listPapers().map((paper) => ({ paper, aliases: keys(paper) }));
  const results = groups.map(({ aliases, records: rows }): DiscoveredPaper => {
    // Stable provider preference; network completion order must not change the chosen publication.
    rows.sort((a, b) => Number(b.paper.url.startsWith("https://doi.org/")) - Number(a.paper.url.startsWith("https://doi.org/")) || CATALOGS.indexOf(a.source) - CATALOGS.indexOf(b.source) || a.paper.url.localeCompare(b.paper.url));
    const primary = rows[0].paper;
    const abstract = rows.reduce((a, b) => b.paper.abstract.length > a.paper.abstract.length ? b : a).paper;
    const paper = { ...primary, abstract: abstract.abstract, pdfUrl: rows.find((r) => r.paper.pdfUrl)?.paper.pdfUrl ?? "", venue: rows.find((r) => r.paper.venue)?.paper.venue ?? "" };
    const text = `${paper.title} ${paper.abstract}`;
    const queryMatches = queryTerms.filter((term) => matches(text, term));
    const projectMatches = projectTerms.filter((term) => matches(text, term));
    const vision = /vision.language|visual.language|\b(?:LVLM|VLM)s?\b|\b(?:image|object) hallucination|multimodal/i;
    const differentModality = projectTerms.some((term) => ["hallucination", "retrieval augmented generation", "large language models"].includes(term)) && !vision.test(context) && vision.test(paper.title);
    const relevance = queryMatches.reduce((n, term) => n + (matches(paper.title, term) ? 2 : 1), 0) + projectMatches.reduce((n, term) => n + (matches(paper.title, term) ? 6 : 4), 0);
    // A visible transfer caveat, not an exclusion: visual hallucination papers may still offer useful methods.
    const score = differentModality ? Math.floor(relevance / 3) : relevance;
    const existing = library.find((item) => item.aliases.some((key) => aliases.has(key)))?.paper;
    return { ...paper, catalogs: CATALOGS.filter((s) => rows.some((r) => r.source === s)), abstractSource: abstract.provider,
      score, queryMatches, projectMatches, differentModality, libraryId: existing?.id, inProject: !!existing && paperProjects(existing).includes(project.id) };
  });
  const filtered = results.filter((paper) => (!year || (/^\d{4}$/.test(paper.year) && Number(paper.year) >= year)) && (venue === "all" || (!!paper.venue && VENUES[venue].test(paper.venue))));
  filtered.sort((a, b) => b.score - a.score || (Number(b.year) || 0) - (Number(a.year) || 0) || a.title.localeCompare(b.title));
  return { queries, projectTerms, results: filtered, sources: statuses, found: groups.length, filtered: results.length - filtered.length, fromYear: year, venue,
    searchedAt: new Date().toISOString(), scholarUrl: `https://scholar.google.com/scholar?${new URLSearchParams({ q: queries[0] })}` };
}
