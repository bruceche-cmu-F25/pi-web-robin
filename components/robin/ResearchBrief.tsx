"use client";

import { useMemo } from "react";
import { useI18n } from "@/hooks/useI18n";
import { toTraditionalChinese } from "@/lib/i18n/zh-traditional";
import type { Bilingual } from "@/extension/robin/research";
import {
  BITES,
  BRIEF_META,
  FIRST_WEEK,
  HABITS,
  HEADLINE,
  INPUTS,
  PEOPLE,
  TRUST_MAP,
  type TrustLevel,
} from "@/extension/robin/heat-brief";
import { CodeProse } from "./CodeProse";

/**
 * The takeover briefing.
 *
 * Read once, before touching anything, so it is built to be skimmed in that
 * one pass: the headline is unmissable, every section is a list of short
 * entries rather than paragraphs, and nothing is behind an interaction. The
 * other three research pages are references you return to; this one you should
 * be able to finish.
 */

const TRUST_TONE: Readonly<Record<TrustLevel, string>> = {
  trust: "var(--success)",
  check: "var(--todo-honey)",
  wrong: "var(--danger)",
};

export function ResearchBrief() {
  const { locale, t } = useI18n();

  const say = useMemo(() => {
    if (locale === "en") return (value: Bilingual) => value.en;
    if (locale === "zh-TW") return (value: Bilingual) => toTraditionalChinese(value.zh);
    return (value: Bilingual) => value.zh;
  }, [locale]);

  const totalHours = FIRST_WEEK.reduce((sum, item) => sum + item.hours, 0);

  return (
    <div className="robin-page robin-dashboard flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 desktop:p-6">
        <header className="flex flex-col gap-2">
          <a href="/research" className="ui-action pi-eyebrow" style={{ fontSize: 10, alignSelf: "flex-start" }}>
            ← {t("research.code.back")}
          </a>
          <h1 className="text-3xl" style={{ fontStyle: "italic", fontWeight: 400, color: "var(--text)" }}>
            {say(BRIEF_META.title)}
          </h1>
          <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.55 }}>{say(BRIEF_META.subtitle)}</p>
          <p className="pi-eyebrow" style={{ fontSize: 10 }}>
            {t("research.report.written", { date: BRIEF_META.written })}
          </p>
          <p style={{ fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.6 }}>
            {say(BRIEF_META.readingOrder)}
          </p>
        </header>

        {/* The headline is the page's reason to exist, so it gets the weight
            and sits above the contents rather than inside them. */}
        <section
          className="pi-card flex flex-col gap-3 p-4"
          style={{ borderInlineStart: "4px solid var(--danger)" }}
        >
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 style={{ fontSize: 18, color: "var(--text)", lineHeight: 1.3 }}>{say(HEADLINE.title)}</h2>
            <span className="pi-eyebrow" style={{ fontSize: 9, color: "var(--danger)" }}>
              {t("research.brief.readThis")}
            </span>
          </div>
          <CodeProse
            text={say(HEADLINE.body)}
            style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.7 }}
          />
          <div style={{ borderInlineStart: "2px solid var(--accent-line)", paddingInlineStart: 10 }}>
            <span className="pi-eyebrow" style={{ fontSize: 9, color: "var(--accent)" }}>
              {t("research.brief.soWhat")}
            </span>
            <CodeProse
              text={say(HEADLINE.soWhat)}
              style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.65 }}
            />
          </div>
        </section>

        <Section number={1} heading={t("research.brief.trust")} blurb={t("research.brief.trustBlurb")}>
          {TRUST_MAP.map((row) => (
            <Entry
              key={row.id}
              title={say(row.item)}
              badge={t(`research.brief.verdict.${row.verdict}`)}
              badgeColor={TRUST_TONE[row.verdict]}
              body={say(row.why)}
              say={say}
            />
          ))}
        </Section>

        <Section number={2} heading={t("research.brief.bites")} blurb={t("research.brief.bitesBlurb")}>
          {BITES.map((bite) => (
            <article
              key={bite.id}
              className="pi-card flex flex-col gap-2 p-4"
              style={{ borderInlineStart: "4px solid var(--todo-clay)" }}
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.4, flex: "1 1 16ch" }}>
                  {say(bite.symptom)}
                </h3>
                <code style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-dim)" }}>
                  {bite.ref}
                </code>
              </div>
              <Field label={t("research.brief.cause")} body={say(bite.cause)} />
              <Field label={t("research.brief.fix")} body={say(bite.fix)} accent />
            </article>
          ))}
        </Section>

        <Section number={3} heading={t("research.brief.inputs")} blurb={t("research.brief.inputsBlurb")}>
          {INPUTS.map((row) => (
            <article key={row.id} className="pi-card flex flex-col gap-2 p-4">
              <code style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text)", overflowWrap: "anywhere" }}>
                {row.field}
              </code>
              {/* Two datasets side by side is the whole point of this section:
                  the rows where they differ are the rows that change plans. */}
              <div className="grid gap-2 split:grid-cols-2">
                <Dataset name="TriviaQA" body={say(row.triviaqa)} />
                <Dataset name="SQuAD" body={say(row.squad)} />
              </div>
              <Field label={t("research.brief.whyMatters")} body={say(row.why)} accent />
            </article>
          ))}
        </Section>

        <Section number={4} heading={t("research.brief.people")} blurb={t("research.brief.peopleBlurb")}>
          {PEOPLE.map((person) => (
            <article key={person.id} className="pi-card flex flex-col gap-2 p-4">
              <h3 style={{ fontSize: 14.5, color: "var(--text)", lineHeight: 1.4 }}>{say(person.who)}</h3>
              <Field label={t("research.brief.holds")} body={say(person.holds)} />
              <div className="flex flex-col gap-1">
                <span className="pi-eyebrow" style={{ fontSize: 9, color: "var(--accent)" }}>
                  {t("research.brief.ask")}
                </span>
                <ul className="flex flex-col gap-1.5">
                  {person.ask.map((question, index) => (
                    <li key={index} className="flex gap-2">
                      <span aria-hidden style={{ color: "var(--text-dim)", fontSize: 13 }}>·</span>
                      <CodeProse
                        text={say(question)}
                        style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </Section>

        <Section
          number={5}
          heading={t("research.brief.firstWeek")}
          blurb={t("research.brief.firstWeekBlurb", { hours: totalHours })}
        >
          <ol className="flex flex-col gap-2">
            {FIRST_WEEK.map((item, index) => (
              <li key={item.id}>
                <article className="pi-card flex flex-col gap-1.5 p-4">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span
                      className="pi-eyebrow"
                      style={{ fontSize: 10, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}
                    >
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <h3 style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.4, flex: "1 1 16ch" }}>
                      {say(item.what)}
                    </h3>
                    <span
                      className="pi-eyebrow"
                      style={{ fontSize: 9, color: "var(--todo-teal)", fontVariantNumeric: "tabular-nums" }}
                    >
                      {t("research.brief.hours", { hours: item.hours })}
                    </span>
                  </div>
                  <CodeProse
                    text={say(item.why)}
                    style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}
                  />
                </article>
              </li>
            ))}
          </ol>
        </Section>

        <Section number={6} heading={t("research.brief.habits")} blurb={t("research.brief.habitsBlurb")}>
          <ul className="flex flex-col gap-2">
            {HABITS.map((habit, index) => (
              <li key={index}>
                <div
                  className="pi-card p-4"
                  style={{ borderInlineStart: "4px solid var(--todo-sage)" }}
                >
                  <CodeProse
                    text={say(habit)}
                    style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.65 }}
                  />
                </div>
              </li>
            ))}
          </ul>
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

function Entry({ title, badge, badgeColor, body }: {
  title: string;
  badge: string;
  badgeColor: string;
  body: string;
  say: (value: Bilingual) => string;
}) {
  return (
    <article className="pi-card flex flex-col gap-1.5 p-4" style={{ borderInlineStart: `4px solid ${badgeColor}` }}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.4, flex: "1 1 16ch" }}>{title}</h3>
        <span className="pi-eyebrow" style={{ fontSize: 9, color: badgeColor }}>{badge}</span>
      </div>
      <CodeProse text={body} style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }} />
    </article>
  );
}

function Dataset({ name, body }: { name: string; body: string }) {
  return (
    <div className="flex flex-col gap-0.5" style={{ background: "var(--bg-hover)", padding: "8px 10px" }}>
      <span className="pi-eyebrow" style={{ fontSize: 9, color: "var(--text-dim)" }}>{name}</span>
      <CodeProse text={body} style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.55 }} />
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
