"use client";

import { useI18n } from "@/hooks/useI18n";
import { LearningShelf } from "./LearningShelf";
import { LearningPanel } from "./LearningPanel";
import { WorkspaceRail } from "./WorkspaceRail";
import { FDE_ROADMAP_URL } from "@/extension/robin/learning-shelf";
import rail from "./WorkspaceRail.module.css";

/** Today's learning stays in the main column; enduring entry points share one resource rail. */
export function LearningHub() {
  const { t } = useI18n();
  const entries = [
    { id: "roadmap", href: "/learn/roadmap", title: t("graph.title") },
    { id: "fso", href: "/learn/fso", title: t("learn.entry.fso.title") },
    { id: "gpt2-walkthrough", href: "/learn/gpt2", title: t("learn.entry.gpt2.title") },
    { id: "watch", href: "/learn/watch", title: t("learn.entry.watch.title") },
  ];
  return <div className="robin-page robin-dashboard robin-workspace-ground flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
    <main className="flex w-full flex-col gap-6 p-4 desktop:p-6">
      <header>
        <h1 className="pi-page-title">{t("learn.title")}</h1>
        <p className="pi-eyebrow mt-2">{t("learn.subtitle")}</p>
      </header>
      <div className={rail.layout}>
        <WorkspaceRail title={t("learn.more")}>
          <nav aria-label={t("learn.more")}>
            <ul className={rail.entries}>
              {entries.map(entry => <li key={entry.id}><a href={entry.href} className={rail.entry}>
                <span><strong>{entry.title}</strong></span><span aria-hidden="true">→</span>
              </a></li>)}
            </ul>
          </nav>
          <section aria-labelledby="fde-roadmap-title">
            <h2 id="fde-roadmap-title" className={rail.sectionTitle}>{t("learn.fde.eyebrow")}</h2>
            <a href={FDE_ROADMAP_URL} target="_blank" rel="noopener noreferrer" className={rail.entry}>
              <span><strong>{t("learn.fde.title")}</strong><small>{t("learn.fde.open")}</small></span><span aria-hidden="true">↗</span>
            </a>
            <details className={rail.details}>
              <summary>{t("learn.fde.intro")}</summary>
              <ol className={rail.checkpoints}>
                {[1, 2, 3, 4].map((week) => <li key={week}>
                  <strong>{t(`learn.fde.week${week}.label`)} · {t(`learn.fde.week${week}.title`)}</strong>
                  <span>{t(`learn.fde.week${week}.detail`)}</span>
                </li>)}
              </ol>
              <p>{t("learn.fde.value")}</p>
              <p>{t("learn.fde.limit")}</p>
            </details>
          </section>
        </WorkspaceRail>
        <div className={`${rail.content} flex flex-col gap-6`}>
          <LearningPanel showCourseOutline />
          <LearningShelf />
        </div>
      </div>
    </main>
  </div>;
}
