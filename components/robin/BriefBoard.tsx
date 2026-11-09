"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useI18n } from "@/hooks/useI18n";
import type { BriefEdition, BriefEditorial, BriefItem } from "@/extension/robin/brief";
import { usePolledResource } from "./usePolledResource";
import { briefCoverageSummary, briefLocalTimestamp, homeBriefHighlights } from "./brief-reading";
import styles from "./BriefBoard.module.css";

interface BriefView {
  initialized: boolean;
  edition: BriefEdition | null;
  editions?: { id: string; time: string }[];
  notification: { id: string; title: string; body: string; url: string } | null;
}
const API = "/api/robin/brief";
const REQUEST_KEY = "robin-brief-editor-request-v2";
const SECTIONS = ["actions", "personal", "world"] as const;
function sectionRows(editorial: BriefEditorial, section: typeof SECTIONS[number], edition: BriefEdition) {
  const failed = new Set(edition.mailReport?.messages.filter(message => !message.reviewed).map(message => message.href));
  return editorial.items.filter(row =>
    (section === "actions" ? row.actionable : section === "personal" ? row.section === "personal" && !row.actionable : row.section === "world")
    && !row.sourceIds.some(id => edition.items.some(item => item.id === id && item.source === "mail" && failed.has(item.href))));
}

/** Labels come from saved sources, not guessed urgency or keywords in model prose. */
function BriefItemMeta({ edition, row, lead = false }: { edition: BriefEdition; row: BriefEditorial["items"][number]; lead?: boolean }) {
  const { t } = useI18n();
  const sources = row.sourceIds.map(id => edition.items.find(item => item.id === id)).filter((item): item is BriefItem => Boolean(item));
  const kinds = [...new Set(sources.map(item => item.source))];
  const deadlines = [...new Set(sources.flatMap(item => item.due ? [item.due] : []))];
  return <div className={styles.itemMeta}>
    {lead && <span className={styles.leadLabel}>{t("brief.readFirst")}</span>}
    {kinds.map(source => <span key={source} className={styles.sourceTag} data-brief-source={source}>{t(`brief.source.${source}`)}</span>)}
    {deadlines.map(due => <span key={due} className={styles.deadline}>{t("brief.recordedDue")} <time dateTime={due}>{due}</time></span>)}
  </div>;
}

export function BriefBoard({ active = true, compact = false, today }: { active?: boolean; compact?: boolean; today?: string }) {
  const { t, locale } = useI18n();
  const search = useSearchParams();
  const selected = compact ? null : search.get("edition");
  const resource = usePolledResource<BriefView>(`${API}${selected ? `?edition=${encodeURIComponent(selected)}` : ""}`, 60_000, active);
  // A URL change must not briefly show a different version under an exact edition address.
  const edition = resource.data?.edition && (!selected || resource.data.edition.id === selected) ? resource.data.edition : null;
  const editorial = edition?.editorial;
  const [consent, setConsent] = useState(false);
  const [input, setInput] = useState<"stored" | "gmail" | "live">("stored");
  const automation = usePolledResource<{ run?: { day: string; stage: string; interrupted: boolean } | null; schedule: { time: string; startDate: string; mailOnly?: boolean; morningDaily?: boolean; timezone?: string } | null; receipts: { edition_id: string; state: string; attempts: number; accepted: number }[] }>(`${API}/tick`, 60_000, active && !compact);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [savedId, setSavedId] = useState<string | null>(null);
  const inFlight = useRef(false), mounted = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const generationOptions = useRef<HTMLDetailsElement>(null);
  const receiptLink = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    mounted.current = true;
    if (!compact) try {
      const saved = JSON.parse(sessionStorage.getItem(REQUEST_KEY) ?? "null");
      if (saved && typeof saved.id === "string" && /^[a-zA-Z0-9:_-]{3,120}$/.test(saved.id) && (saved.input === "stored" || saved.input === "gmail" || saved.input === "live")) {
        setRequestId(saved.id); setInput(saved.input);
      }
    } catch { /* Storage may be unavailable. */ }
    return () => { mounted.current = false; controller.current?.abort(); };
  }, [compact]);
  const href = (id?: string) => {
    const params = new URLSearchParams({ feed: "brief" });
    if (id) params.set("edition", id);
    for (const key of ["session", "cwd"]) { const value = search.get(key); if (value) params.set(key, value); }
    return `/dashboard/gmail?${params}`;
  };
  const sourceHref = (path: string) => {
    if (!path.startsWith("/") || path.startsWith("//")) return path;
    const url = new URL(path, "https://robin.invalid");
    for (const key of ["session", "cwd"]) { const value = search.get(key); if (value) url.searchParams.set(key, value); }
    return url.pathname + url.search + url.hash;
  };
  const generate = async () => {
    if (!consent || inFlight.current) return;
    inFlight.current = true; setBusy(true); setActionError("");
    const id = requestId ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
    setRequestId(id);
    try { sessionStorage.setItem(REQUEST_KEY, JSON.stringify({ id, input })); } catch { /* Server request identity still applies. */ }
    const abort = new AbortController(); controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 125_000);
    try {
      const response = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, signal: abort.signal,
        body: JSON.stringify({ action: "compose", requestId: id, input, allowPrivateModel: true }) });
      const view = await response.json() as BriefView & { error?: string };
      if (!response.ok || !view.edition?.editorial) throw new Error(view.error || t("brief.failed"));
      if (!mounted.current) return;
      const restoreFocus = generationOptions.current?.contains(document.activeElement);
      setSavedId(view.edition.id);
      if (generationOptions.current) generationOptions.current.open = false;
      if (restoreFocus) requestAnimationFrame(() => { if (mounted.current) receiptLink.current?.focus(); });
      // Completion must never race a pending navigation or replace a pinned edition.
      // The receipt opens the saved version explicitly; refreshing reads the current URL scope.
      void resource.refresh();
    } catch (error) {
      if (mounted.current) setActionError(`${t("brief.failed")} ${error instanceof Error && error.name !== "AbortError" ? error.message : ""}`);
    } finally {
      clearTimeout(timeout); inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const version = edition && t("brief.version", { date: edition.day, revision: String(edition.revision) });
  if (compact) {
    if (!edition || !editorial || resource.error || !today || edition.day !== today) return null;
    const highlights = homeBriefHighlights(edition);
    const news = editorial.items.filter(row => row.section === "world" && row.sourceIds.some(id => edition.items.some(item => item.id === id && item.evidence.kind !== "legacy-passage"))).length;
    const gaps = edition.mailReport?.failed ?? 0;
    const remaining = Math.max(0, (edition.mailReport?.messages.filter(message => message.reviewed && message.priority === 2).length ?? 0) - highlights.length);
    const partial = edition.coverage.some(source => source.coverage !== "ready");
    if (!highlights.length && !news && !gaps && !partial) return null;
    return <section className={styles.preview} aria-label={t("brief.title")} data-brief-edition={edition.id}>
      <header><h2 className="pi-section-title">{t("brief.homeTitle")}</h2><span>{edition.deliveryTime === "08:00" ? t("brief.morning") : edition.deliveryTime === "18:00" ? t("brief.evening") : edition.day}</span></header>
      {highlights.length > 0 && <ul data-count={highlights.length}>{highlights.map((item, index) => <li key={`${item.href}:${index}`}>
        <a href={sourceHref(item.href)} target="_blank" rel="noopener noreferrer">{item.text}</a>
      </li>)}</ul>}
      <div className={styles.previewFooter}>
        {remaining > 0 && <span>{t("brief.homeMore", { count: String(remaining) })}</span>}
        {gaps > 0 && <span>{t("brief.homeUnreviewed", { count: String(gaps) })}</span>}
        {news > 0 && <span>{t("brief.homeNews", { count: String(news) })}</span>}
        {!gaps && partial && <span>{t("brief.coverageShort")}</span>}
        <Link href={href(edition.id)} prefetch={false}>{t("brief.open")} <span aria-hidden="true">↗</span></Link>
      </div>
    </section>;
  }
  const partial = editorial && (editorial.omittedCount > 0 || edition?.coverage.some(source => source.coverage !== "ready"));
  const receipt = automation.data?.receipts?.find(row => row.edition_id === edition?.id);
  return <main className={`robin-page ${styles.board}`} data-brief-edition={edition?.id ?? ""}>
    <div className={styles.content}>
      <header className={styles.masthead}>
        <div className={styles.dateline}><span>{t("brief.title")}</span>{version && <span>{version}</span>}</div>
        <h1 className="pi-page-title">{edition?.kind === "daily" ? t("brief.personalDaily") : editorial?.headline ?? t("brief.title")}</h1>
        {editorial && <p className={styles.byline}>{t("brief.byline")}</p>}
        {resource.data?.editions && resource.data.editions.length > 0 && <nav className={styles.editionNav} aria-label={t("brief.editions")}>
          {["08:00", "18:00"].map(time => {
            const entry = resource.data!.editions!.find(row => row.time === time);
            return entry && <Link key={time} href={href(entry.id)} prefetch={false} aria-current={edition?.id === entry.id ? "page" : undefined}>{t(time === "08:00" ? "brief.morning" : "brief.evening")}</Link>;
          })}
        </nav>}
        <div className={styles.toolbar}>
          {partial && <a href="#brief-coverage">{t("brief.coverageShort")}</a>}
          {selected && <Link href={href()} prefetch={false}>{t("brief.latest")}</Link>}
          <button className="ui-action" type="button" onClick={() => void resource.refresh()}>{t("brief.refresh")}</button>
        </div>
      </header>
      {(resource.error || actionError) && <p role="alert" className={styles.error}>{resource.error || actionError}</p>}
      {resource.loading && !resource.data && <p role="status">{t("weekly.loading")}</p>}
      {resource.data && !resource.data.initialized && <p className={styles.notice}>{t("brief.setup")}</p>}
      {!resource.loading && !editorial && <p>{t("brief.empty")}</p>}
      {busy && <p role="status">{t("brief.busy")}</p>}
      {savedId && <p role="status"><Link ref={receiptLink} href={href(savedId)} prefetch={false}>{t("brief.saved")}</Link></p>}
      {edition && editorial && <>
        {edition.deliveryTime === "18:00" && edition.mailReport && <p className={styles.scopeNote}>{t("brief.eveningScope")}</p>}
        {edition.mailReport && <p className={styles.mailWindow}>{t("brief.mailWindow", {
          from: briefLocalTimestamp(edition.mailReport.from, locale) ?? "", to: briefLocalTimestamp(edition.mailReport.to, locale) ?? "",
          total: String(edition.mailReport.total), reviewed: String(edition.mailReport.reviewed), failed: String(edition.mailReport.failed),
        })} {edition.mailReport.failed > 0 && <a href="#brief-mail-report">{t("brief.homeUnreviewed", { count: String(edition.mailReport.failed) })} →</a>}</p>}
        {editorial.items.length === 0 && <p>{t(edition.mailReport?.total === 0 && edition.kind !== "daily" ? "brief.mailEmpty" : "brief.noSelection")}</p>}
        {SECTIONS.map(section => {
          const rows = sectionRows(editorial, section, edition);
          return rows.length > 0 && <section key={section} className={styles.section} data-brief-section={section}>
            <h2 className="pi-section-title">{t(section === "world" && rows.every(row => row.sourceIds.every(id => edition.items.find(item => item.id === id)?.evidence.kind === "legacy-passage")) ? "brief.background" : section === "personal" && edition.kind === "daily" ? "brief.personalDaily" : `brief.${section}`)} <span className={styles.count}>{rows.length}</span></h2>
            {rows.map((row, index) => {
              const lead = index === 0 && (section === "actions" || (section === "personal" && !sectionRows(editorial, "actions", edition).length) || (section === "world" && !sectionRows(editorial, "personal", edition).length && !sectionRows(editorial, "actions", edition).length));
              return <article key={row.sourceIds.join(":")} className={styles.item} data-brief-item={section} data-brief-lead={lead}>
                <div className={styles.itemHeading}><span className={styles.ordinal} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><h3 className={styles.what}>{row.what}</h3></div>
                <BriefItemMeta edition={edition} row={row} lead={lead} />
                {row.actionable && row.sourceIds.map(id => edition.items.find(item => item.id === id)).filter((item): item is BriefItem => Boolean(item)).map(item =>
                  <a key={item.id} href={sourceHref(item.href)} target="_blank" rel="noopener noreferrer">{t("brief.openSource")} · {item.title}</a>)}
                {row.why && <p className={styles.interpretation}><span className={styles.label}>{t("brief.interpretation")}</span>{row.why}</p>}
                {row.suggestion && <div className={styles.suggestion}><span className={styles.label}>{t("brief.suggestion")}</span><p>{row.suggestion}</p></div>}
                {row.caveat && <p className={styles.caveat}>{row.caveat}</p>}
                {section === "world" && <p className={styles.muted}>{row.sourceIds.map(id => edition.items.find(item => item.id === id)).filter(Boolean).map(item => `${item!.publishedOn ?? item!.eventDate ?? ""}${item!.evidence.kind === "legacy-passage" ? ` · ${t("brief.historical")}` : ""}`).join(" / ")}</p>}
                <details><summary>{t("brief.evidence")}</summary>
                  {row.quotes.map(q => { const source = edition.items.find(item => item.id === q.sourceId); return source && <div key={q.sourceId} className={styles.evidence}>
                    <a href={sourceHref(source.href)} target="_blank" rel="noopener noreferrer">{source.title}</a>
                    <small>{[t(`brief.evidenceKind.${source.evidence.kind}`), source.publishedOn ?? source.eventDate ?? (source.evidence.checkedAt ? briefLocalTimestamp(source.evidence.checkedAt, locale) : null) ?? (source.due ? t("daily.deadline", { date: source.due }) : undefined)].filter(Boolean).join(" · ")}</small>
                    <blockquote>{q.quote}</blockquote>
                  </div>; })}
                </details>
              </article>;
            })}
          </section>;
        })}
        {edition.mailReport && <details id="brief-mail-report" className={styles.coverage} data-mail-report>
          <summary>{t("brief.allMail", { count: String(edition.mailReport.total) })}</summary>
          <p className={styles.muted}>{t("brief.mailScope")}</p>
          <div className={styles.mailList}>{edition.mailReport.messages.map(message => <article key={message.id} className={styles.mailRow}>
            <div className={styles.mailRowHeading}><h3><a href={message.href} target="_blank" rel="noopener noreferrer">{message.subject}</a></h3>
              <time dateTime={message.date || undefined}>{briefLocalTimestamp(message.date, locale) ?? t("brief.timeUnknown")}</time></div>
            <p>{message.summary}</p>
            {(message.priority === 2 || !message.reviewed) && <p className={styles.mailFlag}>{t(message.reviewed ? "brief.mailAction" : "brief.mailFailed")}</p>}
            {message.attachmentsKnown === false && <p className={styles.mailExtra}>{t("brief.mailAttachmentsUnknown")}</p>}
            {message.attachmentCount > 0 && <p className={styles.mailExtra}>{t("brief.mailAttachments", { count: String(message.attachmentCount), names: message.attachments.join("、") })}</p>}
          </article>)}</div>
        </details>}
        <section id="brief-coverage" className={styles.coverage}><h2 className="pi-section-title">{t("brief.coverage")}</h2>
          <p className={styles.muted}>{t("brief.intro")}</p>
          <p className={styles.muted}>{t("brief.aiNotice")}</p>
          <p className={styles.muted}>{t("brief.generatedAt")} <time dateTime={edition.createdAt}>{briefLocalTimestamp(edition.createdAt, locale) ?? t("brief.timeUnknown")}</time></p>
          {editorial.omittedCount > 0 && <p className={styles.muted}>{t("brief.limited", { count: String(editorial.omittedCount) })}</p>}
          <p className={styles.muted}>{t("brief.coverageSnapshot")}</p>
          {edition.coverage.filter(source => edition.kind === "daily" || !edition.mailReport || source.source === "mail").map(source => {
            const summary = briefCoverageSummary(edition, source);
            return <details key={source.source} data-brief-coverage={source.source}>
              <summary>{t(`brief.source.${source.source}`)} · {t(`brief.coverage.${source.coverage}`)}</summary>
              <div className={styles.coverageBody}>
                <p>{t(summary.statusKey)}</p>
                <p>{t(summary.scopeKey)}</p>
                <p className={styles.muted}>{edition.mailReport && source.source === "mail" ? t("brief.mailCounts", { total: String(edition.mailReport.total), reviewed: String(edition.mailReport.reviewed), failed: String(edition.mailReport.failed) }) : t(edition.kind === "daily" ? "brief.coverageCountsDaily" : "brief.coverageCounts", { collected: String(summary.collected), supplied: String(summary.supplied) })}</p>
                <p className={styles.muted}>{t("brief.observedAt")} <time dateTime={source.observedAt}>{briefLocalTimestamp(source.observedAt, locale) ?? t("brief.timeUnknown")}</time></p>
                <details className={styles.diagnostics}><summary>{t("brief.technicalDetails")}</summary><p className={styles.diagnosticText}>{source.detail}</p></details>
              </div>
            </details>;
          })}
        </section>
        {resource.data?.notification && <details className={styles.notification}><summary>{t(receipt ? "brief.notificationContent" : "brief.notification")}</summary><strong>{resource.data.notification.title}</strong><p>{resource.data.notification.body}</p><Link href={href(edition.id)} prefetch={false}>{t("brief.open")}</Link></details>}
      </>}
      <details ref={generationOptions} className={styles.generator}>
        <summary>{t("brief.generateOptions")}</summary>
        <p className={styles.muted}>{t("brief.cost")}</p>
        <label className={styles.inputMode}>{t("brief.input")} <select value={input} disabled={busy || Boolean(requestId)} onChange={e => { setInput(e.target.value as "stored" | "gmail" | "live"); setConsent(false); }}>
          <option value="stored">{t("brief.input.stored")}</option><option value="gmail">{t("brief.input.gmail")}</option><option value="live">{t("brief.input.live")}</option>
        </select></label>
        {input === "live" && <p className={styles.muted}>{t("brief.inputHint")}</p>}
        <label className={styles.consent}><input type="checkbox" checked={consent} disabled={busy} onChange={e => setConsent(e.target.checked)} />{t("brief.consent")}</label>
        <div className={styles.controls}>
          <button type="button" className="ui-action pi-bracket" disabled={!consent || busy || !resource.data?.initialized} onClick={() => void generate()}>{t(requestId ? "brief.retry" : "brief.generate")}</button>
          {requestId && <button type="button" className="ui-action" disabled={busy} onClick={() => {
            setRequestId(null); setConsent(false); setActionError("");
            try { sessionStorage.removeItem(REQUEST_KEY); } catch { /* Best effort. */ }
          }}>{t("brief.newRequest")}</button>}
        </div>
      </details>
      <details className={styles.automation}><summary>{t("brief.automation")}</summary>
        {automation.error && <p role="alert" className={styles.error}>{automation.error}</p>}
        {!automation.data && !automation.error && <p>{t("weekly.loading")}</p>}
        {automation.data && <p>{automation.data.schedule ? `${t("brief.automationOn", { time: automation.data.schedule.mailOnly ? `08:00 / 18:00 (${automation.data.schedule.timezone ?? ""})` : automation.data.schedule.time, date: automation.data.schedule.startDate })}${automation.data.schedule.mailOnly ? ` · ${t(automation.data.schedule.morningDaily ? "brief.automationMorningDaily" : "brief.automationMailOnly")}` : ""}` : t("brief.automationOff")}</p>}
        {automation.data?.run && <p>{t(automation.data.run.interrupted || automation.data.run.stage === "failed" ? "brief.run.failed" : automation.data.run.stage === "done" ? "brief.run.done" : "brief.run.busy", { date: automation.data.run.day })}</p>}
        {receipt && <p>{t(receipt.state === "accepted" && receipt.accepted === 0 ? "brief.delivery.resolved" : `brief.delivery.${receipt.state}`)}</p>}
        <p className={styles.muted}>{t("brief.deliveryNotice")}</p>
      </details>
    </div>
  </main>;
}
