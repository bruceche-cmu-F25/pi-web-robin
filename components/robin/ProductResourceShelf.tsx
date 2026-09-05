"use client";

import { useMemo, useState } from "react";
import type { ProductLibraryResource } from "@/extension/robin/product-domain";
import { iconFallback } from "@/extension/robin/links";
import { priceBand, type LibraryCategory, type LibraryStatus } from "@/extension/robin/product-shape";
import { shelfLogo } from "@/extension/robin/shelf-logos";
import { productCopy, type ProductCopy } from "./product-copy";
import { categoryChip } from "./productSurface";

const ORDER: LibraryCategory[] = ["source", "test", "tool", "stack", "distribution"];

/** Yours first, then what has been suggested; archived is out of the way. */
const RANK: Record<LibraryStatus, number> = { using: 0, saved: 1, recommended: 2, archived: 3 };

/**
 * The whole library, as one card per kind.
 *
 * It used to be a route of its own with a search box and four filter selects.
 * Both were answers to a question nobody was asking: with thirty-four rows
 * across five kinds, the kinds *are* the filter, and a second page meant the
 * shelf was somewhere you had to remember to visit rather than something you
 * could see. The cards flow like the Learning Hub's shelf, so a short category
 * follows the tall one instead of leaving an empty grid row between them.
 *
 * A card opens in place for the detail — what each item is for, what it costs,
 * and the star that pins it to the top of every shelf it appears on. Nothing
 * navigates.
 *
 * This is the second place the library appears, and deliberately: the step
 * card next to an idea shows only the shelf for the bench you are standing at,
 * and this shows the workshop.
 */
export function ProductResourceShelf({ locale, resources, onRefresh }: {
  locale: string;
  resources: ProductLibraryResource[];
  onRefresh: () => Promise<void>;
}) {
  const copy = productCopy(locale);
  const [open, setOpen] = useState<LibraryCategory | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const groups = useMemo(() => {
    const live = resources.filter((item) => item.status !== "archived");
    return ORDER
      .map((category) => ({
        category,
        items: live
          .filter((item) => item.category === category)
          .sort((a, b) => RANK[a.status] - RANK[b.status] || a.name.localeCompare(b.name)),
      }))
      .filter((group) => group.items.length > 0);
  }, [resources]);

  const patch = async (id: string, body: { status?: LibraryStatus; price?: string }) => {
    setBusy(id);
    setError(null);
    try {
      const response = await fetch("/api/robin/product-library", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      if (!response.ok) {
        const parsed = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(parsed?.error ?? `Request failed (${response.status})`);
      }
      await onRefresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  };

  if (groups.length === 0) return null;

  return (
    <>
      {error ? <p className="text-sm" style={{ color: "var(--danger)" }}>{error}</p> : null}
      <section aria-labelledby="product-resource-shelf-title">
        <h2 id="product-resource-shelf-title" className="pi-label mb-4">{copy.resources}</h2>
        <div style={{ columns: "300px", columnGap: "1rem" }}>
        {groups.map(({ category, items }) => {
          const expanded = open === category;
          return (
            <article
              key={category}
              className="pi-card mb-4 flex w-full break-inside-avoid flex-col gap-2 p-4"
              // Opened, it takes the whole measure: the detail carries a
              // summary and editable price per item, which need the width.
              style={expanded ? { columnSpan: "all" } : undefined}
            >
              <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="pi-eyebrow inline-block border px-1.5 py-0.5" style={categoryChip(category)}>{category}</span>
                <span className="pi-eyebrow tabular-nums">{items.length}</span>
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : category)}
                  aria-expanded={expanded}
                  className="ui-action pi-bracket ml-auto min-h-[44px] px-2 text-xs split:min-h-0 split:px-0"
                >
                  {expanded ? copy.close : copy.details}
                </button>
              </header>

              <p className="text-xs leading-relaxed" style={{ color: "var(--text-dim)" }}>{categoryBlurb(category, copy)}</p>

              {expanded ? (
                <ul className="m-0 flex list-none flex-col p-0">
                  {items.map((item) => (
                    <ResourceRow key={item.id} resource={item} copy={copy} busy={busy === item.id} onPatch={patch} />
                  ))}
                </ul>
              ) : (
                <ul className="m-0 flex list-none flex-col p-0">
                  {items.map((item) => <CompactResourceRow key={item.id} resource={item} />)}
                </ul>
              )}
            </article>
          );
        })}
        </div>
      </section>
    </>
  );
}

function categoryBlurb(category: LibraryCategory, copy: ProductCopy): string {
  return {
    source: copy.blurbSource,
    test: copy.blurbTest,
    tool: copy.blurbTool,
    stack: copy.blurbStack,
    distribution: copy.blurbDistribution,
  }[category];
}

type Patch = (id: string, body: { status?: LibraryStatus; price?: string }) => Promise<void>;

/** The Learning Hub's link row, with the extra context a product resource earns. */
function CompactResourceRow({ resource }: { resource: ProductLibraryResource }) {
  const row = (
    <>
      <ResourceMark resource={resource} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span
            className="text-[12.5px] leading-[1.35] group-hover:underline"
            style={{ color: resource.status === "using" ? "var(--text)" : "var(--text-muted)" }}
          >
            {resource.name}
          </span>
          {resource.url ? (
            <span className="pi-eyebrow shrink-0" style={{ fontSize: 9 }}>{hostOf(resource.url)}</span>
          ) : null}
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed" style={{ color: "var(--text-dim)" }}>
          {resource.summary}
        </span>
        <span className="pi-eyebrow mt-0.5 block" style={{ fontSize: 9 }}>{resource.price}</span>
      </span>
    </>
  );

  return (
    <li className="border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
      {resource.url ? (
        <a
          href={resource.url}
          target="_blank"
          rel="noopener noreferrer"
          title={resource.url}
          className="ui-action group flex items-start gap-2 py-2"
          style={{ textDecoration: "none" }}
        >
          {row}
        </a>
      ) : (
        <div className="group flex items-start gap-2 py-2">{row}</div>
      )}
    </li>
  );
}

/** The site's committed mark when available, otherwise a stable letter tile. */
function ResourceMark({ resource }: { resource: ProductLibraryResource }) {
  const [failed, setFailed] = useState(false);
  const logo = resource.url ? shelfLogo(fullHostOf(resource.url)) : null;

  if (logo && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logo}
        alt=""
        width={16}
        height={16}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className="site-mark mt-0.5"
      />
    );
  }

  const { letter, hue } = iconFallback({ title: resource.name, url: resource.url ?? "" });
  return (
    <span
      aria-hidden
      className="site-mark mt-0.5 flex items-center justify-center text-[10px]"
      style={{ background: `hsl(${hue} 22% 42%)`, color: "var(--pi-moonstone)" }}
    >
      {letter}
    </span>
  );
}

function fullHostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

function hostOf(url: string): string {
  return fullHostOf(url).replace(/^www\./, "");
}

function ResourceRow({ resource, copy, busy, onPatch }: { resource: ProductLibraryResource; copy: ProductCopy; busy: boolean; onPatch: Patch }) {
  const mine = resource.status === "using";
  return (
    <li className="flex items-baseline gap-3 border-b py-2.5 last:border-b-0" style={{ borderColor: "var(--border)" }}>
      {/* One bit, one click: this is the one you reach for, so every shelf it
          appears on should offer it first. Not a status to maintain. */}
      <button
        type="button"
        disabled={busy}
        onClick={() => void onPatch(resource.id, { status: mine ? "recommended" : "using" })}
        aria-pressed={mine}
        aria-label={`${resource.name} — ${copy.mine}`}
        title={copy.mine}
        className="ui-action min-h-8 shrink-0 px-1 text-sm disabled:opacity-40"
        style={{ color: mine ? "var(--accent)" : "var(--text-dim)" }}
      >
        {mine ? "★" : "☆"}
      </button>

      <div className="min-w-0 flex-1">
        {resource.url ? (
          <a href={resource.url} target="_blank" rel="noopener noreferrer" className="ui-action text-sm font-semibold" style={{ color: "var(--text)" }}>{resource.name}</a>
        ) : <strong className="text-sm" style={{ color: "var(--text)" }}>{resource.name}</strong>}
        <p className="mt-0.5 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>{resource.summary}</p>
        {resource.source ? <p className="pi-eyebrow mt-1">{resource.source}</p> : null}
      </div>

      <PriceCell resource={resource} copy={copy} busy={busy} onPatch={onPatch} />
    </li>
  );
}

/**
 * The price, and when anybody last confirmed it.
 *
 * These numbers come from screenshots and second-hand notes, and a price that
 * has quietly changed still reads as a fact — so the field is editable and the
 * write is what dates it (see updateLibraryResource). It stays plain text
 * until you click it: an input box on every row made the least-used column the
 * heaviest thing on the page.
 */
function PriceCell({ resource, copy, busy, onPatch }: { resource: ProductLibraryResource; copy: ProductCopy; busy: boolean; onPatch: Patch }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(resource.price);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (!next || next === resource.price) return;
    void onPatch(resource.id, { price: next });
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        disabled={busy}
        aria-label={`${resource.name} ${copy.price}`}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") { setDraft(resource.price); setEditing(false); }
        }}
        className="pi-panel min-h-8 w-32 shrink-0 px-2 text-xs"
      />
    );
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => { setDraft(resource.price); setEditing(true); }}
      title={resource.lastChecked ? `${copy.lastChecked} ${resource.lastChecked}` : copy.unverified}
      className="ui-action min-h-8 w-28 shrink-0 text-right text-xs disabled:opacity-40"
      style={{ color: priceBand(resource.price) === "free" ? "var(--text-muted)" : "var(--text-muted)" }}
    >
      {resource.price}
      {resource.lastChecked ? <span className="pi-eyebrow ml-1" style={{ color: "var(--text-dim)" }}>{resource.lastChecked}</span> : null}
    </button>
  );
}
