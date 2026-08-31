"use client";

import { useI18n } from "@/hooks/useI18n";

const YOUTUBE_URL = "https://www.youtube.com/watch?v=l8pRSuU81PU";
const CODE_URL = "https://github.com/karpathy/build-nanogpt";
const LECTURE_INDEX_URL = "https://github.com/karpathy/nn-zero-to-hero";

/**
 * A deliberately separate deep dive: GPT-2 teaches model internals, while the
 * main curriculum teaches the web systems around a model. Keeping it here
 * prevents the resource from becoming a second mandatory course queue.
 */
export function GPT2Walkthrough() {
  const { t } = useI18n();
  const sessions = [
    ["01", "learn.gpt2.session1.title", "learn.gpt2.session1.body"],
    ["02", "learn.gpt2.session2.title", "learn.gpt2.session2.body"],
    ["03", "learn.gpt2.session3.title", "learn.gpt2.session3.body"],
    ["04", "learn.gpt2.session4.title", "learn.gpt2.session4.body"],
    ["05", "learn.gpt2.session5.title", "learn.gpt2.session5.body"],
    ["06", "learn.gpt2.session6.title", "learn.gpt2.session6.body"],
  ] as const;

  return (
    <div className="robin-page robin-dashboard flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 desktop:p-6">
        <a
          href="/learn"
          className="ui-action pi-chrome-label pi-bracket self-start"
          style={{ fontSize: 11, textDecoration: "none" }}
        >
          ← {t("learn.gpt2.back")}
        </a>

        <header className="pi-panel flex flex-col gap-3 p-5 desktop:p-7">
          <span className="pi-eyebrow">{t("learn.gpt2.eyebrow")}</span>
          <h1 className="text-3xl" style={{ fontStyle: "italic", fontWeight: 400, color: "var(--text)" }}>
            {t("learn.gpt2.title")}
          </h1>
          <p className="max-w-3xl" style={{ color: "var(--text-muted)", fontSize: 15, lineHeight: 1.7 }}>
            {t("learn.gpt2.intro")}
          </p>
          <p className="max-w-3xl" style={{ color: "var(--text-dim)", fontSize: 12.5, lineHeight: 1.6 }}>
            {t("learn.gpt2.position")}
          </p>
        </header>

        <section className="grid gap-4 desktop:grid-cols-2" aria-labelledby="gpt2-resources">
          <h2 id="gpt2-resources" className="sr-only">{t("learn.gpt2.resources")}</h2>
          <ResourceCard
            eyebrow={t("learn.gpt2.videoLabel")}
            title={t("learn.gpt2.videoTitle")}
            body={t("learn.gpt2.videoBody")}
            href={YOUTUBE_URL}
            action={t("learn.gpt2.openVideo")}
          />
          <ResourceCard
            eyebrow={t("learn.gpt2.codeLabel")}
            title={t("learn.gpt2.codeTitle")}
            body={t("learn.gpt2.codeBody")}
            href={CODE_URL}
            action={t("learn.gpt2.openCode")}
          />
        </section>

        <section className="pi-panel flex flex-col gap-4 p-5" aria-labelledby="gpt2-plan">
          <div>
            <span className="pi-eyebrow">{t("learn.gpt2.planEyebrow")}</span>
            <h2 id="gpt2-plan" className="mt-1 text-xl" style={{ color: "var(--text)" }}>
              {t("learn.gpt2.planTitle")}
            </h2>
            <p className="mt-1" style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6 }}>
              {t("learn.gpt2.planBody")}
            </p>
          </div>
          <ol className="flex flex-col">
            {sessions.map(([number, titleKey, bodyKey]) => (
              <li key={number} className="flex gap-3 border-t py-4" style={{ borderColor: "var(--border)" }}>
                <span className="pi-eyebrow shrink-0" style={{ color: "var(--accent)", fontSize: 11 }}>
                  {number}
                </span>
                <div className="flex flex-col gap-1">
                  <h3 style={{ color: "var(--text)", fontSize: 14 }}>{t(titleKey)}</h3>
                  <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6 }}>{t(bodyKey)}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <div className="grid gap-4 desktop:grid-cols-2">
          <InfoSection title={t("learn.gpt2.prerequisitesTitle")}>
            <p>{t("learn.gpt2.prerequisitesBody")}</p>
          </InfoSection>
          <InfoSection title={t("learn.gpt2.outputTitle")}>
            <ul>
              <li>{t("learn.gpt2.output1")}</li>
              <li>{t("learn.gpt2.output2")}</li>
              <li>{t("learn.gpt2.output3")}</li>
              <li>{t("learn.gpt2.output4")}</li>
            </ul>
          </InfoSection>
        </div>

        <footer className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3" style={{ borderColor: "var(--border)" }}>
          <span className="pi-eyebrow">{t("learn.gpt2.more")}</span>
          <a href={LECTURE_INDEX_URL} target="_blank" rel="noopener noreferrer" className="ui-action pi-chrome-label" style={{ fontSize: 11 }}>
            {t("learn.gpt2.lectureIndex")}
          </a>
          <a href="https://github.com/karpathy/nanoGPT" target="_blank" rel="noopener noreferrer" className="ui-action pi-chrome-label" style={{ fontSize: 11 }}>
            nanoGPT
          </a>
        </footer>
      </main>
    </div>
  );
}

function ResourceCard({
  eyebrow,
  title,
  body,
  href,
  action,
}: {
  eyebrow: string;
  title: string;
  body: string;
  href: string;
  action: string;
}) {
  return (
    <article className="pi-card flex flex-col gap-3 p-5">
      <span className="pi-eyebrow">{eyebrow}</span>
      <h2 style={{ color: "var(--text)", fontSize: 17 }}>{title}</h2>
      <p className="flex-1" style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6 }}>{body}</p>
      <a href={href} target="_blank" rel="noopener noreferrer" className="ui-action pi-bracket self-start" style={{ fontSize: 11 }}>
        {action} ↗
      </a>
    </article>
  );
}

function InfoSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="pi-panel flex flex-col gap-2 p-5">
      <h2 style={{ color: "var(--text)", fontSize: 15 }}>{title}</h2>
      <div style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.7 }}>
        {children}
      </div>
    </section>
  );
}
