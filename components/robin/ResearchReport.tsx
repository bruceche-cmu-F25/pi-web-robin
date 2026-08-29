"use client";

import { useMemo } from "react";
import { useI18n } from "@/hooks/useI18n";
import { toTraditionalChinese } from "@/lib/i18n/zh-traditional";
import type { Bilingual } from "@/extension/robin/research";
import {
  CLAIM_LEDGER,
  REPORT,
  REPORT_META,
  REPRODUCTION,
  type ClaimStatus,
} from "@/extension/robin/heat-report";
import { CodeProse } from "./CodeProse";

/**
 * The takeover report.
 *
 * Written as a document rather than a dashboard: one column, numbered
 * sections, no filters. The stack and the walkthrough are things you search;
 * this is a thing you read once, front to back, before a meeting — and adding
 * controls to it would only invite skimming the part you already agree with.
 *
 * The two structured appendices are the exception, and they earn it. The claim
 * ledger is what makes the narrative auditable — status, basis, and what would
 * move it, per row — and the reproduction list is what makes the ledger
 * checkable rather than trusted. Prose alone would let three pages of
 * confident writing launder assertions into facts.
 */

const STATUS_TONE: Readonly<Record<ClaimStatus, string>> = {
  established: "var(--success)",
  "at-risk": "var(--todo-honey)",
  refuted: "var(--danger)",
  untested: "var(--text-dim)",
  unverified: "var(--todo-plum)",
};

export function ResearchReport() {
  const { locale, t } = useI18n();

  const say = useMemo(() => {
    if (locale === "en") return (value: Bilingual) => value.en;
    if (locale === "zh-TW") return (value: Bilingual) => toTraditionalChinese(value.zh);
    return (value: Bilingual) => value.zh;
  }, [locale]);

  return (
    <div className="robin-page robin-dashboard flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
      {/* Narrower than the other two pages on purpose: this one is read as
          prose, and a measure much past 80 characters stops being readable. */}
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 desktop:p-6">
        <header className="flex flex-col gap-2">
          <a href="/research" className="ui-action pi-eyebrow" style={{ fontSize: 10, alignSelf: "flex-start" }}>
            ← {t("research.code.back")}
          </a>
          <h1 className="text-3xl" style={{ fontStyle: "italic", fontWeight: 400, color: "var(--text)" }}>
            {say(REPORT_META.title)}
          </h1>
          <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.55 }}>
            {say(REPORT_META.subtitle)}
          </p>
          <p className="pi-eyebrow" style={{ fontSize: 10 }}>
            {t("research.report.written", { date: REPORT_META.written })}
          </p>
        </header>

        <p
          className="pi-card p-4"
          style={{ fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.6, borderInlineStart: "4px solid var(--border)" }}
        >
          {say(REPORT_META.scope)}
        </p>

        <nav className="flex flex-col gap-1" aria-label={t("research.report.contents")}>
          <h2 className="pi-label" style={{ fontSize: 11 }}>{t("research.report.contents")}</h2>
          <ol className="flex flex-col gap-0.5">
            {REPORT.map((section) => (
              <li key={section.id} className="flex items-baseline gap-2">
                <span
                  className="pi-eyebrow"
                  style={{ fontSize: 10, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums", minWidth: "1.6em" }}
                >
                  {section.number}
                </span>
                <a href={`#${section.id}`} className="ui-action" style={{ fontSize: 13, textDecoration: "none" }}>
                  {say(section.heading)}
                </a>
                {section.finding && (
                  <span className="pi-eyebrow" style={{ fontSize: 9, color: "var(--danger)" }}>
                    {t("research.report.finding")}
                  </span>
                )}
              </li>
            ))}
            <li className="flex items-baseline gap-2">
              <span className="pi-eyebrow" style={{ fontSize: 10, color: "var(--text-dim)", minWidth: "1.6em" }}>A</span>
              <a href="#ledger" className="ui-action" style={{ fontSize: 13, textDecoration: "none" }}>
                {t("research.report.ledger")}
              </a>
            </li>
            <li className="flex items-baseline gap-2">
              <span className="pi-eyebrow" style={{ fontSize: 10, color: "var(--text-dim)", minWidth: "1.6em" }}>B</span>
              <a href="#reproduction" className="ui-action" style={{ fontSize: 13, textDecoration: "none" }}>
                {t("research.report.reproduction")}
              </a>
            </li>
          </ol>
        </nav>

        {REPORT.map((section) => (
          <section key={section.id} id={section.id} className="flex flex-col gap-2" style={{ scrollMarginTop: 16 }}>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 style={{ fontSize: 19, color: "var(--text)", lineHeight: 1.3 }}>
                <span
                  className="pi-eyebrow"
                  style={{ fontSize: 11, color: "var(--text-dim)", marginInlineEnd: 10, fontVariantNumeric: "tabular-nums" }}
                >
                  {section.number}
                </span>
                {say(section.heading)}
              </h2>
              {section.finding && (
                <span className="pi-eyebrow" style={{ fontSize: 9, color: "var(--danger)" }}>
                  {t("research.report.finding")}
                </span>
              )}
            </div>
            {section.body.map((paragraph, index) => (
              <CodeProse
                key={index}
                text={say(paragraph)}
                style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.75 }}
              />
            ))}
          </section>
        ))}

        <section id="ledger" className="flex flex-col gap-2" style={{ scrollMarginTop: 16 }}>
          <h2 style={{ fontSize: 19, color: "var(--text)", lineHeight: 1.3 }}>
            <span className="pi-eyebrow" style={{ fontSize: 11, color: "var(--text-dim)", marginInlineEnd: 10 }}>A</span>
            {t("research.report.ledger")}
          </h2>
          <p style={{ fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.6 }}>
            {t("research.report.ledgerBlurb")}
          </p>
          <ul className="flex flex-col gap-2">
            {CLAIM_LEDGER.map((claim) => (
              <li key={claim.id}>
                <article
                  className="pi-card flex flex-col gap-2 p-4"
                  style={{ borderInlineStart: `4px solid ${STATUS_TONE[claim.status]}` }}
                >
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h3 style={{ fontSize: 14.5, color: "var(--text)", lineHeight: 1.4, flex: "1 1 16ch" }}>
                      {say(claim.claim)}
                    </h3>
                    <span className="pi-eyebrow" style={{ fontSize: 9, color: STATUS_TONE[claim.status] }}>
                      {t(`research.report.status.${claim.status}`)}
                    </span>
                  </div>
                  <Field label={t("research.report.basis")} body={say(claim.basis)} />
                  <Field label={t("research.report.moves")} body={say(claim.moves)} />
                </article>
              </li>
            ))}
          </ul>
        </section>

        <section id="reproduction" className="flex flex-col gap-2" style={{ scrollMarginTop: 16 }}>
          <h2 style={{ fontSize: 19, color: "var(--text)", lineHeight: 1.3 }}>
            <span className="pi-eyebrow" style={{ fontSize: 11, color: "var(--text-dim)", marginInlineEnd: 10 }}>B</span>
            {t("research.report.reproduction")}
          </h2>
          <p style={{ fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.6 }}>
            {t("research.report.reproductionBlurb")}
          </p>
          <ul className="flex flex-col gap-2">
            {REPRODUCTION.map((check) => (
              <li key={check.id}>
                <article className="pi-card flex flex-col gap-2 p-4">
                  <h3 style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.4 }}>{say(check.question)}</h3>
                  {/* The command has to survive being copied, so it scrolls
                      inside its own box rather than wrapping mid-token. */}
                  <pre
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 11.5,
                      lineHeight: 1.55,
                      color: "var(--text)",
                      background: "var(--bg-hover)",
                      border: "1px solid var(--border)",
                      padding: "10px 12px",
                      overflowX: "auto",
                      margin: 0,
                    }}
                  >
                    {check.command}
                  </pre>
                  <Field label={t("research.report.expect")} body={say(check.result)} />
                </article>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}

function Field({ label, body }: { label: string; body: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="pi-eyebrow" style={{ fontSize: 9, color: "var(--text-dim)" }}>
        {label}
      </span>
      <CodeProse text={body} style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }} />
    </div>
  );
}
