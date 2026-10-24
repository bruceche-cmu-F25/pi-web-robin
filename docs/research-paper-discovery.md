# Project-aware paper discovery

## Behaviour

Research home and every project have a dedicated search bar inside **Find papers in scholarly catalogs**, a collapsed section below the reading conversation. It is separate from the conversation composer and the library's local filter. This is **candidate discovery and title/abstract screening**, not a claim to have read or verified a paper.

1. Enter English scholarly keywords, or leave the query blank in a project. Before searching, flush pending project focus/notebook edits; a failed save blocks the search so it cannot rank against an older focus. Home requires a query.
2. Blank searches derive up to two queries from a curated public-term vocabulary matched locally against the project brief/current objective. For HEAT this includes a RAG/hallucination angle and a false-positive angle. Raw project text, notebook contents, links and chat history are never sent to catalog providers. Explicit user queries are sent to the chosen providers; recognised Chinese research terms have glossary expansion, **not general-purpose translation**. Unknown topics require explicit English keywords. Actual outbound queries are displayed.
3. Search independent public APIs: arXiv, Crossref and Semantic Scholar. Each has its own count/error status. A failed or rate-limited source does not discard successful sources; all sources failing is visibly different from no matches. No Google Scholar scraping, CAPTCHA bypass or unofficial proxy: a labelled manual Scholar link supplements the API results.
4. Deduplicate by canonical URL/DOI, or sufficiently long normalised title plus first-author surname. Preserve all catalog origins, available abstract/PDF/venue information and the abstract's provider. Join candidates to existing library IDs using these aliases, so an already-saved preprint can be opened/filed without overwriting notes or creating a DOI duplicate.
5. Rank locally by query and project-concept matches in titles/abstracts, with title matches and project concepts weighted more strongly. If no curated concepts are recognised, project lexical terms are used. Explain matches instead of presenting a calibrated relevance probability. A title indicating visual/multimodal hallucination is down-ranked, **not excluded**, if those settings are absent from the project's stated goals; show that caveat. This is not an LLM judge, semantic understanding, a systematic-review inclusion decision or active learning.
6. Optional start-year and named venue-family filters apply **within the bounded retrieved set**, not exhaustively across the publishers. NLP includes ACL-family/COLING name matches; ML includes NeurIPS/ICML/ICLR; journal presets include TACL/JMLR/Nature/selected Science-family names. Match the catalog's venue field, never a title mentioning a conference. Unknown year/venue is excluded only when that filter is active. Venue metadata is not a guarantee of peer review or paper quality; Crossref also indexes preprints.
7. Results include origin links, year, venue, matched terms, expandable original abstract, missing-abstract warnings, existing-library status and available PDF links. Show six at a time, with more on demand and a collapse control. Search/filter drafts remain after failures/cancellation. Switching projects aborts the search and cannot publish its late response in another project's view.
8. **Add and open** explicitly adds to the selected project's library (or files an existing paper through its ID) and opens the existing paper sheet. Only a subsequent reading request invokes the research agent and its paper-first tutorial. Search alone does not insert papers, create conversations, start model work, alter the notebook or publish to Obsidian. No recurring scan or background subscription is created.

Catalog search opens on demand so the conversation composer remains the primary entry. With catalogs closed, the desktop focus/composer/first starters fit the first 900px viewport. Filters/privacy detail expand on demand; the redundant populated-project welcome paragraph is omitted. Inputs remain 16px, touch controls 44px, long titles wrap, and result rows use the existing document/hairline tokens in light and dark modes.

## Implementation and limits

- `extension/robin/paper-discovery-domain.ts` owns query planning, validation, provider coordination, deduplication, profile ranking, filters and library joins. It reads project/library domain interfaces, never their storage files.
- `paper-sources.ts` owns bounded DNS-pinned catalog fetches and parsers; existing agent `searchPapers` and the legacy GET search retain their original behaviour.
- `POST /api/research/papers/search` takes `{ projectId, query, sources?, fromYear?, venue? }`; it is an origin-guarded JSON adapter with an 8KB body bound and private/no-store results. Existing GET remains compatible.
- `ResearchDiscovery.tsx` is shared by project/home. Candidate selection reuses existing library POST/PATCH and paper navigation; model tool capabilities are unchanged.
- Up to 2 queries × 3 sources × 12 records = 72 raw candidates. The whole request has a 32-second budget, individual catalog fetches 12 seconds, decompressed responses 2MB. arXiv request starts are spaced at least 3.1 seconds within this process. A failed provider is not immediately retried for the next query. Success metadata is cached for ten minutes in a bounded 100-entry process-local map; project profiles/rankings are not cached. No durable search history or new storage schema.
- No API credentials are required by this implementation. Anonymous Semantic Scholar/Crossref requests can be rate-limited; errors remain visible. Repeated manual searches are not an exhaustive literature review. Snapshot results reflect the goals at search time; search again after changing the focus.
- Original uploaded PDFs, previous analyses, notebook captures and Obsidian notes are untouched. No automatic backfill or LLM scoring pass.

## Research behind the design

Visited during implementation:

- [ASReview screening workflow](https://asreview.readthedocs.io/en/stable/lab/screening.html): reviewer-labelled title/abstract screening and prioritisation. Borrowed the separation of candidate retrieval, screening and full-text assessment—not its trained active-learning model.
- [Semantic Scholar API tutorial](https://www.semanticscholar.org/product/api/tutorial): paper search and explicitly selected metadata fields.
- [Crossref REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/): publisher-deposited bibliographic metadata, venue names, abstracts where available and DOI identity; no signup required.
- [arXiv API manual](https://info.arxiv.org/help/api/user-manual.html): Atom query results and polite request spacing.
- [Google Scholar help](https://scholar.google.com/intl/en/scholar/help.html): automated clients must respect robots.txt; no bulk-record access. Scholar remains a manual supplementary search.

## Validation

```sh
node --import ./scripts/test-style-stub.mjs --experimental-strip-types --test extension/robin/paper-discovery-domain.test.mjs extension/robin/paper-sources.test.mjs app/api/research/papers/search/route.test.mjs
node --env-file-if-exists=.env.local e2e/research-discovery.mjs
node --env-file-if-exists=.env.local e2e/research-reading-room.mjs
node --env-file-if-exists=.env.local e2e/research-sessions.mjs
node_modules/.bin/tsc --noEmit
npm run lint
```

Domain tests use temporary projects/papers and fake catalogs; HTTP tests verify origin/body/scope guards. Browser tests mock every research endpoint and cover focus flush, scoped filters, partial failures, empty/all-failed states, cancellation, late project-switch responses, safe existing-paper filing, and desktop/320px/375px/landscape/dark layouts. Tests invoke no model or vault writes. A real read-only HEAT search also returned arXiv/Crossref candidates while reporting Semantic Scholar HTTP 429; this demonstrates provider connectivity, **not expert relevance assessment or full-text quality**.
