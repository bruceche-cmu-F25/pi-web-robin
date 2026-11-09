"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { LearningShelf } from "./LearningShelf";
import { LearningPanel } from "./LearningPanel";
import { StudyPlan } from "./StudyPlan";
import tabs from "./InformationInbox.module.css";
import { WorkspaceRail } from "./WorkspaceRail";
import { FDE_ROADMAP_URL, PYTHON_STUDY_CANVAS_TITLE } from "@/extension/robin/learning-shelf";
import { BACKEND_URL } from "@/extension/robin/study-plan";
import rail from "./WorkspaceRail.module.css";

/** Today's learning stays in the main column; enduring entry points share one resource rail. */
export function LearningHub() {
  const { t, locale } = useI18n();
  const zh = locale.startsWith("zh");
  const [pythonCanvasId, setPythonCanvasId] = useState("");
  const [view, setView] = useState<"week" | "planner">("week");
  useEffect(() => {
    const sync = () => setView(new URLSearchParams(window.location.search).get("view") === "planner" ? "planner" : "week");
    sync(); window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  const chooseView = (next: "week" | "planner") => {
    if (next === view) return;
    const url = new URL(window.location.href);
    if (next === "planner") url.searchParams.set("view", "planner"); else url.searchParams.delete("view");
    window.history.pushState(null, "", url); setView(next);
  };
  useEffect(() => {
    let active = true;
    void fetch("/api/robin/canvases", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const data = await response.json() as { canvases: Array<{ id: string; title: string }> };
        if (active) setPythonCanvasId(data.canvases.find((board) => board.title === PYTHON_STUDY_CANVAS_TITLE)?.id ?? "");
      }).catch(() => {});
    return () => { active = false; };
  }, []);
  const entries = [
    { id: "roadmap", href: "/learn/roadmap", title: t("graph.title"), kind: zh ? "知识地图" : "Knowledge map" },
    { id: "fso", href: "/learn/fso", title: t("learn.entry.fso.title"), kind: zh ? "系统课程" : "Course" },
    { id: "fcc-backend", href: BACKEND_URL, title: zh ? "freeCodeCamp 后端课程" : "freeCodeCamp Back End Development", kind: zh ? "后端课程" : "Backend course" },
    ...(pythonCanvasId ? [{ id: "python-notes", href: `/notes?view=canvas&canvas=${pythonCanvasId}`, title: t("learn.entry.pythonNotes.title"), kind: zh ? "动手笔记" : "Interactive notes" }] : []),
    { id: "gpt2-walkthrough", href: "/learn/gpt2", title: t("learn.entry.gpt2.title"), kind: zh ? "项目实战" : "Build project" },
    { id: "watch", href: "/learn/watch", title: t("learn.entry.watch.title"), kind: zh ? "视频学习" : "Watch & learn" },
  ];
  return <div className="robin-page robin-dashboard robin-workspace-ground flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
    <main className="flex w-full flex-col gap-4 p-4 desktop:p-6">
      <header className={rail.hubHeader}>
        <div>
          <h1 className="pi-page-title">{t("learn.title")}</h1>
          <p className="pi-eyebrow mt-2">{t("learn.subtitle")}</p>
        </div>
        <nav className={`robin-workspace-tabs ${tabs.sources} ${tabs.inlineSources}`} aria-label={zh ? "学习视图" : "Learning views"}>
          <button type="button" aria-pressed={view === "week"} onClick={() => chooseView("week")}>{zh ? "本周" : "This week"}</button>
          <button type="button" aria-pressed={view === "planner"} onClick={() => chooseView("planner")}>{zh ? "规划本周" : "Plan my week"}</button>
        </nav>
      </header>
      <div className={rail.layout} style={view === "planner" ? { gridTemplateColumns: "minmax(0, 1fr)" } : undefined}>
        <WorkspaceRail title={zh ? "学习资源" : "Learning resources"} hidden={view === "planner"} expandedOnMobile>
          <nav aria-label={zh ? "学习资源" : "Learning resources"}>
            <ul className={rail.entries}>
              {entries.map((entry) => <li key={entry.id}><a href={entry.href} target={entry.href.startsWith("https://") ? "_blank" : undefined} rel={entry.href.startsWith("https://") ? "noopener noreferrer" : undefined} className={rail.pathEntry}>
                <span className={rail.pathText}><small>{entry.kind}</small><strong>{entry.title}</strong></span>
                <span className={rail.pathArrow} aria-hidden="true">↗</span>
              </a></li>)}
            </ul>
          </nav>
          <section className={rail.featuredPath} aria-labelledby="fde-roadmap-title">
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
          {view === "week" && <LearningPanel showCourseOutline />}
          <StudyPlan view={view} />
          {view === "week" && <details className={rail.shelfDisclosure} open>
            <summary>{zh ? "探索与资料" : "Explore & resources"}</summary>
            <LearningShelf />
          </details>}
        </div>
      </div>
    </main>
  </div>;
}
