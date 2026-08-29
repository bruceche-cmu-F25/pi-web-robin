"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { toTraditionalChinese } from "@/lib/i18n/zh-traditional";
import { CodeProse } from "./CodeProse";
import { PythonSource } from "./PythonSource";
import type { Bilingual } from "@/extension/robin/research";
import {
  BLOCK_KINDS,
  EXTRACTION_DEFECT,
  SOURCE_FILE,
  TOTAL_LINES,
  WALKTHROUGH,
  type BlockKind,
  type WalkBlock,
} from "@/extension/robin/heat-walkthrough";

/**
 * visualize.py, line by line.
 *
 * The page's claim is that the blocks tile the file completely, and
 * heat-walkthrough.test.mjs holds that claim up — so the line range is
 * rendered as the primary identifier of every block rather than as a footnote.
 * You read this next to the file, and the range is how you keep your place.
 *
 * The one filter that earns its place is by `kind`. Reading top to bottom is
 * how you learn the pipeline; filtering to `bug` is how you decide what to fix
 * on the first day, and those are different visits to the same page.
 */

const KIND_TONE: Readonly<Record<BlockKind, string>> = {
  bug: "var(--danger)",
  trap: "var(--todo-clay)",
  dead: "var(--text-dim)",
  cost: "var(--todo-plum)",
  design: "var(--todo-teal)",
};

export function CodeWalkthrough() {
  const { locale, t } = useI18n();
  const [kind, setKind] = useState<BlockKind | null>(null);
  const [query, setQuery] = useState("");

  const say = useMemo(() => {
    if (locale === "en") return (value: Bilingual) => value.en;
    if (locale === "zh-TW") return (value: Bilingual) => toTraditionalChinese(value.zh);
    return (value: Bilingual) => value.zh;
  }, [locale]);

  const normalized = query.trim().toLocaleLowerCase();
  // A bare line number is the query you actually type when you are reading the
  // file alongside this page, so it gets its own path: find the block that
  // contains that line rather than the blocks that mention it.
  const lineQuery = /^\d+$/.test(normalized) ? Number(normalized) : null;

  const matches = useMemo(() => {
    const hit = (block: WalkBlock) => {
      if (kind && block.kind !== kind) return false;
      if (lineQuery !== null) return block.from <= lineQuery && lineQuery <= block.to;
      if (!normalized) return true;
      const haystack = [block.title.en, block.title.zh, block.note.en, block.note.zh, block.fn]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase();
      return haystack.includes(normalized);
    };
    return WALKTHROUGH
      .map((section) => ({ section, blocks: section.blocks.filter(hit) }))
      .filter((group) => group.blocks.length > 0);
  }, [kind, lineQuery, normalized]);

  const shown = matches.reduce((total, group) => total + group.blocks.length, 0);
  const totalBlocks = WALKTHROUGH.reduce((total, section) => total + section.blocks.length, 0);
  const filtering = kind !== null || normalized.length > 0;

  return (
    <div className="robin-page robin-dashboard flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
      <main className="mx-auto flex w-full max-w-[1320px] flex-col gap-6 p-4 desktop:p-6">
        <header className="flex flex-col gap-2">
          <a href="/research" className="ui-action pi-eyebrow" style={{ fontSize: 10, alignSelf: "flex-start" }}>
            ← {t("research.code.back")}
          </a>
          <h1 className="text-3xl" style={{ fontStyle: "italic", fontWeight: 400, color: "var(--text)" }}>
            {t("research.code.title")}
          </h1>
          <p className="pi-eyebrow">
            {t("research.code.subtitle", { file: SOURCE_FILE, lines: TOTAL_LINES, blocks: totalBlocks })}
          </p>
          <p style={{ maxWidth: "78ch", fontSize: 14, color: "var(--text-muted)", lineHeight: 1.6 }}>
            {t("research.code.lede")}
          </p>
          <p style={{ maxWidth: "78ch", fontSize: 12, color: "var(--text-dim)", lineHeight: 1.55 }}>
            {t("research.code.sourceNote")}
          </p>
        </header>

        <DefectCallout say={say} />

        <nav
          className="pi-card flex flex-wrap gap-x-4 gap-y-2 p-3"
          aria-label={t("research.code.sections")}
        >
          {WALKTHROUGH.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className="ui-action flex items-baseline gap-2"
              style={{ fontSize: 12.5, textDecoration: "none" }}
            >
              <code style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--text-dim)" }}>
                {section.from}–{section.to}
              </code>
              <span>{say(section.title)}</span>
            </a>
          ))}
        </nav>

        <div className="flex flex-wrap items-center gap-1.5">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("research.code.search")}
            aria-label={t("research.code.search")}
            style={{ minWidth: 200, flex: "0 1 280px" }}
          />
          <button
            type="button"
            onClick={() => setKind(null)}
            className="ui-action ui-action--chip pi-eyebrow px-2 py-1"
            data-active={kind === null}
            style={{ fontSize: 10 }}
          >
            {t("research.code.filter.all")}
          </button>
          {BLOCK_KINDS.map((value) => {
            const active = kind === value;
            const count = WALKTHROUGH.reduce(
              (total, section) => total + section.blocks.filter((block) => block.kind === value).length,
              0,
            );
            return (
              <button
                key={value}
                type="button"
                onClick={() => setKind(active ? null : value)}
                className="ui-action ui-action--chip pi-eyebrow px-2 py-1"
                data-active={active}
                style={{
                  fontSize: 10,
                  color: active ? KIND_TONE[value] : undefined,
                  borderColor: active ? KIND_TONE[value] : undefined,
                }}
              >
                {t(`research.code.kind.${value}`)} · {count}
              </button>
            );
          })}
          {filtering && (
            <button
              type="button"
              onClick={() => {
                setKind(null);
                setQuery("");
              }}
              className="ui-action pi-eyebrow px-2 py-1"
              style={{ fontSize: 10 }}
            >
              {t("research.filter.clear")}
            </button>
          )}
          <span
            className="pi-eyebrow"
            style={{ fontSize: 10, marginInlineStart: "auto", fontVariantNumeric: "tabular-nums" }}
          >
            {t("research.code.count", { shown, total: totalBlocks })}
          </span>
        </div>

        {matches.length === 0 ? (
          <p className="pi-card p-4" style={{ fontSize: 13, color: "var(--text-dim)" }}>
            {t("research.code.empty")}
          </p>
        ) : (
          matches.map(({ section, blocks }) => (
            <section key={section.id} id={section.id} className="flex flex-col gap-2" style={{ scrollMarginTop: 16 }}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="pi-label" style={{ fontSize: 12 }}>{say(section.title)}</h2>
                <code style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)" }}>
                  {SOURCE_FILE}:{section.from}–{section.to}
                </code>
                {section.step !== undefined && (
                  <span className="pi-eyebrow" style={{ fontSize: 9, color: "var(--todo-sage)" }}>
                    {t("research.code.step", { step: section.step })}
                  </span>
                )}
              </div>
              <ol className="flex flex-col gap-2">
                {blocks.map((block) => (
                  <li key={block.from}>
                    <BlockCard block={block} say={say} />
                  </li>
                ))}
              </ol>
            </section>
          ))
        )}
      </main>
    </div>
  );
}

type Say = (value: Bilingual) => string;

/**
 * The extraction defect, given the top of the page.
 *
 * It is placed above the walkthrough rather than left in its blocks because it
 * changes how the rest reads: once you know a "fact" is really a sentence, the
 * never-firing matching step and the size of the token bill stop being
 * separate puzzles. The four fields are kept apart so the claim can be checked
 * one part at a time — mechanism is a code reading, evidence is a count over
 * the committed reports, and those fail independently.
 */
function DefectCallout({ say }: { say: Say }) {
  const { t } = useI18n();
  const fields = [
    ["mechanism", EXTRACTION_DEFECT.mechanism],
    ["evidence", EXTRACTION_DEFECT.evidence],
    ["consequences", EXTRACTION_DEFECT.consequences],
    ["fix", EXTRACTION_DEFECT.fix],
  ] as const;

  return (
    <section
      className="pi-card flex flex-col gap-3 p-4"
      style={{ borderInlineStart: "4px solid var(--danger)" }}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 style={{ fontSize: 17, color: "var(--text)", lineHeight: 1.3 }}>
          {say(EXTRACTION_DEFECT.title)}
        </h2>
        <span className="pi-eyebrow" style={{ fontSize: 9, color: "var(--danger)" }}>
          {t("research.code.kind.bug")}
        </span>
      </div>
      {fields.map(([key, value]) => (
        <div key={key} className="flex flex-col gap-0.5">
          <span className="pi-eyebrow" style={{ fontSize: 9, color: "var(--text-dim)" }}>
            {t(`research.code.defect.${key}`)}
          </span>
          <CodeProse
            text={say(value)}
            style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, maxWidth: "80ch" }}
          />
        </div>
      ))}
    </section>
  );
}

/** One block: its line range, what happens there, and whether to stop. */
function BlockCard({ block, say }: { block: WalkBlock; say: Say }) {
  const { t } = useI18n();
  const tone = block.kind ? KIND_TONE[block.kind] : "var(--border)";

  return (
    <article className="pi-card flex flex-col gap-1.5 p-4" style={{ borderInlineStart: `4px solid ${tone}` }}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {/* The range leads: this page is read beside the file, and it is how
            you keep your place in it. */}
        <code
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "var(--text)",
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
          }}
        >
          {block.from === block.to ? block.from : `${block.from}–${block.to}`}
        </code>
        <h3 style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.35 }}>{say(block.title)}</h3>
        {block.fn && (
          <code style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--text-dim)", overflowWrap: "anywhere" }}>
            {block.fn}()
          </code>
        )}
        {block.kind && (
          <span className="pi-eyebrow" style={{ fontSize: 9, color: tone, marginInlineStart: "auto" }}>
            {t(`research.code.kind.${block.kind}`)}
          </span>
        )}
      </div>
      {/* Source left, reading right — but only where both fit. Below the
          split breakpoint the grid collapses to one column and the note falls
          back under the code it explains, which is the same order the DOM is
          already in. `items-start` keeps the note's first line level with the
          block's first line of code rather than centred against it.

          The single-column case is spelled out as minmax(0,1fr) rather than
          left implicit: a grid item's min-width is `auto`, so an implicit
          column sizes to the code's max-content width and the card grows to
          750px inside a 375px phone — which clipped the note rather than
          wrapping it.

          Two numbers here are measured rather than picked. The container is
          stated in pixels because the app's root font size is 13px, so the
          rem-based container steps land smaller than they read — max-w-7xl is
          1040px here, not the 1280 the name suggests, and that is not enough
          for two columns. And the 1.35 : 1 split follows visualize.py's own
          shape: its median line is 36 characters and its 90th percentile is
          87, so a code column holding ~90 lets nine lines in ten sit still,
          while what remains is still ~60 characters of prose. */}
      <div className="grid gap-2 grid-cols-[minmax(0,1fr)] split:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] split:items-start split:gap-4">
        <PythonSource from={block.from} to={block.to} />
        <CodeProse
          text={say(block.note)}
          style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}
        />
      </div>
    </article>
  );
}
