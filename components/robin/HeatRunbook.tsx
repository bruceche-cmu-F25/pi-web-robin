"use client";

import { useMemo } from "react";
import { useI18n } from "@/hooks/useI18n";
import { toTraditionalChinese } from "@/lib/i18n/zh-traditional";
import type { Bilingual } from "@/extension/robin/research";
import {
  CALL_SITES,
  COMMITTED_RUNS,
  DISCIPLINE,
  EDITS,
  FAILURES,
  PREREQS,
  REALITY,
  RUN_META,
  STEPS,
  UNKNOWNS,
  type Severity,
} from "@/extension/robin/heat-runbook";
import { CodeProse } from "./CodeProse";

/**
 * The runbook.
 *
 * Read beside a terminal rather than in one sitting, so unlike the other
 * research pages this one is built for jumping: every section is short, the
 * commands are the visual anchors, and the failure table is symptom-first
 * because a symptom is what the reader will have when they come back to it.
 *
 * Nothing here explains the algorithm — /research already has the ten-step
 * account and /research/code has it line by line. This page is only about
 * getting it to run.
 */

const SEVERITY_TONE: Readonly<Record<Severity, string>> = {
  stop: "var(--danger)",
  warn: "var(--todo-honey)",
  note: "var(--text-dim)",
};

export function HeatRunbook() {
  const { locale, t } = useI18n();

  const say = useMemo(() => {
    if (locale === "en") return (value: Bilingual) => value.en;
    if (locale === "zh-TW") return (value: Bilingual) => toTraditionalChinese(value.zh);
    return (value: Bilingual) => value.zh;
  }, [locale]);

  return (
    <div className="robin-page robin-dashboard flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 desktop:p-6">
        <header className="flex flex-col gap-2">
          <a href="/research" className="ui-action pi-eyebrow" style={{ fontSize: 10, alignSelf: "flex-start" }}>
            ← {t("research.code.back")}
          </a>
          <h1 className="text-3xl" style={{ fontStyle: "italic", fontWeight: 400, color: "var(--text)" }}>
            {say(RUN_META.title)}
          </h1>
          <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.55 }}>{say(RUN_META.subtitle)}</p>
          <p className="pi-eyebrow" style={{ fontSize: 10 }}>
            {t("research.report.written", { date: RUN_META.written })}
          </p>
          <code style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)" }}>
            {RUN_META.repo}
          </code>
          <p style={{ fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.6 }}>{say(RUN_META.framing)}</p>
        </header>

        {/* The temperature constraint sits above everything because it decides
            what the week is allowed to aim at. A reader who scrolls past it
            will spend days chasing a difference that is supposed to be there. */}
        <Section number={1} heading={t("research.run.reality")} blurb={t("research.run.realityBlurb")}>
          <article className="pi-card flex flex-col gap-3 p-4" style={{ borderInlineStart: "4px solid var(--danger)" }}>
            <h3 style={{ fontSize: 17, color: "var(--text)", lineHeight: 1.3 }}>{say(REALITY.title)}</h3>
            <CodeProse text={say(REALITY.body)} style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.7 }} />
            <div style={{ borderInlineStart: "2px solid var(--accent-line)", paddingInlineStart: 10 }}>
              <span className="pi-eyebrow" style={{ fontSize: 9, color: "var(--accent)" }}>
                {t("research.run.goals")}
              </span>
              <CodeProse text={say(REALITY.goals)} style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.65 }} />
            </div>
          </article>
        </Section>

        <Section number={2} heading={t("research.run.target")} blurb={t("research.run.targetBlurb")}>
          {COMMITTED_RUNS.map((run) => (
            <article key={run.id} className="pi-card flex flex-col gap-2 p-4">
              <h3 style={{ fontSize: 15, color: "var(--text)", lineHeight: 1.4 }}>{run.name}</h3>
              {/* The measured figures, not estimates — they are the only basis
                  for pricing a rerun, so they get their own grid. */}
              <div className="grid gap-2 split:grid-cols-2">
                <Slot label={t("research.run.input")} value={run.input} />
                <Slot label={t("research.run.outputDir")} value={run.outputDir} />
                <Slot label={t("research.run.records")} value={run.records} />
                <Slot label={t("research.run.tokens")} value={run.tokens} />
                <Slot label={t("research.run.wall")} value={run.wallClock} />
                <Slot label={t("research.run.result")} value={`${run.threshold} · ${run.accuracy}`} />
              </div>
              <CodeProse text={say(run.note)} style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }} />
            </article>
          ))}
        </Section>

        <Section number={3} heading={t("research.run.edits")} blurb={t("research.run.editsBlurb")}>
          <article className="pi-card flex flex-col gap-2 p-4" style={{ borderInlineStart: "4px solid var(--danger)" }}>
            <h3 style={{ fontSize: 15, color: "var(--text)", lineHeight: 1.4 }}>{say(EDITS.headline)}</h3>
            <CodeProse text={say(EDITS.body)} style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.65 }} />
          </article>
          {EDITS.rows.map((row) => (
            <article key={row.id} className="pi-card flex flex-col gap-1.5 p-4">
              <code style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--text-dim)" }}>{row.ref}</code>
              <pre style={PRE} >{row.current}</pre>
              <CodeProse text={say(row.why)} style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }} />
            </article>
          ))}
        </Section>

        <Section number={4} heading={t("research.run.steps")} blurb={t("research.run.stepsBlurb")}>
          <ol className="flex flex-col gap-2">
            {STEPS.map((step) => (
              <li key={step.id}>
                <article className="pi-card flex flex-col gap-2 p-4">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span
                      className="pi-eyebrow"
                      style={{ fontSize: 10, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}
                    >
                      {String(step.n).padStart(2, "0")}
                    </span>
                    <h3 style={{ fontSize: 14.5, color: "var(--text)", lineHeight: 1.4, flex: "1 1 16ch" }}>
                      {say(step.title)}
                    </h3>
                  </div>
                  {step.command && <pre style={PRE}>{step.command}</pre>}
                  <CodeProse text={say(step.expect)} style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }} />
                  {step.watch && (
                    <div style={{ borderInlineStart: "2px solid var(--todo-honey)", paddingInlineStart: 10 }}>
                      <span className="pi-eyebrow" style={{ fontSize: 9, color: "var(--todo-honey)" }}>
                        {t("research.run.watch")}
                      </span>
                      <CodeProse text={say(step.watch)} style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.6 }} />
                    </div>
                  )}
                </article>
              </li>
            ))}
          </ol>
        </Section>

        <Section number={5} heading={t("research.run.cost")} blurb={t("research.run.costBlurb")}>
          {CALL_SITES.map((site) => (
            <article key={site.id} className="pi-card flex flex-col gap-1 p-4">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <code style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--text)", flex: "1 1 16ch" }}>
                  {site.fn}
                </code>
                <code style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-dim)" }}>{site.ref}</code>
              </div>
              <CodeProse text={say(site.perRecord)} style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }} />
            </article>
          ))}
        </Section>

        <Section number={6} heading={t("research.run.failures")} blurb={t("research.run.failuresBlurb")}>
          {FAILURES.map((row) => (
            <article
              key={row.id}
              className="pi-card flex flex-col gap-2 p-4"
              style={{ borderInlineStart: `4px solid ${SEVERITY_TONE[row.severity]}` }}
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.4, flex: "1 1 16ch" }}>
                  {say(row.symptom)}
                </h3>
                <span className="pi-eyebrow" style={{ fontSize: 9, color: SEVERITY_TONE[row.severity] }}>
                  {t(`research.run.severity.${row.severity}`)}
                </span>
              </div>
              <Field label={t("research.brief.cause")} body={say(row.cause)} />
              <Field label={t("research.brief.fix")} body={say(row.action)} accent />
            </article>
          ))}
        </Section>

        <Section number={7} heading={t("research.run.unknowns")} blurb={t("research.run.unknownsBlurb")}>
          <ul className="flex flex-col gap-2">
            {UNKNOWNS.map((item, index) => (
              <li key={index}>
                <div className="pi-card p-4" style={{ borderInlineStart: "4px solid var(--todo-slate)" }}>
                  <CodeProse text={say(item)} style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.65 }} />
                </div>
              </li>
            ))}
          </ul>
        </Section>

        <section className="pi-card flex flex-col gap-2 p-4" style={{ borderInlineStart: "4px solid var(--todo-sage)" }}>
          <h2 style={{ fontSize: 17, color: "var(--text)", lineHeight: 1.35 }}>{say(DISCIPLINE.title)}</h2>
          <CodeProse text={say(DISCIPLINE.body)} style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.7 }} />
        </section>

        <Section number={8} heading={t("research.run.prereqs")} blurb={t("research.run.prereqsBlurb")}>
          {PREREQS.map((row) => (
            <article key={row.id} className="pi-card flex flex-col gap-1.5 p-4">
              <h3 style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.4 }}>{say(row.what)}</h3>
              <CodeProse text={say(row.detail)} style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }} />
              {row.gotcha && <Field label={t("research.run.gotcha")} body={say(row.gotcha)} accent />}
            </article>
          ))}
        </Section>
      </main>
    </div>
  );
}

const PRE: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  color: "var(--text)",
  lineHeight: 1.65,
  background: "var(--bg-hover)",
  padding: "10px 12px",
  overflowX: "auto",
  margin: 0,
};

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

function Field({ label, body, accent }: { label: string; body: string; accent?: boolean }) {
  return (
    <div
      className="flex flex-col gap-0.5"
      style={accent ? { borderInlineStart: "2px solid var(--accent-line)", paddingInlineStart: 10 } : undefined}
    >
      <span className="pi-eyebrow" style={{ fontSize: 9, color: accent ? "var(--accent)" : "var(--text-dim)" }}>
        {label}
      </span>
      <CodeProse
        text={body}
        style={{ fontSize: 13, color: accent ? "var(--text)" : "var(--text-muted)", lineHeight: 1.6 }}
      />
    </div>
  );
}
