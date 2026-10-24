"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { Paper } from "@/extension/robin/papers-domain";
import type { PaperCatalog } from "@/extension/robin/paper-sources";
import type { DiscoveredPaper, PaperDiscovery, VenueFilter } from "@/extension/robin/paper-discovery-domain";
import { researchJson, researchRequest } from "./research-client";
import s from "./ResearchWorkspace.module.css";

const CATALOGS: [PaperCatalog, string][] = [["arxiv", "arXiv"], ["crossref", "Crossref"], ["semantic-scholar", "Semantic Scholar"]];

/** Discovery is metadata screening, not a reading/model turn. Only an explicit add changes the library. */
export function ResearchDiscovery({ projectId, general = false, beforeSearch, onAdded, onOpen }: {
  projectId: string; general?: boolean; beforeSearch: () => Promise<void>; onAdded: () => void; onOpen: (id: string) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const [query, setQuery] = useState("");
  const [sources, setSources] = useState<PaperCatalog[]>(CATALOGS.map(([key]) => key));
  const [year, setYear] = useState("");
  const [venue, setVenue] = useState<VenueFilter>("all");
  const [result, setResult] = useState<PaperDiscovery | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [limit, setLimit] = useState(6);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState("");
  const [error, setError] = useState("");
  const control = useRef<AbortController | null>(null);
  const mounted = useRef(true), scope = useRef(projectId); scope.current = projectId;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; control.current?.abort(); }; }, []);
  async function search() {
    if (control.current || adding || !sources.length || (general && !query.trim())) return;
    const controller = new AbortController(), origin = projectId; control.current = controller;
    setBusy(true); setError(""); setResult(null);
    try {
      await beforeSearch(); controller.signal.throwIfAborted();
      const next = await researchRequest<PaperDiscovery>("/api/research/papers/search", researchJson("POST", {
        projectId: origin, query, sources, ...(year ? { fromYear: Number(year) } : {}), venue,
      }, controller.signal));
      if (!mounted.current || scope.current !== origin || controller.signal.aborted) return;
      setResult(next); setExpanded(true); setLimit(6);
    } catch (failure) {
      if (mounted.current && scope.current === origin && !controller.signal.aborted) setError(failure instanceof Error ? failure.message : t("rw.error"));
    } finally {
      if (control.current === controller) { control.current = null; if (mounted.current) setBusy(false); }
    }
  }
  async function add(paper: DiscoveredPaper) {
    if (adding || busy) return;
    const origin = projectId;
    setAdding(paper.url); setError("");
    try {
      const saved = paper.inProject && paper.libraryId ? { paper: { id: paper.libraryId } }
        : paper.libraryId ? await researchRequest<{ paper: Paper }>("/api/research/papers", researchJson("PATCH", { id: paper.libraryId, addToProject: origin }))
        : await researchRequest<{ paper: Paper }>(`/api/research/papers?project=${encodeURIComponent(origin)}`, researchJson("POST", paper));
      if (!mounted.current || scope.current !== origin) return;
      setResult((current) => current && ({ ...current, results: current.results.map((p) => p.url === paper.url ? { ...p, libraryId: saved.paper.id, inProject: true } : p) }));
      onAdded(); onOpen(saved.paper.id);
    } catch (failure) { if (mounted.current && scope.current === origin) setError(failure instanceof Error ? failure.message : t("rw.error")); }
    finally { if (mounted.current && scope.current === origin) setAdding(""); }
  }
  return <section className={s.discovery} aria-labelledby={`${id}-title`}>
    <h2 id={`${id}-title`} className="sr-only">{t("rw.discovery.title")}</h2>
    <form role="search" aria-label={t("rw.discovery.title")} onSubmit={(event) => { event.preventDefault(); void search(); }}>
      <label className="sr-only" htmlFor={`${id}-query`}>{t("rw.discovery.query")}</label>
      <div className={s.discoveryBar}>
        <input id={`${id}-query`} type="search" value={query} maxLength={500} onChange={(event) => setQuery(event.target.value)}
          placeholder={t(general ? "rw.discovery.placeholder" : "rw.discovery.projectPlaceholder")} aria-describedby={`${id}-hint`} />
        <button className={`${s.button} ${s.primary}`} disabled={busy || !!adding || !sources.length || (general && !query.trim())}>{t(busy ? "rw.discovery.searching" : "rw.discovery.search")}</button>
        {busy && <button type="button" className={s.textButton} onClick={() => { control.current?.abort(); control.current = null; setBusy(false); }}>{t("rw.cancel")}</button>}
      </div>
      <details className={s.discoveryFilters}>
        <summary>{t("rw.discovery.filters")}</summary>
        <p id={`${id}-hint`} className={s.discoveryHint}>{t("rw.discovery.hint")}</p>
        <fieldset disabled={busy}><legend>{t("rw.discovery.sources")}</legend>
          <div className={s.discoveryOptions}>{CATALOGS.map(([key, name]) => <label key={key}><input type="checkbox" checked={sources.includes(key)} onChange={(event) => setSources((current) => event.target.checked ? [...current, key] : current.filter((value) => value !== key))} />{name}</label>)}</div>
        </fieldset>
        <div className={s.discoveryOptions}>
          <label>{t("rw.discovery.year")}<input type="number" min={1900} max={new Date().getFullYear() + 1} step={1} value={year} placeholder={t("rw.discovery.anyYear")} onChange={(event) => setYear(event.target.value)} disabled={busy} /></label>
          <label>{t("rw.discovery.venue")}<select aria-label={t("rw.discovery.venue")} value={venue} onChange={(event) => setVenue(event.target.value as VenueFilter)} disabled={busy}>
            {(["all", "nlp", "ml", "journals"] as const).map((key) => <option key={key} value={key}>{t(`rw.discovery.venue.${key}`)}</option>)}
          </select></label>
        </div>
        <p className={s.discoveryHint}>{t("rw.discovery.filterHint")}</p>
      </details>
    </form>
    {busy && <p role="status" className={s.discoveryHint}>{t("rw.discovery.searchingHint")}</p>}
    <p className="sr-only" role="status">{result ? t("rw.discovery.count", { count: result.results.length, found: result.found }) : ""}</p>
    {error && <p role="alert" className={s.error}>{error}</p>}
    {result && <>
      <div className={s.discoveryResultHead}>
        <button type="button" className={s.textButton} aria-expanded={expanded} aria-controls={`${id}-results`} onClick={() => setExpanded(!expanded)}>
          {t("rw.discovery.count", { count: result.results.length, found: result.found })} {expanded ? "▴" : "▾"}
        </button>
        <a href={result.scholarUrl} target="_blank" rel="noopener noreferrer" className={s.textButton}>{t("rw.discovery.scholar")} ↗</a>
      </div>
      <div id={`${id}-results`} hidden={!expanded}>
        <p className={s.discoveryHint}>{t("rw.discovery.queries")} {result.queries.join(" · ")}</p>
        <p className={s.discoveryHint}>{t(`rw.discovery.venue.${result.venue}`)}{result.fromYear ? ` · ${result.fromYear}+` : ""} · {t("rw.discovery.ranking")}</p>
        <ul className={s.discoverySources}>{result.sources.map((source) => <li key={source.source}>
          {CATALOGS.find(([key]) => key === source.source)?.[1]} · {source.count}
          {!!source.errors.length && <span role="status" className={s.error}> — {source.errors.join("; ")}</span>}
        </li>)}</ul>
        {result.filtered > 0 && <p className={s.discoveryHint}>{t("rw.discovery.filtered", { count: result.filtered })}</p>}
        {!result.results.length && <p role="status" className={s.discoveryHint}>{t(result.sources.every((source) => source.errors.length > 0 && !source.count) ? "rw.discovery.unavailable" : "rw.discovery.empty")}</p>}
        <ol className={s.discoveryResults}>{result.results.slice(0, limit).map((paper) => <li key={paper.url}>
          <article>
            <h3><a href={paper.url} target="_blank" rel="noopener noreferrer">{paper.title} ↗</a></h3>
            <p className={s.discoveryHint}>{[paper.year, paper.venue || t("rw.discovery.unknownVenue"), paper.authors.slice(0, 3).join(", ")].filter(Boolean).join(" · ")}</p>
            <p className={s.discoveryHint}>{paper.catalogs.map((key) => CATALOGS.find(([value]) => value === key)?.[1]).join(" / ")}{paper.inProject ? ` · ${t("rw.discovery.inProject")}` : paper.libraryId ? ` · ${t("rw.discovery.inLibrary")}` : ""}</p>
            <p className={s.discoveryMatches}>{paper.projectMatches.length ? `${t("rw.discovery.projectMatches")} ${paper.projectMatches.join(" · ")}` : t("rw.discovery.noProjectMatch")}</p>
            {paper.differentModality && <p className={s.discoveryHint}>{t("rw.discovery.differentModality")}</p>}
            {!!paper.queryMatches.length && <p className={s.discoveryHint}>{t("rw.discovery.queryMatches")} {paper.queryMatches.join(" · ")}</p>}
            {paper.abstract ? <details className={s.discoveryAbstract}><summary>{t("rw.discovery.abstract")} · {paper.abstractSource}</summary><p>{paper.abstract}</p></details>
              : <p className={s.discoveryHint}>{t("rw.discovery.noAbstract")}</p>}
            <div className={s.discoveryResultHead}>
              <button type="button" className={s.button} disabled={!!adding || busy} onClick={() => void add(paper)}>{t(adding === paper.url ? "rw.saving" : paper.inProject ? "rw.discovery.open" : "rw.discovery.add")}</button>
              {paper.pdfUrl && <a className={s.textButton} href={paper.pdfUrl} target="_blank" rel="noopener noreferrer">PDF ↗</a>}
            </div>
          </article>
        </li>)}</ol>
        {limit < result.results.length && <button type="button" className={s.button} onClick={() => setLimit((n) => n + 6)}>{t("rw.discovery.more")}</button>}
      </div>
    </>}
  </section>;
}
