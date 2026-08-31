"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { toTraditionalChinese } from "@/lib/i18n/zh-traditional";
import { iconFallback } from "@/extension/robin/links";
import {
  CATEGORY_TONE,
  GAPS,
  PIPELINE,
  PRIOR_WORK_READINGS,
  PROGRESS_SHEET,
  PROJECT_DRIVE,
  PROJECT_REPOSITORY,
  RESEARCH_CATEGORIES,
  RESEARCH_READINGS,
  RESEARCH_STACK,
  RESULTS,
  STATUS_REPORT,
  type Bilingual,
  type ResearchCategory,
  type ResearchReading,
  type StackEntry,
} from "@/extension/robin/research";

/**
 * The HEAT research stack: one page holding every noun the project runs on.
 *
 * It is a reference document, not a dashboard — nothing here is polled, and
 * nothing changes unless the research does. What earns the interactivity is
 * the one question a flat glossary answers badly: "where in the pipeline does
 * this thing live". The ten steps at the top are filter controls, so reading
 * "step 6" and reading "everything involved in step 6" are the same gesture.
 *
 * The three fields per entry are deliberately not merged. `what` is the
 * definition, `role` is why the method needs it, and `here` is what this
 * codebase actually does with it — including where it is wrong. Only the third
 * one is unavailable anywhere else, so it is the one given the accent rule.
 */

type Filter = { kind: "all" } | { kind: "category"; value: ResearchCategory } | { kind: "stage"; value: number };

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function ResearchStack() {
  const { locale, t } = useI18n();
  const [filter, setFilter] = useState<Filter>({ kind: "all" });
  const [query, setQuery] = useState("");

  /**
   * Prose is authored in English and Simplified Chinese; Traditional is a
   * character substitution over the Simplified copy, the same deal the
   * curriculum gets. Doing it at render time rather than in the data keeps one
   * source of truth per language.
   */
  const say = useMemo(() => {
    if (locale === "en") return (value: Bilingual) => value.en;
    if (locale === "zh-TW") return (value: Bilingual) => toTraditionalChinese(value.zh);
    return (value: Bilingual) => value.zh;
  }, [locale]);

  const normalized = query.trim().toLocaleLowerCase();

  const visible = useMemo(() => {
    return RESEARCH_STACK.filter((entry) => {
      if (filter.kind === "category" && entry.category !== filter.value) return false;
      if (filter.kind === "stage" && !entry.stages.includes(filter.value)) return false;
      if (!normalized) return true;
      // Search reaches both languages at once: the term you half-remember is
      // as likely to be the English one as the Chinese gloss.
      const haystack = [entry.term, entry.aka, entry.ref, entry.what.en, entry.what.zh, entry.role.en, entry.role.zh, entry.here.en, entry.here.zh]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase();
      return haystack.includes(normalized);
    });
  }, [filter, normalized]);

  const grouped = useMemo(() => {
    return RESEARCH_CATEGORIES
      .map((category) => ({ category, entries: visible.filter((entry) => entry.category === category) }))
      .filter((group) => group.entries.length > 0);
  }, [visible]);

  const filtering = filter.kind !== "all" || normalized.length > 0;

  return (
    // `robin-dashboard` scopes the card styling; globals.css locks the body to
    // the viewport for the chat shell, so a document page brings its own
    // scroll container.
    <div className="robin-page robin-dashboard flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 desktop:p-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl" style={{ fontStyle: "italic", fontWeight: 400, color: "var(--text)" }}>
            {t("research.title")}
          </h1>
          <p className="pi-eyebrow">{t("research.subtitle")}</p>
          <p style={{ maxWidth: "78ch", fontSize: 14, color: "var(--text-muted)", lineHeight: 1.6 }}>
            {t("research.lede")}
          </p>
        </header>

        <ProjectResources />
        <WeeklyObjective />
        <ResearchReadings />

        {/* Five documents, not five sections of one. This page answers
            "what is this term"; the report answers "how did the project get
            here and what actually holds up"; the walkthrough answers "what
            does line 231 do"; the runbook answers "what do I type"; the
            architecture page answers "where does any of this live", and is
            about a different codebase from the rest. Merging any two would
            make both worse. */}
        <section className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
          {[
            // Ordered the way they should be read, not by when they were
            // written: the briefing is the only one you have to finish before
            // touching anything.
            { href: "/research/brief", tone: "rose", title: t("research.stack.brief"), blurb: t("research.stack.briefBlurb") },
            { href: "/research/report", tone: "clay", title: t("research.stack.report"), blurb: t("research.stack.reportBlurb") },
            { href: "/research/code", tone: "fern", title: t("research.stack.walkthrough"), blurb: t("research.stack.walkthroughBlurb") },
            // Then the two that are not about what the project claims but
            // about the code: the runbook is operational and belongs beside a
            // terminal, and the architecture page is the odd one out — the only
            // document about the trunk of the repository rather than the
            // heatmap branch, so it reads oddly before you know what the
            // others are about.
            { href: "/research/run", tone: "honey", title: t("research.stack.run"), blurb: t("research.stack.runBlurb") },
            { href: "/research/urrag", tone: "teal", title: t("research.stack.arch"), blurb: t("research.stack.archBlurb") },
          ].map((doc) => (
            <a
              key={doc.href}
              href={doc.href}
              className="pi-card ui-action flex flex-col gap-1 p-4"
              style={{ textDecoration: "none", borderInlineStart: `4px solid var(--todo-${doc.tone})` }}
            >
              <span className="pi-label" style={{ fontSize: 13, color: "var(--text)" }}>
                {doc.title} →
              </span>
              <span style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 }}>
                {doc.blurb}
              </span>
            </a>
          ))}
        </section>

        <ResultsPanel />

        <PipelinePanel
          say={say}
          activeStage={filter.kind === "stage" ? filter.value : null}
          onPick={(step) =>
            setFilter((current) =>
              current.kind === "stage" && current.value === step ? { kind: "all" } : { kind: "stage", value: step },
            )
          }
        />

        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="pi-label" style={{ fontSize: 12 }}>{t("research.stack.title")}</h2>
            <span className="pi-eyebrow" style={{ fontSize: 10, fontVariantNumeric: "tabular-nums" }}>
              {t("research.stack.count", { shown: visible.length, total: RESEARCH_STACK.length })}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("research.stack.search")}
              aria-label={t("research.stack.search")}
              style={{ minWidth: 200, flex: "0 1 260px" }}
            />
            <button
              type="button"
              onClick={() => setFilter({ kind: "all" })}
              className="ui-action ui-action--chip pi-eyebrow px-2 py-1"
              data-active={filter.kind === "all"}
              style={{ fontSize: 10 }}
            >
              {t("research.stack.all")}
            </button>
            {RESEARCH_CATEGORIES.map((category) => {
              const active = filter.kind === "category" && filter.value === category;
              return (
                <button
                  key={category}
                  type="button"
                  onClick={() => setFilter(active ? { kind: "all" } : { kind: "category", value: category })}
                  className="ui-action ui-action--chip pi-eyebrow px-2 py-1"
                  data-active={active}
                  style={{
                    fontSize: 10,
                    color: active ? `var(--todo-${CATEGORY_TONE[category]})` : undefined,
                    borderColor: active ? `var(--event-${CATEGORY_TONE[category]})` : undefined,
                  }}
                >
                  {t(`research.category.${category}`)}
                </button>
              );
            })}
            {filtering && (
              <button
                type="button"
                onClick={() => {
                  setFilter({ kind: "all" });
                  setQuery("");
                }}
                className="ui-action pi-eyebrow px-2 py-1"
                style={{ fontSize: 10 }}
              >
                {t("research.filter.clear")}
              </button>
            )}
          </div>

          {grouped.length === 0 ? (
            <p className="pi-card p-4" style={{ fontSize: 13, color: "var(--text-dim)" }}>
              {t("research.stack.empty")}
            </p>
          ) : (
            grouped.map((group) => (
              <div key={group.category} className="flex flex-col gap-2">
                <h3
                  className="pi-eyebrow"
                  style={{ fontSize: 10, color: `var(--todo-${CATEGORY_TONE[group.category]})` }}
                >
                  {t(`research.category.${group.category}`)}
                </h3>
                <ul className="flex flex-col gap-2">
                  {group.entries.map((entry) => (
                    <li key={entry.id}>
                      <EntryCard entry={entry} say={say} onStage={(step) => setFilter({ kind: "stage", value: step })} />
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>

        <GapsPanel say={say} />
      </main>
    </div>
  );
}

type Say = (value: Bilingual) => string;

function ProjectResources() {
  const { t } = useI18n();
  return (
    <section
      className="pi-card flex flex-col gap-3 p-4"
      style={{ borderInlineStart: "4px solid var(--accent)" }}
    >
      <h2 className="pi-label" style={{ fontSize: 12 }}>{t("research.resources.title")}</h2>
      <ul className="grid gap-1 split:grid-cols-2">
        {[PROJECT_REPOSITORY, PROGRESS_SHEET, PROJECT_DRIVE, STATUS_REPORT].map((resource) => (
          <li key={resource.id}><ReadingLink reading={resource} /></li>
        ))}
      </ul>
    </section>
  );
}

const LEGACY_WEEKLY_OBJECTIVE_KEY = "pi-research-weekly-objective";
type ObjectiveSaveState = "loading" | "saving" | "saved" | "error";

function WeeklyObjective() {
  const { t } = useI18n();
  const [objective, setObjective] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<ObjectiveSaveState>("loading");
  const objectiveRef = useRef("");
  const savedRef = useRef("");
  const saveInFlight = useRef<Promise<void> | null>(null);
  const migratingLegacyValue = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/research/objective", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => null) as {
          objective?: unknown;
          updatedAt?: unknown;
          error?: string;
        } | null;
        if (!response.ok || typeof body?.objective !== "string") {
          throw new Error(body?.error ?? `Request failed (${response.status})`);
        }
        if (cancelled) return;

        let value = body.objective;
        try {
          const legacy = window.localStorage.getItem(LEGACY_WEEKLY_OBJECTIVE_KEY);
          if (body.updatedAt === null && legacy) {
            value = legacy;
            migratingLegacyValue.current = true;
          } else {
            window.localStorage.removeItem(LEGACY_WEEKLY_OBJECTIVE_KEY);
          }
        } catch {
          // Browser storage is only consulted once to migrate the old value.
        }

        objectiveRef.current = value;
        savedRef.current = body.objective;
        setObjective(value);
        setLoaded(true);
        setSaveState("saved");
      })
      .catch(() => {
        if (!cancelled) setSaveState("error");
      });
    return () => { cancelled = true; };
  }, []);

  // Serialize writes and keep draining until the server has the newest edit.
  // This avoids a slow older request overwriting a newer value.
  const saveLatest = useCallback(async () => {
    if (!loaded || saveInFlight.current || savedRef.current === objectiveRef.current) return;

    const save = (async () => {
      try {
        while (savedRef.current !== objectiveRef.current) {
          const value = objectiveRef.current;
          if (mounted.current) setSaveState("saving");
          const response = await fetch("/api/research/objective", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ objective: value }),
          });
          const body = await response.json().catch(() => null) as { error?: string } | null;
          if (!response.ok) throw new Error(body?.error ?? `Request failed (${response.status})`);
          savedRef.current = value;
          if (migratingLegacyValue.current) {
            try {
              window.localStorage.removeItem(LEGACY_WEEKLY_OBJECTIVE_KEY);
            } catch {
              // The server is canonical now; a blocked cleanup is harmless.
            }
            migratingLegacyValue.current = false;
          }
        }
        if (mounted.current) setSaveState("saved");
      } catch {
        if (mounted.current) setSaveState("error");
      } finally {
        saveInFlight.current = null;
      }
    })();
    saveInFlight.current = save;
    await save;
  }, [loaded]);

  useEffect(() => {
    if (!loaded || objective === savedRef.current) return;
    setSaveState("saving");
    const timer = window.setTimeout(() => { void saveLatest(); }, 500);
    return () => window.clearTimeout(timer);
  }, [loaded, objective, saveLatest]);

  return (
    <section className="pi-card flex flex-col gap-3 p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <label htmlFor="research-weekly-objective" className="pi-label" style={{ fontSize: 12 }}>
          {t("research.objective.title")}
        </label>
        <span className="pi-eyebrow" aria-live="polite" style={{ fontSize: 9 }}>
          {t(`research.objective.${saveState}`)}
        </span>
      </header>
      <textarea
        id="research-weekly-objective"
        value={objective}
        disabled={!loaded}
        onChange={(event) => {
          objectiveRef.current = event.target.value;
          setObjective(event.target.value);
        }}
        onBlur={() => { void saveLatest(); }}
        rows={4}
        maxLength={10_000}
        placeholder={t("research.objective.placeholder")}
        className="w-full resize-y"
      />
    </section>
  );
}

/** Reading lists kept separate from the HEAT implementation glossary. */
function ResearchReadings() {
  const { t } = useI18n();
  const lists = [
    { title: t("research.readings.title"), readings: RESEARCH_READINGS },
    { title: t("research.readings.priorWork"), readings: PRIOR_WORK_READINGS },
  ];

  return lists.map((list) => (
    <section key={list.title} className="pi-card flex flex-col gap-3 p-4">
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="pi-label" style={{ fontSize: 12 }}>{list.title}</h2>
        <span className="pi-eyebrow" style={{ fontSize: 9 }}>{list.readings.length}</span>
      </header>
      <ul className="grid gap-1 split:grid-cols-2">
        {list.readings.map((reading) => (
          <li key={reading.id}>
            <ReadingLink reading={reading} />
          </li>
        ))}
      </ul>
    </section>
  ));
}

function ReadingLink({ reading }: { reading: ResearchReading }) {
  return (
    <a
      href={reading.url}
      target="_blank"
      rel="noreferrer noopener"
      title={`${reading.title}\n${reading.url}`}
      className="ui-action ui-action--surface flex min-h-16 items-center gap-3 bg-[var(--bg-subtle)] px-3 py-2 no-underline"
      data-state="active"
    >
      <ReadingMark reading={reading} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="line-clamp-2" style={{ fontSize: 13, lineHeight: 1.35 }}>
          {reading.title}
        </span>
        <span className="pi-eyebrow" style={{ fontSize: 9, color: "var(--text-dim)" }}>
          {reading.source}
        </span>
      </span>
      <svg
        aria-hidden="true"
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0"
        style={{ color: "var(--text-dim)" }}
      >
        <path d="M6 3h7v7M13 3 7.5 8.5" />
        <path d="M11 9.5V13H3V5h3.5" />
      </svg>
    </a>
  );
}

/** Cached site icon with the dashboard's deterministic tile as its loading/error fallback. */
function ReadingMark({ reading }: { reading: ResearchReading }) {
  const [mounted, setMounted] = useState(false);
  const [status, setStatus] = useState<"loading" | "loaded" | "failed">("loading");
  const { letter, hue } = iconFallback(reading);

  // Insert the image only after hydration so a fast cached response cannot
  // finish before React attaches the load handler and leave it transparent.
  useEffect(() => { setMounted(true); }, []);
  return (
    <span
      aria-hidden="true"
      className="relative flex size-8 shrink-0 items-center justify-center"
      style={{
        background: `hsl(${hue} 22% 42%)`,
        color: "var(--pi-moonstone)",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
      }}
    >
      {letter}
      {mounted && status !== "failed" && (
        // Served from our own guarded cache; no third-party favicon request leaves the browser.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/research/icon/${encodeURIComponent(reading.id)}`}
          alt=""
          width={32}
          height={32}
          onLoad={() => setStatus("loaded")}
          onError={() => setStatus("failed")}
          className={`absolute inset-0 size-8 object-contain ${status === "loaded" ? "opacity-100" : "opacity-0"}`}
          style={{ background: "var(--bg-panel)" }}
        />
      )}
    </span>
  );
}

/**
 * Where the project stands, with the two columns the pipeline never printed.
 *
 * Agreement is shown against the majority baseline rather than alone, because
 * alone it is misleading in the direction that matters: 70.3% on SQuAD reads
 * like a passing grade until you see that always answering "hallucination"
 * scores 83.5%. The row states that comparison instead of leaving it to be
 * noticed.
 */
function ResultsPanel() {
  const { t } = useI18n();

  return (
    <section className="flex flex-col gap-2">
      <h2 className="pi-label" style={{ fontSize: 12 }}>{t("research.results.title")}</h2>
      <div className="pi-card" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              {["dataset", "n", "positiveRate", "baseline", "agreement", "threshold", "spearman", "pearson", "roc", "pr"].map((key) => (
                <th
                  key={key}
                  className="pi-eyebrow"
                  style={{ padding: "8px 10px", textAlign: key === "dataset" ? "left" : "right", fontSize: 9, whiteSpace: "nowrap" }}
                >
                  {t(`research.results.${key}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {RESULTS.map((row) => {
              const below = row.agreement < row.majorityBaseline;
              const cell = { padding: "8px 10px", textAlign: "right" as const, color: "var(--text-muted)", whiteSpace: "nowrap" as const };
              return (
                <tr key={row.dataset} style={{ borderTop: "1px solid var(--border)" }}>
                  <th scope="row" style={{ padding: "8px 10px", textAlign: "left", fontWeight: 400, color: "var(--text)" }}>
                    {row.dataset}
                  </th>
                  <td style={cell}>{row.n}</td>
                  <td style={cell}>{percent(row.positiveRate)}</td>
                  <td style={cell}>{percent(row.majorityBaseline)}</td>
                  <td
                    style={{ ...cell, color: below ? "var(--danger)" : "var(--success)" }}
                    title={below ? t("research.results.belowBaseline") : undefined}
                  >
                    {percent(row.agreement)}
                    {below ? " ▾" : ""}
                  </td>
                  <td style={cell}>{row.threshold.toFixed(4)}</td>
                  <td style={cell}>{row.spearman.toFixed(3)}</td>
                  <td style={cell}>{row.pearson.toFixed(3)}</td>
                  <td style={cell}>{row.rocAuc.toFixed(3)}</td>
                  <td style={cell}>{row.prAuc.toFixed(3)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.55 }}>{t("research.results.note")}</p>
    </section>
  );
}

/** The ten steps, doubling as the stack's most useful filter. */
function PipelinePanel({ say, activeStage, onPick }: {
  say: Say;
  activeStage: number | null;
  onPick: (step: number) => void;
}) {
  const { t } = useI18n();

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="pi-label" style={{ fontSize: 12 }}>{t("research.pipeline.title")}</h2>
        <span className="pi-eyebrow" style={{ fontSize: 10 }}>{t("research.pipeline.hint")}</span>
      </div>
      <ol className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        {PIPELINE.map((step) => {
          const active = activeStage === step.step;
          return (
            <li key={step.step}>
              <button
                type="button"
                onClick={() => onPick(step.step)}
                className="pi-card ui-action flex w-full items-start gap-3 p-3 text-left"
                aria-pressed={active}
                style={{
                  height: "100%",
                  borderLeft: `4px solid ${active ? "var(--accent)" : "var(--border)"}`,
                }}
              >
                <span
                  className="pi-eyebrow shrink-0"
                  style={{ fontSize: 10, color: active ? "var(--accent)" : "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}
                  aria-hidden
                >
                  {String(step.step).padStart(2, "0")}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span style={{ fontSize: 13.5, color: "var(--text)", lineHeight: 1.35 }}>{say(step.title)}</span>
                  <span style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>{say(step.note)}</span>
                  <code style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--text-dim)", overflowWrap: "anywhere" }}>
                    {step.fn} · {step.ref}
                  </code>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** One term. Definition, reason, and what this codebase does with it. */
function EntryCard({ entry, say, onStage }: {
  entry: StackEntry;
  say: Say;
  onStage: (step: number) => void;
}) {
  const { t } = useI18n();
  const tone = CATEGORY_TONE[entry.category];

  return (
    <article className="pi-card flex flex-col gap-2 p-4" style={{ borderLeft: `4px solid var(--event-${tone})` }}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h4 style={{ fontFamily: "var(--font-mono)", fontSize: 13.5, color: "var(--text)", overflowWrap: "anywhere" }}>
          {entry.term}
        </h4>
        {entry.aka && (
          <span className="pi-eyebrow" style={{ fontSize: 9, color: "var(--text-dim)" }}>
            {t("research.entry.aka", { names: entry.aka })}
          </span>
        )}
        {entry.url && (
          <a
            href={entry.url}
            target="_blank"
            rel="noreferrer noopener"
            className="ui-action pi-eyebrow"
            style={{ fontSize: 9, marginInlineStart: "auto" }}
          >
            {t("research.entry.source")} ↗
          </a>
        )}
      </div>

      <Field label={t("research.field.what")} body={say(entry.what)} />
      <Field label={t("research.field.role")} body={say(entry.role)} />
      <Field label={t("research.field.here")} body={say(entry.here)} accent />

      {(entry.stages.length > 0 || entry.ref) && (
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {entry.stages.map((step) => (
            <button
              key={step}
              type="button"
              onClick={() => onStage(step)}
              className="ui-action ui-action--chip pi-eyebrow px-1.5 py-0.5"
              style={{ fontSize: 9, fontVariantNumeric: "tabular-nums" }}
            >
              {t("research.entry.step", { step })}
            </button>
          ))}
          {entry.ref && (
            <code style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-dim)", marginInlineStart: "auto" }}>
              {entry.ref}
            </code>
          )}
        </div>
      )}
    </article>
  );
}

/**
 * `here` gets the accent rule because it is the only field you cannot get from
 * the paper — it is what this codebase does, including where it is wrong.
 */
function Field({ label, body, accent }: { label: string; body: string; accent?: boolean }) {
  return (
    <div
      className="flex flex-col gap-0.5"
      style={accent ? { borderInlineStart: "2px solid var(--accent-line)", paddingInlineStart: 10 } : undefined}
    >
      <span className="pi-eyebrow" style={{ fontSize: 9, color: accent ? "var(--accent)" : "var(--text-dim)" }}>
        {label}
      </span>
      <p style={{ fontSize: 13, color: accent ? "var(--text)" : "var(--text-muted)", lineHeight: 1.6, maxWidth: "80ch" }}>
        {body}
      </p>
    </div>
  );
}

/**
 * The known gaps.
 *
 * Kept as gaps rather than as a plan: which one gets picked up is a decision
 * for the advisor meeting, and a reference page should not quietly pre-empt it.
 * The kind tag is the useful sort — `structural` cannot be closed by sampling
 * harder, `design` can be settled by one experiment, `protocol` is a reporting
 * fix that costs a day.
 */
function GapsPanel({ say }: { say: Say }) {
  const { t } = useI18n();

  return (
    <section className="flex flex-col gap-2">
      <h2 className="pi-label" style={{ fontSize: 12 }}>{t("research.gaps.title")}</h2>
      <p style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.55, maxWidth: "78ch" }}>
        {t("research.gaps.blurb")}
      </p>
      <ul className="flex flex-col gap-2">
        {GAPS.map((gap) => (
          <li key={gap.id}>
            <article className="pi-card flex flex-col gap-2 p-4">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.35 }}>{say(gap.title)}</h3>
                <span
                  className="pi-eyebrow"
                  style={{ fontSize: 9, color: gap.kind === "structural" ? "var(--danger)" : gap.kind === "design" ? "var(--todo-teal)" : "var(--text-dim)" }}
                >
                  {t(`research.gap.${gap.kind}`)}
                </span>
              </div>
              <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, maxWidth: "80ch" }}>
                {say(gap.body)}
              </p>
              {gap.evidence && (
                <code style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--text-dim)", overflowWrap: "anywhere" }}>
                  {t("research.gap.evidence")} {gap.evidence}
                </code>
              )}
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}
