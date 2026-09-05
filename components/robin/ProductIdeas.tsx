"use client";

import { useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { localDate } from "@/extension/robin/dates";
import { PLAYBOOK, PLAYBOOK_STEPS, nextStep, playbookStep, type PlaybookStep } from "@/extension/robin/product-playbook";
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

interface IdeasResponse {
  ideas: Idea[];
  captures: ProductCapture[];
}

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

/**
 * The whole of Product, on one page.
 *
 * There used to be a six-column board here and a second route behind every
 * card holding eight kinds of structured record. After all of it shipped the
 * store held one real idea with every one of those collections empty — the
 * apparatus was sized for running a portfolio, and what actually happens is
 * that you have an idea and want somewhere to put what you learn.
 *
 * So: capture at the top, the ideas under it, the library's links at the
 * bottom. An idea opens in place rather than on its own page, because
 * navigating away from the list to read one line of a note is most of what
 * made keeping this current feel like a chore.
 */
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
  // Said once at the top rather than only per row: the point of the count is
  // that you see it without going looking.
  const needsAttention = useMemo(
    () => ideas.filter((idea) => ideaAttention(idea, today) !== null).length,
    [ideas, today],
  );

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
    <main className="flex flex-1 flex-col overflow-y-auto" style={{ minWidth: 0, minHeight: 0 }}>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 desktop:p-6">
        <Capture captures={data?.captures ?? []} ideas={ideas} copy={copy} locale={locale} onDone={refresh} />

        {error || libraryError || actionError ? <p className="text-sm" style={{ color: "var(--danger)" }}>{error ?? libraryError ?? actionError}</p> : null}

        <section className="pi-card flex flex-col p-4">
          <header className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h2 className="pi-label">{copy.ideas}</h2>
            <p className="pi-eyebrow tabular-nums">
              {counts.map(({ step, n }, index) => (
                <span key={step.id}>
                  {index > 0 ? <span style={{ color: "var(--text-dim)" }}> → </span> : null}
                  <span style={{ color: n > 0 ? stepSurface(step.id).ink : "var(--text-dim)" }}>
                    {step.name[zh ? "zh" : "en"]}{n > 0 ? ` ${n}` : ""}
                  </span>
                </span>
              ))}
              {parked > 0 ? <span style={{ color: "var(--text-dim)" }}> · {copy.parked} {parked}</span> : null}
            </p>
            {needsAttention > 0 ? (
              <p className="pi-eyebrow tabular-nums" style={{ color: "var(--warning)" }}>{copy.overdue} {needsAttention}</p>
            ) : null}
          </header>

          {ideas.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--text-dim)" }}>{copy.noIdeas}</p>
          ) : (
            <ul className="m-0 flex list-none flex-col p-0">
              {ideas.map((idea) => (
                <IdeaRow
                  key={idea.id}
                  idea={idea}
                  copy={copy}
                  locale={locale}
                  today={today}
                  resources={library?.resources ?? []}
                  open={openId === idea.id}
                  onToggle={() => setOpenId(openId === idea.id ? null : idea.id)}
                  onAct={act}
                  onGone={() => { setOpenId(null); void refresh(); }}
                />
              ))}
            </ul>
          )}
        </section>

        <ProductResourceShelf
          locale={locale}
          resources={library?.resources ?? []}
          onRefresh={refreshLibrary}
        />
      </div>
    </main>
  );
}

/**
 * One idea: a line when closed, its note and links when open.
 *
 * The note is a draft held locally and saved on demand — an idea is written in
 * passes, and a field that saved on every keystroke would fight the 30s poll
 * for the same text.
 */
function IdeaRow({ idea, copy, locale, today, resources, open, onToggle, onAct, onGone }: {
  idea: Idea;
  copy: ProductCopy;
  locale: string;
  today: string;
  resources: ProductLibraryResource[];
  open: boolean;
  onToggle: () => void;
  onAct: <T,>(run: () => Promise<T>) => Promise<T | null>;
  onGone: () => void;
}) {
  const [note, setNote] = useState(idea.note);
  const [name, setName] = useState(idea.name);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const surface = stepSurface(idea.step, idea.parked);
  const step = playbookStep(idea.step);
  const zh = locale.startsWith("zh");
  const agent = useProductAgent();
  const attention = ideaAttention(idea, today);

  const save = async (patch: Record<string, unknown>, clearsDraft = false) => {
    setBusy(true);
    const saved = await onAct(() => jsonRequest(`/api/robin/products/${encodeURIComponent(idea.id)}`, "PATCH", patch));
    setBusy(false);
    // Stage, bet, link, and parked-state writes must not claim that a separate
    // name/note draft was saved. Only the button that sends that draft clears it.
    if (saved && clearsDraft) setDirty(false);
  };

  const firstLine = idea.note.split("\n").find((line) => line.trim()) ?? "";

  return (
    <li className="border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 pl-3 pr-1" style={{ borderLeft: surface.spine, background: open ? surface.wash : undefined }}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="ui-action flex min-h-[44px] min-w-0 basis-full items-center gap-2 text-left split:min-h-0 split:basis-auto split:flex-1 split:items-baseline"
        >
          {/* Both truncate, and the preview only appears where there is room
              for it. On a phone the name alone filled the row and, being
              unshrinkable, pushed itself under the state control. */}
          <span className="min-w-0 shrink truncate text-sm font-semibold" style={{ color: "var(--text)" }}>{idea.name}</span>
          {!open && firstLine ? (
            <span className="hidden min-w-0 flex-1 truncate text-xs split:block" style={{ color: "var(--text-muted)" }}>{firstLine}</span>
          ) : null}
        </button>

        {attention ? (
          <span className="pi-eyebrow shrink-0 whitespace-nowrap" style={{ color: "var(--warning)" }}>
            {attention === "overdue" ? copy.overdue : copy.stale}
          </span>
        ) : null}

        {idea.links.length > 0 ? (
          <span className="pi-eyebrow shrink-0 tabular-nums" title={copy.links}>{idea.links.length}</span>
        ) : null}

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

        <span className="pi-eyebrow hidden shrink-0 whitespace-nowrap split:inline">
          {new Date(idea.updatedAt).toLocaleDateString(locale, { month: "short", day: "numeric" })}
        </span>
      </div>

      {open ? (
        <div className="flex flex-col gap-3 py-3 pl-3 pr-1" style={{ borderLeft: surface.spine }}>
          <input
            value={name}
            disabled={busy}
            onChange={(event) => { setName(event.target.value); setDirty(true); }}
            aria-label={copy.ideaName}
            className="pi-panel min-h-[44px] w-full px-2 text-sm outline-none disabled:opacity-60"
          />

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
          <textarea
            value={note}
            disabled={busy}
            onChange={(event) => { setNote(event.target.value); setDirty(true); }}
            aria-label={copy.note}
            placeholder={copy.notePlaceholder}
            rows={6}
            className="pi-panel w-full resize-y p-2 text-sm outline-none disabled:opacity-60"
          />

          <Bet idea={idea} copy={copy} busy={busy} today={today} onSave={save} />

          <IdeaLinks idea={idea} copy={copy} busy={busy} onAct={onAct} onSave={save} />

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={busy || !dirty || !name.trim()}
              onClick={() => void save({ name: name.trim(), note }, true)}
              className="ui-action pi-bracket min-h-[44px] px-2 text-xs disabled:opacity-40 split:min-h-0 split:px-0"
              data-state="accent"
            >
              {copy.save}
            </button>
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
              className="ui-action ml-auto min-h-[44px] px-2 text-xs split:min-h-0 split:px-0"
              style={{ color: "var(--danger)" }}
              onClick={() => {
                if (!window.confirm(copy.deleteConfirm)) return;
                void fetch(`/api/robin/products/${encodeURIComponent(idea.id)}`, { method: "DELETE" }).then(onGone);
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

  return (
    <section className="pi-panel flex flex-col gap-3 p-3" style={{ borderLeft: stepSurface(idea.step, idea.parked).spine }}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="pi-eyebrow tabular-nums" style={{ color: stepSurface(idea.step, idea.parked).ink }}>
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
    <div className="flex flex-col gap-2">
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

      <div className="flex flex-wrap gap-2">
        <input
          value={claim}
          disabled={busy || !!settled}
          onChange={(event) => setClaim(event.target.value)}
          onBlur={() => { if (claim.trim() !== (idea.bet?.claim ?? "")) void onSave(claim.trim() ? { bet: { claim: claim.trim(), by } } : { bet: null }); }}
          placeholder={copy.betPlaceholder}
          aria-label={copy.bet}
          className="pi-panel min-h-[44px] min-w-0 flex-1 basis-64 px-2 text-sm outline-none disabled:opacity-60"
        />
        <input
          type="date"
          value={by}
          disabled={busy || !claim.trim() || !!settled}
          onChange={(event) => {
            setBy(event.target.value);
            if (claim.trim()) void onSave({ bet: { claim: claim.trim(), by: event.target.value } });
          }}
          aria-label={copy.betBy}
          className="pi-panel min-h-[44px] shrink-0 px-2 text-sm outline-none disabled:opacity-60"
        />
      </div>

      {claim.trim() && !settled ? (
        <div className="flex flex-wrap gap-3">
          <button type="button" disabled={busy} onClick={() => settle("held")} className="ui-action pi-bracket min-h-[44px] px-2 text-xs split:min-h-0 split:px-0">{copy.betHeld}</button>
          <button type="button" disabled={busy} onClick={() => settle("broke")} className="ui-action pi-bracket min-h-[44px] px-2 text-xs split:min-h-0 split:px-0" style={{ color: "var(--danger)" }}>{copy.betBroke}</button>
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
      {idea.links.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {idea.links.map((link) => (
            <li key={link.id} className="flex items-baseline gap-2">
              <a href={link.url} target="_blank" rel="noopener noreferrer" className="ui-action min-w-0 flex-1 truncate text-sm" style={{ color: "var(--text)" }}>
                {link.title}
              </a>
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
 * Capture, and the confirmation step between a suggestion and a record.
 *
 * The raw capture is kept whole whatever happens to it: classification only
 * ever proposes, and nothing is written until the proposal is confirmed here.
 */
function Capture({ captures, ideas, copy, locale, onDone }: {
  captures: ProductCapture[];
  ideas: Idea[];
  copy: ProductCopy;
  locale: string;
  onDone: () => Promise<void>;
}) {
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

  const save = () => run(async () => {
    if (!text.trim() && images.length === 0) return;
    const { capture } = await jsonRequest<{ capture: ProductCapture }>("/api/robin/products", "POST", { capture: true, text, images });
    setText("");
    setImages([]);
    await onDone();
    await classify(capture);
  });

  return (
    <section className="pi-card flex flex-col gap-3 p-4">
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={copy.capturePlaceholder}
        aria-label={copy.capturePlaceholder}
        rows={2}
        className="pi-panel w-full resize-y p-3 text-sm outline-none"
      />

      {images.length > 0 ? (
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
          hidden
          onChange={async (event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = "";
            const attached = await Promise.all(files.map((file) => compressImageFile(file).catch(() => null)));
            setImages((current) => [...current, ...attached.filter((item): item is { data: string; mimeType: string } => !!item)]);
          }}
        />
        <button type="button" onClick={() => fileRef.current?.click()} className="ui-action pi-bracket min-h-[44px] text-xs">
          {copy.attach}{images.length > 0 ? ` · ${images.length}` : ""}
        </button>
        <button
          type="button"
          disabled={busy || (!text.trim() && images.length === 0)}
          onClick={() => void save()}
          className="ui-action pi-bracket min-h-[44px] text-xs disabled:opacity-40"
          data-state="accent"
        >
          {busy ? copy.classifying : copy.capture}
        </button>
      </div>

      {captures.length > 0 ? (
        <div className="pi-panel flex flex-col gap-1 p-2">
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

      {error ? <p className="text-xs" style={{ color: "var(--danger)" }}>{error}</p> : null}

      {review ? (
        <Review
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
