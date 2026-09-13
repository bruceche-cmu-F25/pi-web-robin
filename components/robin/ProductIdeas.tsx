"use client";

import { useMemo, useRef, useState, type CSSProperties } from "react";
import { useI18n } from "@/hooks/useI18n";
import { localDate } from "@/extension/robin/dates";
import { PLAYBOOK, PLAYBOOK_STEPS, nextStep, playbookStep, type PlaybookStep, type StepId } from "@/extension/robin/product-playbook";
import { ideaAttention } from "@/extension/robin/product-shape";
import type { Idea, IdeaLink, ProductCapture, ProductLibraryResource } from "@/extension/robin/product-domain";
// The chat input already downscales before base64, which matters: a
// screenshot pasted straight in is several megabytes of JSON otherwise.
import { compressImageFile } from "@/components/ChatInput";
import { useProductAgent } from "./ProductIncubatorShell";
import { ProductResourceShelf } from "./ProductResourceShelf";
import { productCopy, researchBrief, type ProductCopy } from "./product-copy";
import { categoryChip, stepSurface } from "./productSurface";
import { usePolledResource } from "./usePolledResource";
import styles from "./ProductIdeas.module.css";

interface IdeasResponse {
  ideas: Idea[];
  captures: ProductCapture[];
}

/** How long the note waits after the last keystroke before saving itself. */
const NOTE_AUTOSAVE_MS = 1_000;

interface Suggestion {
  kind: "idea" | "resource" | "link" | "note";
  title: string;
  summary: string;
  confidence: "low" | "medium" | "high";
  reason: string;
  url?: string;
}

async function jsonRequest<T>(url: string, method: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const parsed = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok || !parsed) throw new Error(parsed?.error ?? `Request failed (${response.status})`);
  return parsed;
}

/** A workbench, not a portfolio dashboard: ideas first, tools on demand. */
export function ProductIdeas() {
  const { locale } = useI18n();
  const copy = productCopy(locale);
  const zh = locale.startsWith("zh");
  const { data, error, refresh } = usePolledResource<IdeasResponse>("/api/robin/products", 30_000);
  // One owner for the library: both the current step and the full shelf read
  // this snapshot, and shelf edits refresh it here instead of starting a
  // second poll for the same thirty-four rows.
  const { data: library, error: libraryError, refresh: refreshLibrary } = usePolledResource<{ resources: ProductLibraryResource[] }>("/api/robin/product-library", 60_000);
  const [openId, setOpenId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"active" | "attention" | "parked" | StepId>("active");
  const [libraryOpen, setLibraryOpen] = useState(false);

  const ideas = useMemo(() => data?.ideas ?? [], [data?.ideas]);
  const today = localDate();
  // The pipeline itself, with your ideas counted along it — the page saying
  // what the steps are, which is the thing it was missing.
  const counts = useMemo(
    () => PLAYBOOK.map((step) => ({
      step,
      n: ideas.filter((idea) => idea.step === step.id && !idea.parked).length,
    })),
    [ideas],
  );
  const parked = useMemo(() => ideas.filter((idea) => idea.parked).length, [ideas]);
  // The decision queue uses the same attention rules as each idea card.
  const needsAttention = useMemo(
    () => ideas.filter((idea) => ideaAttention(idea, today) !== null).length,
    [ideas, today],
  );

  const selectedStep = PLAYBOOK.find((step) => step.id === filter);
  const showViews = !!data && (needsAttention > 0 || parked > 0 || filter === "attention" || filter === "parked");
  const visibleIds = new Set(ideas.filter((idea) => {
    if (filter === "parked") return !!idea.parked;
    if (filter === "attention") return ideaAttention(idea, today) !== null;
    return !idea.parked && (filter === "active" || idea.step === filter);
  }).map((idea) => idea.id));

  const act = async <T,>(run: () => Promise<T>): Promise<T | null> => {
    setActionError(null);
    try {
      const result = await run();
      await refresh();
      return result;
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
      return null;
    }
  };

  return (
    <main className={`${styles.page} flex flex-1 flex-col overflow-y-auto`} style={{ minWidth: 0, minHeight: 0 }}>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 desktop:p-6">
        <section aria-labelledby="product-journey" className="flex flex-col gap-3">
          <header className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="product-journey" className="pi-label">{copy.journey}</h2>
            <span className="pi-eyebrow">{data ? `${ideas.length - parked} ${copy.activeUnit}` : copy.loading}</span>
          </header>
          <div className={styles.journey} role="group" aria-label={copy.step}>
            {counts.map(({ step, n }, index) => {
              const surface = stepSurface(step.id);
              return (
                <button
                  key={step.id}
                  type="button"
                  aria-pressed={filter === step.id}
                  onClick={() => setFilter(filter === step.id ? "active" : step.id)}
                  className={`ui-action ${styles.stage}`}
                  data-selected={filter === step.id}
                  data-empty={data ? n === 0 : undefined}
                  style={{ "--stage-color": surface.ink } as CSSProperties}
                >
                  <span className={`pi-eyebrow ${styles.stageIndex}`} aria-hidden="true">0{index + 1}</span>
                  <span className={styles.stageName}>{step.name[zh ? "zh" : "en"]}</span>
                  <span className={`pi-eyebrow ${styles.stageCount}`}>{data ? n : "—"}</span>
                </button>
              );
            })}
          </div>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {selectedStep ? selectedStep.question[zh ? "zh" : "en"] : copy.journeyHint}
          </p>
        </section>

        {error || libraryError || actionError ? (
          <p role="alert" className="pi-panel p-3 text-sm" style={{ color: "var(--danger)" }}>{error ?? libraryError ?? actionError}</p>
        ) : null}

        <div className={styles.workbench}>
          <section className="flex min-w-0 flex-col gap-4" aria-labelledby="product-workbench">
            <header className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 id="product-workbench" className="text-lg" style={{ color: "var(--text)" }}>{copy.workspace}</h2>
                <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>{copy.workspaceHint}</p>
              </div>
              <a href="#product-capture-title" className={`ui-action pi-bracket min-h-[44px] content-center text-xs ${styles.captureShortcut}`}>{copy.directIdea}</a>
            </header>
            {/* The step row above already filters by step and counts what is in
                progress. These views only earn a row when there is something to
                decide or something set aside — otherwise it is a lone tab
                repeating the count beside the heading. */}
            {showViews ? (
              <div className={styles.filters} role="group" aria-label={copy.ideas}>
                {([
                  ["active", copy.active, ideas.length - parked],
                  ["attention", copy.attention, needsAttention],
                  ["parked", copy.parked, parked],
                ] as const).filter(([value, , count]) => value === "active" || count > 0 || filter === value).map(([value, label, count]) => (
                  <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} className="ui-action min-h-[44px] px-3 text-xs" data-selected={filter === value}>
                    {label} <span className="ml-1 tabular-nums">{count}</span>
                  </button>
                ))}
              </div>
            ) : null}

            {!data ? <p role="status" className="pi-panel p-6 text-sm">{error ? copy.error : copy.loading}</p> : null}
            {data && visibleIds.size === 0 ? (
              <div className={`${styles.empty} pi-card`}>
                <span className="pi-eyebrow">{selectedStep ? selectedStep.name[zh ? "zh" : "en"] : copy.ideas}</span>
                <h3 className="mt-3 text-lg">{ideas.length === 0 ? copy.noIdeas : copy.noMatches}</h3>
                <p className="mt-2 max-w-lg text-sm" style={{ color: "var(--text-muted)" }}>
                  {selectedStep ? selectedStep.does[0]?.[zh ? "zh" : "en"] : copy.noIdeasHint}
                </p>
                {filter !== "active" ? <button type="button" onClick={() => setFilter("active")} className="ui-action pi-bracket mt-4 min-h-[44px] text-xs">{copy.clearFilter}</button> : null}
              </div>
            ) : null}
            {/* Keep filtered rows mounted: changing views must not discard drafts. */}
            <ul className="m-0 flex list-none flex-col gap-3 p-0" aria-label={copy.ideas}>
              {ideas.map((idea) => (
                <IdeaRow
                  key={idea.id}
                  idea={idea}
                  hidden={!visibleIds.has(idea.id)}
                  copy={copy}
                  locale={locale}
                  today={today}
                  resources={library?.resources ?? []}
                  open={openId === idea.id}
                  onToggle={() => setOpenId(openId === idea.id ? null : idea.id)}
                  onAct={act}
                  onGone={() => setOpenId(null)}
                />
              ))}
            </ul>
          </section>

          <Capture
            captures={data?.captures ?? []}
            ideas={ideas}
            copy={copy}
            locale={locale}
            onDone={async () => { await Promise.all([refresh(), refreshLibrary()]); }}
            onCreated={(idea) => { setFilter("active"); setOpenId(idea.id); }}
          />
        </div>

        <section className="border-t pt-5" style={{ borderColor: "var(--border)" }} aria-labelledby="product-toolkit">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="product-toolkit" className="pi-label">{copy.resources}</h2>
              <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>{copy.libraryHint}</p>
            </div>
            <button type="button" aria-expanded={libraryOpen} aria-controls="product-library" onClick={() => setLibraryOpen(!libraryOpen)} className="ui-action pi-bracket min-h-[44px] text-xs">
              {libraryOpen ? copy.hideResources : copy.browseResources}
              {library ? ` · ${library.resources.filter((item) => item.status !== "archived").length}` : ""}
            </button>
          </div>
          <div id="product-library" hidden={!libraryOpen} className="mt-4">
            <ProductResourceShelf
              locale={locale}
              resources={library?.resources ?? []}
              onRefresh={refreshLibrary}
            />
          </div>
        </section>
      </div>
    </main>
  );
}

/** Preview the next question; keep edits local until explicitly saved. */
function IdeaRow({ idea, hidden, copy, locale, today, resources, open, onToggle, onAct, onGone }: {
  idea: Idea;
  hidden: boolean;
  copy: ProductCopy;
  locale: string;
  today: string;
  resources: ProductLibraryResource[];
  open: boolean;
  onToggle: () => void;
  onAct: <T,>(run: () => Promise<T>) => Promise<T | null>;
  onGone: () => void;
}) {
  // Name and note save themselves, like every other field on the card. Each
  // keeps its own draft so that saving one never sends — or clears — the other.
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const name = nameDraft ?? idea.name;
  const note = noteDraft ?? idea.note;
  const pendingNote = useRef<string | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [writing, setWriting] = useState(0);
  const dirty = nameDraft !== null || noteDraft !== null;
  const [busy, setBusy] = useState(false);
  const surface = stepSurface(idea.step, idea.parked);
  const step = playbookStep(idea.step);
  const zh = locale.startsWith("zh");
  const agent = useProductAgent();
  const attention = ideaAttention(idea, today);

  const patchIdea = (patch: Record<string, unknown>) =>
    onAct(() => jsonRequest(`/api/robin/products/${encodeURIComponent(idea.id)}`, "PATCH", patch));

  // Step, bet, link, and parked-state writes lock the controls they belong to.
  const save = async (patch: Record<string, unknown>) => {
    setBusy(true);
    await patchIdea(patch);
    setBusy(false);
  };

  // Text writes never disable the field being typed in, and a draft is only
  // dropped if it is still exactly what was sent: keystrokes that arrive while
  // the request is in flight are a newer draft, not something to overwrite.
  const writeText = async (patch: { name: string } | { note: string }) => {
    setWriting((count) => count + 1);
    const saved = await patchIdea(patch);
    setWriting((count) => count - 1);
    return saved;
  };

  const saveName = async () => {
    const sent = nameDraft?.trim();
    // An empty name stays a draft (and says unsaved): the server refuses it.
    if (nameDraft === null || !sent) return;
    if (sent === idea.name) { setNameDraft(null); return; }
    if (await writeText({ name: sent })) setNameDraft((current) => (current?.trim() === sent ? null : current));
  };

  const saveNote = async () => {
    clearTimeout(noteTimer.current);
    const sent = pendingNote.current;
    if (sent === null) return;
    pendingNote.current = null;
    if (await writeText({ note: sent })) setNoteDraft((current) => (current === sent ? null : current));
    else pendingNote.current ??= sent;
  };

  const editNote = (value: string) => {
    pendingNote.current = value;
    setNoteDraft(value);
    clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => void saveNote(), NOTE_AUTOSAVE_MS);
  };

  const firstLine = idea.note.split("\n").find((line) => line.trim()) ?? "";

  return (
    <li
      hidden={hidden}
      className={`pi-card ${styles.idea}`}
      style={{ borderLeft: surface.spine }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-4">
        {open ? (
          // Open, the heading is the name field — one name on the card, not a
          // title with an input repeating it underneath.
          <div className="min-w-0 basis-full split:basis-auto split:flex-1">
            <input
              value={name}
              onChange={(event) => setNameDraft(event.target.value)}
              onBlur={() => void saveName()}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") setNameDraft(null);
              }}
              aria-label={copy.ideaName}
              className={styles.titleInput}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={`product-notebook-${idea.id}`}
            className="ui-action flex min-h-[44px] min-w-0 basis-full flex-col items-start gap-2 text-left split:basis-auto split:flex-1"
          >
            <span className="text-lg font-semibold" style={{ color: "var(--text)", overflowWrap: "anywhere" }}>{name.trim() || idea.name}</span>
            {firstLine ? <span className="line-clamp-2 text-sm" style={{ color: "var(--text-muted)" }}>{firstLine}</span> : null}
          </button>
        )}

        {attention ? (
          <span className="pi-eyebrow shrink-0 whitespace-nowrap" style={{ color: "var(--warning)" }}>
            {attention === "overdue" ? copy.overdue : copy.stale}
          </span>
        ) : null}

        {idea.parked ? <span className="pi-eyebrow">{copy.parked}</span> : null}
        {/* Only worth saying on a closed card: open, the status sits under the notes. */}
        {dirty && !open ? <span className="pi-eyebrow" style={{ color: "var(--warning)" }}>{copy.unsaved}</span> : null}

        <select
          value={idea.step}
          disabled={busy}
          aria-label={`${idea.name} — ${copy.step}`}
          onChange={(event) => void save({ step: event.target.value })}
          className="pi-panel min-h-[44px] min-w-0 flex-1 px-2 text-xs split:min-h-8 split:flex-none split:px-1"
          style={{ color: surface.ink }}
        >
          {PLAYBOOK.map((item) => <option key={item.id} value={item.id}>{item.name[zh ? "zh" : "en"]}</option>)}
        </select>

      </div>

      {!open ? (
        <div className="mx-4 border-t py-3" style={{ borderColor: "var(--border)" }}>
          <p className="pi-eyebrow">{idea.bet && !idea.bet.settled ? copy.bet : copy.nextAction}</p>
          <p className="mt-1 line-clamp-2 text-sm" style={{ color: "var(--text)" }}>
            {idea.bet && !idea.bet.settled ? idea.bet.claim : step.does[0]?.[zh ? "zh" : "en"]}
          </p>
          {idea.bet?.by && !idea.bet.settled ? <p className="pi-eyebrow mt-2">{copy.betBy} · {idea.bet.by}</p> : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 pb-3">
        <span className="pi-eyebrow">{copy.links} · {idea.links.length}</span>
        <span className="pi-eyebrow">{copy.updated} {new Date(idea.updatedAt).toLocaleDateString(locale, { month: "short", day: "numeric" })}</span>
        <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={`product-notebook-${idea.id}`} className="ui-action pi-bracket ml-auto min-h-[44px] text-xs" data-state={open ? undefined : "accent"}>
          {open ? copy.closeIdea : copy.openIdea}
        </button>
      </div>

      {open ? (
        <div id={`product-notebook-${idea.id}`} className="flex flex-col gap-4 border-t p-4" style={{ borderColor: "var(--border)" }}>
          <StepCard
            idea={idea}
            step={step}
            copy={copy}
            zh={zh}
            busy={busy}
            resources={resources}
            onSave={save}
            onResearch={() => agent.ask({ ideaId: idea.id, brief: researchBrief({ name, note }, locale) })}
          />
          <label className="flex flex-col gap-2">
            <span className="pi-eyebrow">{copy.notebook}</span>
          <textarea
            value={note}
            onChange={(event) => editNote(event.target.value)}
            onBlur={() => void saveNote()}
            aria-label={copy.note}
            placeholder={copy.notePlaceholder}
            rows={6}
            className="pi-panel w-full resize-y p-2 text-sm outline-none"
          />
          </label>
          <span role="status" className="pi-eyebrow -mt-2">
            {writing ? copy.saving : dirty ? copy.unsaved : copy.saved}
          </span>

          <Bet idea={idea} copy={copy} busy={busy} today={today} onSave={save} />

          <IdeaLinks idea={idea} copy={copy} busy={busy} onAct={onAct} onSave={save} />

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => void save({ parked: !idea.parked })}
              className="ui-action min-h-[44px] px-2 text-xs split:min-h-0 split:px-0"
              style={{ color: "var(--text-dim)" }}
            >
              {idea.parked ? copy.unpark : copy.park}
            </button>
            <button
              type="button"
              disabled={busy}
              className="ui-action ml-auto min-h-[44px] px-2 text-xs disabled:opacity-40"
              style={{ color: "var(--danger)" }}
              onClick={async () => {
                if (!window.confirm(copy.deleteConfirm)) return;
                // A note still waiting to save would otherwise land on a deleted idea.
                clearTimeout(noteTimer.current);
                pendingNote.current = null;
                setBusy(true);
                const removed = await onAct(() => jsonRequest(`/api/robin/products/${encodeURIComponent(idea.id)}`, "DELETE", undefined));
                setBusy(false);
                if (removed) onGone();
              }}
            >
              {copy.delete}
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/**
 * What this step is, what to do in it, and what to reach for.
 *
 * This is the thing the section was missing for its whole life. A six-column
 * board asked you to know the process and record your position in it; what was
 * wanted was to be told the process. So the step is not a label on a card, it
 * is a short page of instructions with the shelf for that bench beside it.
 *
 * The library's five categories were built for exactly this and then left
 * orphaned on a route of their own — a directory you had to think to visit.
 * Here they arrive when they are the right tool.
 *
 * "Done" is the only gate and it is not enforced: you can set any step from
 * the row above at any time. Advice that locks you out stops being advice.
 */
function StepCard({ idea, step, copy, zh, busy, resources, onSave, onResearch }: {
  idea: Idea;
  step: PlaybookStep;
  copy: ProductCopy;
  zh: boolean;
  busy: boolean;
  resources: ProductLibraryResource[];
  onSave: (patch: Record<string, unknown>) => Promise<void>;
  onResearch: () => void;
}) {
  const lang = zh ? "zh" : "en";
  const after = nextStep(step.id);
  const [guideOpen, setGuideOpen] = useState(false);
  const guideId = `product-step-guide-${idea.id}`;
  const shelf = resources
    .filter((item) => step.categories.includes(item.category) && item.status !== "archived")
    .sort((a, b) => Number(b.status === "using") - Number(a.status === "using") || a.name.localeCompare(b.name));
  const surface = stepSurface(idea.step, idea.parked);

  return (
    <section
      className="pi-panel flex flex-col gap-3 p-3"
      style={{ borderLeft: surface.spine }}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="pi-eyebrow tabular-nums" style={{ color: surface.ink }}>
          {PLAYBOOK_STEPS.indexOf(step.id) + 1}/{PLAYBOOK_STEPS.length} · {step.name[lang]}
        </span>
        {idea.parked ? <span className="pi-eyebrow">{copy.parkedNote}</span> : null}
        <button
          type="button"
          aria-expanded={guideOpen}
          aria-controls={guideId}
          onClick={() => setGuideOpen((current) => !current)}
          className="ui-action pi-bracket ml-auto min-h-[44px] px-2 text-xs split:min-h-0 split:px-0"
        >
          {guideOpen ? copy.hideGuide : copy.showGuide}
        </button>
      </header>

      <div>
        <p className="pi-eyebrow">{copy.nextAction}</p>
        <p className="mt-1 text-sm" style={{ color: "var(--text)" }}>{step.does[0]?.[lang]}</p>
      </div>

      {step.action === "research" ? (
        <button type="button" onClick={onResearch} className="ui-action pi-bracket min-h-[44px] self-start px-2 text-xs split:min-h-0 split:px-0" data-state="accent">
          {copy.research}
        </button>
      ) : null}

      <div className="flex flex-col items-start gap-2 border-t pt-3 split:flex-row split:items-baseline split:gap-x-3" style={{ borderColor: "var(--border)" }}>
        <span className="pi-eyebrow">{copy.whatDone}</span>
        <span className="w-full text-xs split:min-w-0 split:flex-1" style={{ color: "var(--text-muted)" }}>{step.done[lang]}</span>
        {after ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void onSave({ step: after })}
            className="ui-action pi-bracket min-h-[44px] shrink-0 px-2 text-xs split:min-h-0 split:px-0"
          >
            {copy.stepDone}
          </button>
        ) : null}
      </div>

      {guideOpen ? (
        <div id={guideId} className="flex flex-col gap-3 border-t pt-3" style={{ borderColor: "var(--border)" }}>
          <div>
            <p className="pi-eyebrow">{copy.whatFor}</p>
            <p className="mt-1 text-sm" style={{ color: "var(--text)" }}>{step.question[lang]}</p>
          </div>

          <div>
            <p className="pi-eyebrow">{copy.whatToDo}</p>
            <ol className="mt-1 flex list-none flex-col gap-1.5 p-0">
              {step.does.map((item, index) => (
                <li key={item.en} className="flex gap-2 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
                  <span className="pi-eyebrow shrink-0 tabular-nums">{index + 1}</span>
                  <span>{item[lang]}</span>
                </li>
              ))}
            </ol>
          </div>

          {shelf.length > 0 ? (
            <div>
              <p className="pi-eyebrow">{copy.toolsHere}</p>
              <p className="mt-1 text-sm" style={{ lineHeight: 1.9 }}>
                {shelf.map((item, index) => (
                  <span key={item.id}>
                    {index > 0 ? <span aria-hidden style={{ color: "var(--text-dim)" }}> · </span> : null}
                    {item.url ? (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ui-action"
                        title={item.summary}
                        style={{ color: item.status === "using" ? "var(--text)" : "var(--text-muted)" }}
                      >
                        {item.name}
                      </a>
                    ) : (
                      <span title={item.summary} style={{ color: "var(--text-muted)", borderBottom: `1px dotted ${categoryChip(item.category).borderColor}` }}>
                        {item.name}
                      </span>
                    )}
                  </span>
                ))}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/**
 * One claim, one date, and two ways for it to end.
 *
 * The settle buttons are the only part of this page that can move an idea
 * against your inclination: admitting the claim did not hold parks it. That is
 * the whole point — a list that can only grow is a list you stop reading, and
 * the thing an idea tracker owes you is the occasional "this one is finished".
 */
function Bet({ idea, copy, busy, today, onSave }: {
  idea: Idea;
  copy: ProductCopy;
  busy: boolean;
  today: string;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
}) {
  const [claim, setClaim] = useState(idea.bet?.claim ?? "");
  const [by, setBy] = useState(idea.bet?.by ?? "");
  const settled = idea.bet?.settled;
  const overdue = !!idea.bet?.by && !settled && idea.bet.by < today;

  const settle = (verdict: "held" | "broke") =>
    void onSave({ bet: { claim: idea.bet?.claim ?? claim, by: idea.bet?.by ?? by, settled: verdict } });

  return (
    <div className="pi-panel flex flex-col gap-2 p-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="pi-eyebrow">{copy.bet}</span>
        {settled ? (
          <span className="pi-eyebrow" style={{ color: settled === "held" ? "var(--success)" : "var(--danger)" }}>
            {settled === "held" ? copy.betSettledHeld : copy.betSettledBroke}
          </span>
        ) : overdue ? (
          <span className="pi-eyebrow" style={{ color: "var(--warning)" }}>{copy.overdue}</span>
        ) : null}
      </div>

      <p className="text-xs" style={{ color: "var(--text-muted)" }}>{copy.hypothesisHint}</p>
      <div className="flex flex-wrap items-end gap-2">
        <input
          value={claim}
          disabled={busy || !!settled}
          onChange={(event) => setClaim(event.target.value)}
          onBlur={() => { if (claim.trim() !== (idea.bet?.claim ?? "")) void onSave(claim.trim() ? { bet: { claim: claim.trim(), by } } : { bet: null }); }}
          placeholder={copy.betPlaceholder}
          aria-label={copy.bet}
          className="pi-panel min-h-[44px] min-w-0 flex-1 basis-64 px-2 text-sm outline-none disabled:opacity-60"
        />
        <label className="flex min-w-0 flex-col gap-1">
          <span className="pi-eyebrow">{copy.betBy}</span>
        <input
          type="date"
          value={by}
          disabled={busy || !claim.trim() || !!settled}
          onChange={(event) => {
            setBy(event.target.value);
            if (claim.trim()) void onSave({ bet: { claim: claim.trim(), by: event.target.value } });
          }}
          aria-label={copy.betBy}
          className="pi-panel min-h-[44px] min-w-0 px-2 text-sm outline-none disabled:opacity-60"
        />
        </label>
      </div>

      {claim.trim() && !settled ? (
        <div className="flex flex-wrap gap-3">
          <button type="button" disabled={busy} onClick={() => settle("held")} className="ui-action pi-bracket min-h-[44px] px-2 text-xs split:min-h-0 split:px-0">{copy.betHeld}</button>
          <button type="button" disabled={busy} onClick={() => settle("broke")} className="ui-action pi-bracket min-h-[44px] px-2 text-xs split:min-h-0 split:px-0" style={{ color: "var(--danger)" }}>{copy.betBroke}</button>
          <p className="w-full text-xs" style={{ color: "var(--text-muted)" }}>{copy.betBrokeHint}</p>
        </div>
      ) : null}

      {settled ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => { setClaim(""); setBy(""); void onSave({ bet: null }); }}
          className="ui-action min-h-[44px] self-start px-2 text-xs split:min-h-0 split:px-0"
          style={{ color: "var(--text-dim)" }}
        >
          {copy.clearBet}
        </button>
      ) : null}
    </div>
  );
}

function IdeaLinks({ idea, copy, busy, onAct, onSave }: {
  idea: Idea;
  copy: ProductCopy;
  busy: boolean;
  onAct: <T,>(run: () => Promise<T>) => Promise<T | null>;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
}) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");

  const add = async () => {
    if (!url.trim()) return;
    const saved = await onAct(() => jsonRequest<{ link: IdeaLink }>(
      `/api/robin/products/${encodeURIComponent(idea.id)}`,
      "PATCH",
      { link: { url: url.trim(), title: title.trim() } },
    ));
    if (saved) { setUrl(""); setTitle(""); }
  };

  return (
    <div className="flex flex-col gap-2">
      <h3 className="pi-eyebrow">{copy.evidence} · {idea.links.length}</h3>
      {idea.links.length === 0 ? <p className="text-xs" style={{ color: "var(--text-muted)" }}>{copy.noEvidence}</p> : null}
      {idea.links.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {idea.links.map((link) => (
            <li key={link.id} className="flex items-start gap-2 border-b py-2" style={{ borderColor: "var(--border)" }}>
              <div className="min-w-0 flex-1" style={{ overflowWrap: "anywhere" }}>
                <a href={link.url} target="_blank" rel="noopener noreferrer" className="ui-action text-sm" style={{ color: "var(--text)" }}>{link.title}</a>
                {link.note ? <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>{link.note}</p> : null}
              </div>
              {/* Where a claim came from stays visible: a link the agent found
                  is not the same as one you chose to keep. */}
              {link.addedBy === "agent" ? <span className="pi-eyebrow shrink-0">{copy.byAgent}</span> : null}
              <button
                type="button"
                disabled={busy}
                aria-label={`${copy.remove} ${link.title}`}
                onClick={() => void onSave({ links: idea.links.filter((item) => item.id !== link.id) })}
                className="ui-action min-h-[44px] shrink-0 px-2 text-xs split:min-h-0 split:px-0"
                style={{ color: "var(--text-dim)" }}
              >
                {copy.remove}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") void add(); }}
          type="text"
          inputMode="url"
          placeholder={copy.url}
          aria-label={copy.url}
          className="pi-panel min-h-[44px] min-w-0 flex-1 basis-48 px-2 text-sm outline-none"
        />
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") void add(); }}
          placeholder={copy.titleField}
          aria-label={copy.titleField}
          className="pi-panel min-h-[44px] min-w-0 flex-1 basis-40 px-2 text-sm outline-none"
        />
        <button type="button" disabled={busy || !url.trim()} onClick={() => void add()} className="ui-action pi-bracket min-h-[44px] px-2 text-xs disabled:opacity-40 split:min-h-0 split:px-0">
          {copy.addLink}
        </button>
      </div>
    </div>
  );
}

/**
 * Direct ideas need no AI. Raw captures are retained before classification;
 * a suggested destination is only written after the user confirms it.
 */
function Capture({ captures, ideas, copy, locale, onDone, onCreated }: {
  captures: ProductCapture[];
  ideas: Idea[];
  copy: ProductCopy;
  locale: string;
  onDone: () => Promise<void>;
  onCreated: (idea: Idea) => void;
}) {
  const [mode, setMode] = useState<"idea" | "capture">("idea");
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [images, setImages] = useState<Array<{ data: string; mimeType: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<{ capture: ProductCapture; suggestion: Suggestion } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const classify = (capture: ProductCapture) => run(async () => {
    const { suggestion } = await jsonRequest<{ suggestion: Suggestion }>("/api/robin/product-classify", "POST", { id: capture.id });
    setReview({ capture, suggestion });
  });

  const save = () => {
    if (busy) return;
    return run(async () => {
      if (mode === "idea") {
        if (!name.trim()) return;
        const { idea } = await jsonRequest<{ idea: Idea }>("/api/robin/products", "POST", { name: name.trim(), note: text });
        setName("");
        setText("");
        await onDone();
        onCreated(idea);
        return;
      }
      if (!text.trim() && images.length === 0) return;
      const { capture } = await jsonRequest<{ capture: ProductCapture }>("/api/robin/products", "POST", { capture: true, text, images });
      setText("");
      setImages([]);
      await onDone();
      try {
        const { suggestion } = await jsonRequest<{ suggestion: Suggestion }>("/api/robin/product-classify", "POST", { id: capture.id });
        setReview({ capture, suggestion });
      } catch (caught) {
        throw new Error(`${copy.savedCapture} ${caught instanceof Error ? caught.message : String(caught)}`);
      }
    });
  };

  return (
    <section className={`${styles.capture} pi-card flex min-w-0 flex-col gap-3 p-4`} aria-labelledby="product-capture-title">
      <header>
        <h2 id="product-capture-title" tabIndex={-1} className="pi-label">{copy.captureTitle}</h2>
        <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>{copy.captureHint}</p>
      </header>
      <div className={styles.filters} role="group" aria-label={copy.type}>
        <button type="button" disabled={busy} aria-pressed={mode === "idea"} data-selected={mode === "idea"} onClick={() => setMode("idea")} className="ui-action min-h-[44px] flex-1 px-2 text-xs">{copy.directIdea}</button>
        <button type="button" disabled={busy} aria-pressed={mode === "capture"} data-selected={mode === "capture"} onClick={() => setMode("capture")} className="ui-action min-h-[44px] flex-1 px-2 text-xs">{copy.rawCapture}</button>
      </div>
      {mode === "idea" ? (
        <label className="flex flex-col gap-2">
          <span className="pi-eyebrow">{copy.ideaName}</span>
          <input value={name} disabled={busy} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void save(); } }} placeholder={copy.newIdeaName} className="pi-panel min-h-[44px] w-full text-sm" />
        </label>
      ) : null}
      <label className="flex flex-col gap-2">
        <span className="pi-eyebrow">{mode === "idea" ? copy.note : copy.original}</span>
        <textarea
          value={text}
          disabled={busy}
          onChange={(event) => setText(event.target.value)}
          placeholder={mode === "idea" ? copy.notePlaceholder : copy.capturePlaceholder}
          rows={4}
          className="pi-panel w-full resize-y p-3 text-sm outline-none"
        />
      </label>

      {mode === "capture" && images.length > 0 ? (
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label={`${images.length} ${copy.images}`}>
          {images.map((image, index) => (
            <li key={`${image.mimeType}:${index}`} className="relative size-16 border" style={{ borderColor: "var(--border)" }}>
              {/* The bytes are already local preview data; loading them through
                  an image endpoint would only round-trip what the browser has. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`data:${image.mimeType};base64,${image.data}`}
                alt=""
                className="size-full object-cover"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => setImages((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                aria-label={`${copy.removeImage} ${index + 1}`}
                className="ui-action ui-action--surface absolute right-0 top-0 flex size-8 items-center justify-center text-sm"
                style={{ background: "var(--bg-panel)", color: "var(--text)" }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          disabled={busy}
          hidden
          onChange={async (event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = "";
            await run(async () => {
              const attached = await Promise.all(files.map((file) => compressImageFile(file)));
              setImages((current) => [...current, ...attached]);
            });
          }}
        />
        {mode === "capture" ? <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className="ui-action pi-bracket min-h-[44px] text-xs disabled:opacity-40">
          {copy.attach}{images.length > 0 ? ` · ${images.length}` : ""}
        </button> : null}
        <button
          type="button"
          disabled={busy || (mode === "idea" ? !name.trim() : !text.trim() && images.length === 0)}
          onClick={() => void save()}
          className="ui-action pi-bracket min-h-[44px] text-xs disabled:opacity-40"
          data-state="accent"
        >
          {busy ? (mode === "idea" ? copy.saving : copy.classifying) : mode === "idea" ? copy.createIdea : copy.capture}
        </button>
      </div>
      {mode === "capture" ? <p className="text-xs" style={{ color: "var(--text-muted)" }}>{copy.capturePrivacy}</p> : null}

      {captures.length > 0 ? (
        <div className="flex flex-col gap-1 border-t pt-3" style={{ borderColor: "var(--border)" }}>
          <p className="pi-eyebrow px-1">{copy.pendingCaptures} · {captures.length}</p>
          <ul className="m-0 flex list-none flex-col p-0">
            {captures.map((capture) => {
              const preview = capture.text.trim().replace(/\s+/g, " ") || `${capture.images.length} ${copy.images}`;
              const firstImage = capture.images[0];
              return (
                <li key={capture.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void classify(capture)}
                    className="ui-action ui-action--surface flex min-h-[44px] w-full items-center gap-2 px-1 text-left disabled:opacity-40"
                  >
                    {firstImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`data:${firstImage.mimeType};base64,${firstImage.data}`}
                        alt=""
                        className="size-8 shrink-0 border object-cover"
                        style={{ borderColor: "var(--border)" }}
                      />
                    ) : null}
                    <span className="min-w-0 flex-1 truncate text-xs" style={{ color: "var(--text)" }}>{preview}</span>
                    <span className="pi-eyebrow shrink-0">
                      {new Date(capture.createdAt).toLocaleDateString(locale, { month: "short", day: "numeric" })}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {error ? <p role="alert" className="text-xs" style={{ color: "var(--danger)" }}>{error}</p> : null}

      {review ? (
        <Review
          key={review.capture.id}
          review={review}
          ideas={ideas}
          copy={copy}
          busy={busy}
          onCancel={() => setReview(null)}
          onFiled={async () => { setReview(null); await onDone(); }}
          onError={setError}
        />
      ) : null}
    </section>
  );
}

function Review({ review, ideas, copy, busy, onCancel, onFiled, onError }: {
  review: { capture: ProductCapture; suggestion: Suggestion };
  ideas: Idea[];
  copy: ProductCopy;
  busy: boolean;
  onCancel: () => void;
  onFiled: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [kind, setKind] = useState(review.suggestion.kind);
  const [title, setTitle] = useState(review.suggestion.title);
  const [summary, setSummary] = useState(review.suggestion.summary);
  const [ideaId, setIdeaId] = useState(ideas[0]?.id ?? "");
  const [submitting, setSubmitting] = useState(false);
  const disabled = busy || submitting;

  const submit = async () => {
    if (disabled) return;
    setSubmitting(true);
    try {
      await jsonRequest("/api/robin/products", "POST", {
        captureId: review.capture.id,
        kind,
        title,
        summary,
        ...(review.suggestion.url ? { url: review.suggestion.url } : {}),
        ...(kind === "link" ? { ideaId } : {}),
      });
      await onFiled();
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      className="pi-panel flex flex-col gap-3 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="pi-label">{copy.suggestion}</span>
        <span className="pi-eyebrow">{copy.confidence}: {review.suggestion.confidence}</span>
      </div>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>{review.suggestion.reason}</p>

      <div className="flex flex-wrap gap-2">
        <select value={kind} disabled={disabled} onChange={(event) => setKind(event.target.value as Suggestion["kind"])} aria-label={copy.type} className="pi-panel min-h-[44px] basis-32 px-2 text-sm disabled:opacity-60">
          <option value="idea">{copy.idea}</option>
          <option value="resource">{copy.resource}</option>
          <option value="link">{copy.link}</option>
          <option value="note">{copy.note}</option>
        </select>
        {kind === "link" ? (
          <select value={ideaId} disabled={disabled} onChange={(event) => setIdeaId(event.target.value)} aria-label={copy.ideas} className="pi-panel min-h-[44px] min-w-0 flex-1 basis-48 px-2 text-sm disabled:opacity-60">
            {ideas.map((idea) => <option key={idea.id} value={idea.id}>{idea.name}</option>)}
          </select>
        ) : null}
        <input value={title} disabled={disabled} onChange={(event) => setTitle(event.target.value)} aria-label={copy.titleField} className="pi-panel min-h-[44px] min-w-0 flex-1 basis-48 px-2 text-sm disabled:opacity-60" />
      </div>
      <textarea value={summary} disabled={disabled} onChange={(event) => setSummary(event.target.value)} aria-label={copy.note} rows={2} className="pi-panel w-full resize-y p-2 text-sm disabled:opacity-60" />

      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={disabled || !title.trim() || (kind === "link" && !ideaId)} className="ui-action pi-bracket min-h-[44px] px-2 text-xs disabled:opacity-40 split:min-h-0 split:px-0" data-state="accent">{submitting ? copy.saving : copy.confirm}</button>
        <button type="button" disabled={disabled} onClick={onCancel} className="ui-action min-h-[44px] px-2 text-xs disabled:opacity-40 split:min-h-0 split:px-0">{copy.cancel}</button>
      </div>
    </form>
  );
}
