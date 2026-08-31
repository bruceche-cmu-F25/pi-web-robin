"use client";

import { useMemo } from "react";
import { useI18n } from "@/hooks/useI18n";
import { toTraditionalChinese } from "@/lib/i18n/zh-traditional";
import type { Bilingual } from "@/extension/robin/research";
import {
  ARCH_META,
  BRANCHES,
  LABELS,
  LADDER,
  MATH,
  MODULES,
  MODULE_GROUPS,
  OBSERVATIONS,
  OFFLINE_STAGES,
  ONLINE_RULES,
  ORIENTATION,
  THESIS,
  type ModuleGroup,
  type Severity,
} from "@/extension/robin/urrag-architecture";
import { CodeProse } from "./CodeProse";

/**
 * An orientation to the UR-RAG source repository.
 *
 * Built to be read once, top to bottom, beside an open editor — so it is
 * linear, nothing is behind an interaction, and every claim names the file it
 * came from. The other research pages filter and search because they are
 * references you return to; this one has an argument with an order, and a
 * filter would let a reader skip the two sections that reorganise the rest.
 */

const GROUP_TONE: Readonly<Record<ModuleGroup, string>> = {
  decide: "var(--todo-clay)",
  signal: "var(--todo-teal)",
  retrieve: "var(--todo-sage)",
  drive: "var(--todo-slate)",
  dead: "var(--text-dim)",
};

const SEVERITY_TONE: Readonly<Record<Severity, string>> = {
  high: "var(--danger)",
  medium: "var(--todo-honey)",
  low: "var(--text-dim)",
};

export function UrRagArchitecture() {
  const { locale, t } = useI18n();

  const say = useMemo(() => {
    if (locale === "en") return (value: Bilingual) => value.en;
    if (locale === "zh-TW") return (value: Bilingual) => toTraditionalChinese(value.zh);
    return (value: Bilingual) => value.zh;
  }, [locale]);

  // Grouped here rather than in the data file so the data stays a flat list
  // that a test can check exhaustively.
  const moduleGroups = useMemo(
    () => MODULE_GROUPS
      .map((group) => ({ group, rows: MODULES.filter((row) => row.group === group) }))
      .filter((entry) => entry.rows.length > 0),
    [],
  );

  return (
    <div className="robin-page robin-dashboard flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 desktop:p-6">
        <header className="flex flex-col gap-2">
          <a href="/research" className="ui-action pi-eyebrow" style={{ fontSize: 10, alignSelf: "flex-start" }}>
            ← {t("research.code.back")}
          </a>
          <h1 className="text-3xl" style={{ fontStyle: "italic", fontWeight: 400, color: "var(--text)" }}>
            {say(ARCH_META.title)}
          </h1>
          <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.55 }}>{say(ARCH_META.subtitle)}</p>
          <p className="pi-eyebrow" style={{ fontSize: 10 }}>
            {t("research.report.written", { date: ARCH_META.written })}
          </p>
          <code
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--text-dim)",
              overflowWrap: "anywhere",
            }}
          >
            {ARCH_META.repo} · {ARCH_META.branch}
          </code>
          <p style={{ fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.6 }}>{say(ARCH_META.framing)}</p>
        </header>

        {/* The premise correction sits above the contents because every other
            research page was written before it was known, and a reader who has
            seen them needs it replaced before anything below can land. */}
        <section className="pi-card flex flex-col gap-3 p-4" style={{ borderInlineStart: "4px solid var(--danger)" }}>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 style={{ fontSize: 18, color: "var(--text)", lineHeight: 1.3, flex: "1 1 20ch" }}>
              {say(ORIENTATION.title)}
            </h2>
            <span className="pi-eyebrow" style={{ fontSize: 9, color: "var(--danger)" }}>
              {t("research.arch.correction")}
            </span>
          </div>
          <CodeProse text={say(ORIENTATION.body)} style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.7 }} />
          <div style={{ borderInlineStart: "2px solid var(--accent-line)", paddingInlineStart: 10 }}>
            <span className="pi-eyebrow" style={{ fontSize: 9, color: "var(--accent)" }}>
              {t("research.brief.soWhat")}
            </span>
            <CodeProse text={say(ORIENTATION.soWhat)} style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.65 }} />
          </div>

          <ul className="flex flex-col gap-1.5">
            {BRANCHES.map((branch) => (
              <li key={branch.id} className="flex flex-col gap-0.5" style={{ background: "var(--bg-hover)", padding: "8px 10px" }}>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <code style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--text)", overflowWrap: "anywhere" }}>
                    {branch.name}
                  </code>
                  <span style={{ fontSize: 12, color: "var(--text-muted)", flex: "1 1 16ch" }}>{say(branch.holds)}</span>
                </div>
                <CodeProse text={say(branch.note)} style={{ fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.55 }} />
              </li>
            ))}
          </ul>
        </section>

        <section className="pi-card flex flex-col gap-2 p-4" style={{ borderInlineStart: "4px solid var(--accent)" }}>
          <h2 style={{ fontSize: 16, color: "var(--text)", lineHeight: 1.35 }}>{say(THESIS.title)}</h2>
          <CodeProse text={say(THESIS.body)} style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.7 }} />
        </section>

        <Section number={1} heading={t("research.arch.modules")} blurb={t("research.arch.modulesBlurb")}>
          {moduleGroups.map(({ group, rows }) => (
            <div key={group} className="flex flex-col gap-2">
              <h3 className="pi-eyebrow" style={{ fontSize: 10, color: GROUP_TONE[group] }}>
                {t(`research.arch.group.${group}`)}
              </h3>
              {rows.map((row) => (
                <article
                  key={row.id}
                  className="pi-card flex flex-col gap-1.5 p-4"
                  style={{ borderInlineStart: `4px solid ${GROUP_TONE[group]}` }}
                >
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <code style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text)", overflowWrap: "anywhere", flex: "1 1 20ch" }}>
                      {row.path}
                    </code>
                    {row.readFirst && (
                      <span className="pi-eyebrow" style={{ fontSize: 9, color: "var(--accent)" }}>
                        {t("research.arch.readFirst")}
                      </span>
                    )}
                  </div>
                  <p style={{ fontSize: 13.5, color: "var(--text)", lineHeight: 1.45 }}>{say(row.role)}</p>
                  <CodeProse text={say(row.note)} style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }} />
                </article>
              ))}
            </div>
          ))}
        </Section>

        <Section number={2} heading={t("research.arch.offline")} blurb={t("research.arch.offlineBlurb")}>
          <ol className="flex flex-col gap-2">
            {OFFLINE_STAGES.map((stage) => (
              <li key={stage.id}>
                <article className="pi-card flex flex-col gap-1.5 p-4">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span
                      className="pi-eyebrow"
                      style={{ fontSize: 10, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}
                    >
                      {String(stage.step).padStart(2, "0")}
                    </span>
                    <h3 style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.4, flex: "1 1 16ch" }}>
                      {say(stage.name)}
                    </h3>
                    <code style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-dim)", overflowWrap: "anywhere" }}>
                      {stage.script}
                    </code>
                  </div>
                  {/* Input and output are the two things you cannot infer from
                      the prose, and the usual reason for getting lost here. */}
                  <div className="grid gap-2 split:grid-cols-2">
                    <Slot label={t("research.arch.stageIn")} value={stage.input} />
                    <Slot label={t("research.arch.stageOut")} value={stage.output} />
                  </div>
                  <CodeProse text={say(stage.does)} style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }} />
                </article>
              </li>
            ))}
          </ol>
        </Section>

        <Section number={3} heading={t("research.arch.labels")} blurb={t("research.arch.labelsBlurb")}>
          {LABELS.map((row) => (
            <article key={row.id} className="pi-card flex flex-col gap-2 p-4" style={{ borderInlineStart: "4px solid var(--todo-clay)" }}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <code style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text)" }}>{row.name}</code>
                <span style={{ fontSize: 13, color: "var(--text-muted)", flex: "1 1 16ch" }}>{say(row.meaning)}</span>
              </div>
              <Rule value={row.rule} />
              <CodeProse text={say(row.why)} style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }} />
            </article>
          ))}
        </Section>

        <Section number={4} heading={t("research.arch.math")} blurb={t("research.arch.mathBlurb")}>
          {MATH.map((formula) => (
            <article key={formula.id} className="pi-card flex flex-col gap-2 p-4">
              <h3 className="pi-eyebrow" style={{ fontSize: 10 }}>{say(formula.label)}</h3>
              <pre
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  color: "var(--text)",
                  lineHeight: 1.65,
                  background: "var(--bg-hover)",
                  padding: "10px 12px",
                  overflowX: "auto",
                  margin: 0,
                }}
              >
                {formula.expression}
              </pre>
              <CodeProse text={say(formula.gloss)} style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }} />
            </article>
          ))}
        </Section>

        <Section number={5} heading={t("research.arch.online")} blurb={t("research.arch.onlineBlurb")}>
          {ONLINE_RULES.map((rule) => (
            <article key={rule.id} className="pi-card flex flex-col gap-1.5 p-4" style={{ borderInlineStart: "4px solid var(--todo-teal)" }}>
              <h3 style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.4 }}>{say(rule.rule)}</h3>
              <CodeProse text={say(rule.why)} style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }} />
            </article>
          ))}
        </Section>

        <Section number={6} heading={t("research.arch.ladder")} blurb={t("research.arch.ladderBlurb")}>
          {LADDER.map((rung, index) => (
            <article key={rung.id} className="pi-card flex flex-col gap-1.5 p-4">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="pi-eyebrow" style={{ fontSize: 10, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3 style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.4, flex: "1 1 16ch" }}>{say(rung.name)}</h3>
              </div>
              <Rule value={rung.gate} label={t("research.arch.ladderGate")} />
              <CodeProse text={say(rung.reads)} style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }} />
            </article>
          ))}
        </Section>

        <Section number={7} heading={t("research.arch.observations")} blurb={t("research.arch.observationsBlurb")}>
          {OBSERVATIONS.map((row) => (
            <article
              key={row.id}
              className="pi-card flex flex-col gap-1.5 p-4"
              style={{ borderInlineStart: `4px solid ${SEVERITY_TONE[row.severity]}` }}
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.4, flex: "1 1 16ch" }}>{say(row.what)}</h3>
                <span className="pi-eyebrow" style={{ fontSize: 9, color: SEVERITY_TONE[row.severity] }}>
                  {t(`research.arch.severity.${row.severity}`)}
                </span>
              </div>
              <code style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--text-dim)", overflowWrap: "anywhere" }}>
                {row.where}
              </code>
              <CodeProse text={say(row.why)} style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }} />
            </article>
          ))}
        </Section>
      </main>
    </div>
  );
}

function Section({ number, heading, blurb, children }: {
  number: number;
  heading: string;
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 style={{ fontSize: 19, color: "var(--text)", lineHeight: 1.3 }}>
        <span
          className="pi-eyebrow"
          style={{ fontSize: 11, color: "var(--text-dim)", marginInlineEnd: 10, fontVariantNumeric: "tabular-nums" }}
        >
          {number}
        </span>
        {heading}
      </h2>
      <p style={{ fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.6 }}>{blurb}</p>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

function Slot({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5" style={{ background: "var(--bg-hover)", padding: "8px 10px" }}>
      <span className="pi-eyebrow" style={{ fontSize: 9, color: "var(--text-dim)" }}>{label}</span>
      <code style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--text-muted)", overflowWrap: "anywhere" }}>
        {value}
      </code>
    </div>
  );
}

function Rule({ value, label }: { value: string; label?: string }) {
  return (
    <div style={{ borderInlineStart: "2px solid var(--accent-line)", paddingInlineStart: 10 }}>
      {label && (
        <span className="pi-eyebrow" style={{ fontSize: 9, color: "var(--accent)" }}>{label}</span>
      )}
      <code style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text)", lineHeight: 1.55, overflowWrap: "anywhere" }}>
        {value}
      </code>
    </div>
  );
}
