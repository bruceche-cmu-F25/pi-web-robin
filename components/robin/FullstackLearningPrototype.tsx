"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
  CURRICULUM,
  type CurriculumItem,
  type CurriculumModule,
} from "@/extension/robin/study";
import { localizeCurriculumModule } from "@/extension/robin/curriculum-locales";
import { AgentPanel } from "./AgentPanel";
import { PaneDivider } from "./PaneDivider";
import { usePaneWidths } from "./usePaneWidths";

const MENTOR_TOOL_KEYS: Record<string, string> = {
  study_current: "coding.tool.studyCurrent",
  study_outline: "coding.tool.studyOutline",
};

const FULLSTACK = CURRICULUM.find((track) => track.id === "fullstack");

type LinkedItem = CurriculumItem & { url: string };
type MobilePane = "directory" | "content" | "mentor";
type NodeKind = "request" | "crosscut" | "operation";

const SYSTEM_LANES = {
  request: ["web-fundamentals", "frontend-libraries", "backend-apis", "relational-data"],
  crosscut: ["state-engineering", "typescript", "testing-auth"],
  operation: ["production", "security-scale"],
} as const;

function linkedItems(courseModule: CurriculumModule): LinkedItem[] {
  return courseModule.items.filter((item): item is LinkedItem => Boolean(item.url));
}

function resourcePlan(courseModule: CurriculumModule) {
  const linked = linkedItems(courseModule);
  const primary = linked.find((item) => item.id === courseModule.guide.minimumItemId) ?? linked[0];
  const rest = linked.filter((item) => item.id !== primary?.id);
  return { primary, supporting: rest.slice(0, 2), more: rest.slice(2) };
}

/**
 * A throwaway Full Stack track prototype: book navigation around a system map.
 * It deliberately reuses the real curriculum and mentor instead of inventing a
 * second data model that would be thrown away with the experiment.
 */
export function FullstackLearningPrototype() {
  const { locale, t } = useI18n();
  const isMobile = useIsMobile();
  const panes = usePaneWidths(true);
  const scrollerRef = useRef<HTMLElement>(null);
  const [directoryOpen, setDirectoryOpen] = useState(true);
  const [mentorOpen, setMentorOpen] = useState(false);
  const [mobilePane, setMobilePane] = useState<MobilePane>("content");
  const [activeModuleId, setActiveModuleId] = useState<string | null>(null);
  const [previewModuleId, setPreviewModuleId] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const modules = useMemo(
    () => FULLSTACK?.modules.map((courseModule) => localizeCurriculumModule(courseModule, locale)) ?? [],
    [locale],
  );
  const activeModule = modules.find((courseModule) => courseModule.id === activeModuleId) ?? null;
  const selectedItem = activeModule?.items.find((item) => item.id === selectedItemId) ?? null;
  const labels = locale === "en" ? EN : ZH;

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: 0 });
  }, [activeModuleId]);

  if (!FULLSTACK) return null;

  const saveContext = async (itemId: string) => {
    try {
      setActionError(null);
      const response = await fetch("/api/robin/study", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item: itemId, track: "fullstack" }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? `Request failed (${response.status})`);
      }
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const enterModule = (courseModule: CurriculumModule) => {
    const primary = resourcePlan(courseModule).primary;
    setActiveModuleId(courseModule.id);
    setPreviewModuleId(courseModule.id);
    setSelectedItemId(primary?.id ?? null);
    if (primary) void saveContext(primary.id);
    if (isMobile) setMobilePane("content");
  };

  const showMap = () => {
    setActiveModuleId(null);
    if (isMobile) setMobilePane("content");
  };

  const directoryVisible = isMobile ? mobilePane === "directory" : directoryOpen;
  const contentVisible = isMobile ? mobilePane === "content" : true;
  const mentorVisible = isMobile ? mobilePane === "mentor" : mentorOpen;

  return (
    <div className="robin-page flex flex-1 flex-col" style={{ minWidth: 0, minHeight: 0 }}>
      <header
        className="flex flex-wrap items-center gap-2 border-b px-3 py-2"
        style={{ borderColor: "var(--border)", background: "var(--bg-panel)" }}
      >
        <div className="min-w-0">
          <h1 className="pi-label" style={{ fontSize: 11 }}>{labels.title}</h1>
          <p className="pi-eyebrow mt-1 hidden desktop:block" style={{ fontSize: 9, color: "var(--text-dim)" }}>
            {t("coding.trackOutcome.fullstack")}
          </p>
        </div>

        {isMobile && mobilePane !== "content" ? (
          <button
            type="button"
            className="ui-action pi-chrome-label pi-bracket ml-auto"
            data-state="accent"
            style={{ fontSize: 10 }}
            onClick={() => setMobilePane("content")}
          >
            {activeModule ? activeModule.title : t("coding.study.overviewTitle")}
          </button>
        ) : null}
        <button
          type="button"
          className="ui-action pi-chrome-label pi-bracket desktop:ml-auto"
          data-state={directoryVisible ? "accent" : undefined}
          style={{ fontSize: 10 }}
          aria-expanded={directoryVisible}
          onClick={() => isMobile
            ? setMobilePane("directory")
            : setDirectoryOpen((open) => !open)}
        >
          {labels.contents}
        </button>
        <button
          type="button"
          className="ui-action pi-chrome-label pi-bracket"
          data-state={mentorVisible ? "accent" : undefined}
          style={{ fontSize: 10 }}
          aria-expanded={mentorVisible}
          onClick={() => isMobile
            ? setMobilePane("mentor")
            : setMentorOpen((open) => !open)}
        >
          {t(mentorVisible ? "coding.mentor.hide" : "coding.mentor.show")}
        </button>
        {actionError ? <span style={{ fontSize: 11, color: "var(--danger)" }}>{actionError}</span> : null}
      </header>

      <div className="flex flex-1" style={{ minHeight: 0 }}>
        <aside
          aria-label={labels.contents}
          className="flex flex-col"
          style={directoryVisible
            ? {
              width: isMobile ? "100%" : panes.rail.width,
              minWidth: isMobile ? 0 : panes.rail.width,
              background: "var(--nav-panel-background)",
            }
            : { display: "none" }}
        >
          <header className="border-b px-3 py-3" style={{ borderColor: "var(--border)" }}>
            <p className="pi-eyebrow" style={{ fontSize: 9 }}>{labels.book}</p>
            <h2 className="mt-1" style={{ fontSize: 18, color: "var(--text)" }}>{FULLSTACK.title}</h2>
          </header>
          <nav className="flex-1 overflow-y-auto py-1" style={{ minHeight: 0 }}>
            <button
              type="button"
              onClick={showMap}
              className="ui-action flex min-h-11 w-full items-center gap-3 border-b px-3 py-3 text-left"
              style={{
                borderColor: "var(--border)",
                borderLeft: activeModuleId === null ? "3px solid var(--accent)" : "3px solid transparent",
                color: activeModuleId === null ? "var(--accent)" : "var(--text)",
              }}
              aria-current={activeModuleId === null ? "page" : undefined}
            >
              <span className="pi-eyebrow" style={{ width: "2ch", fontSize: 9 }}>00</span>
              <span style={{ fontSize: 12.5 }}>{t("coding.study.overviewTitle")}</span>
            </button>
            <ol>
              {modules.map((courseModule, index) => {
                const active = activeModuleId === courseModule.id;
                return (
                  <li key={courseModule.id}>
                    <button
                      type="button"
                      onClick={() => enterModule(courseModule)}
                      className="ui-action flex min-h-11 w-full items-start gap-3 px-3 py-2.5 text-left"
                      style={{
                        borderLeft: active ? "3px solid var(--accent)" : "3px solid transparent",
                        color: active ? "var(--accent)" : "var(--text)",
                      }}
                      aria-current={active ? "page" : undefined}
                    >
                      <span
                        className="pi-eyebrow shrink-0"
                        style={{ width: "2ch", paddingTop: 2, fontSize: 9, color: active ? "var(--accent)" : "var(--text-dim)" }}
                      >
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span style={{ fontSize: 12.5, lineHeight: 1.4 }}>{courseModule.title}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>
        </aside>

        {!isMobile && directoryOpen ? (
          <PaneDivider edge="left" label={t("coding.pane.rail")} title={t("coding.pane.resetHint")} {...panes.rail} />
        ) : null}

        <main
          ref={scrollerRef}
          className="min-w-0 flex-1 overflow-y-auto"
          style={{ display: contentVisible ? "block" : "none", background: "var(--dashboard-ground)" }}
        >
          {activeModule ? (
            <ChapterReader
              courseModule={activeModule}
              chapterIndex={modules.findIndex((candidate) => candidate.id === activeModule.id)}
              total={modules.length}
              selectedItemId={selectedItemId}
              labels={labels}
              t={t}
              onMap={showMap}
              onOpen={(item) => {
                setSelectedItemId(item.id);
                void saveContext(item.id);
              }}
              onPrevious={(index) => index >= 0 && enterModule(modules[index])}
              onNext={(index) => index < modules.length && enterModule(modules[index])}
            />
          ) : (
            <Roadmap
              modules={modules}
              previewModuleId={previewModuleId}
              labels={labels}
              t={t}
              onPreview={setPreviewModuleId}
              onEnter={enterModule}
            />
          )}
        </main>

        {!isMobile && mentorOpen ? (
          <PaneDivider edge="right" label={t("coding.pane.panel")} title={t("coding.pane.resetHint")} {...panes.panel} />
        ) : null}

        <aside
          className="flex flex-col"
          aria-label={t("coding.mentor.title")}
          style={mentorVisible
            ? { width: isMobile ? "100%" : panes.panel.width, minWidth: isMobile ? 0 : panes.panel.width, minHeight: 0 }
            : { display: "none" }}
        >
          <div className="border-b px-3 py-2" style={{ borderColor: "var(--border)", background: "var(--accent-faint)" }}>
            <p className="pi-eyebrow" style={{ fontSize: 9, color: "var(--accent)" }}>{labels.context}</p>
            <p className="mt-1 truncate" style={{ fontSize: 12, color: "var(--text)" }}>
              {activeModule ? activeModule.title : t("coding.study.overviewTitle")}
            </p>
            {selectedItem ? (
              <p className="mt-0.5 truncate" style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {labels.resource}: {selectedItem.title}
              </p>
            ) : null}
          </div>
          <AgentPanel
            mode="mentor"
            titleKey="coding.mentor.title"
            placeholderKey="coding.mentor.placeholder"
            restartHintKey="coding.mentor.restartHint"
            toolKeys={MENTOR_TOOL_KEYS}
          />
        </aside>
      </div>
    </div>
  );
}

function Roadmap({
  modules,
  previewModuleId,
  labels,
  t,
  onPreview,
  onEnter,
}: {
  modules: CurriculumModule[];
  previewModuleId: string | null;
  labels: typeof EN;
  t: (key: string) => string;
  onPreview: (moduleId: string) => void;
  onEnter: (courseModule: CurriculumModule) => void;
}) {
  const byId = new Map(modules.map((courseModule) => [courseModule.id, courseModule]));
  const preview = byId.get(previewModuleId ?? "") ?? null;
  const stageNumber = (moduleId: string) => modules.findIndex((courseModule) => courseModule.id === moduleId) + 1;

  return (
    <div className="mx-auto flex w-full flex-col gap-5 p-4 desktop:p-6" style={{ maxWidth: 1320 }}>
      <header className="grid gap-3 desktop:grid-cols-[minmax(0,1fr)_minmax(18rem,0.55fr)]">
        <div>
          <p className="pi-eyebrow" style={{ fontSize: 9, color: "var(--accent)" }}>{labels.systemMap}</p>
          <h2
            className="mt-2"
            style={{ fontSize: "clamp(2rem, 5vw, 4.5rem)", color: "var(--text)", lineHeight: 1, letterSpacing: "-0.045em" }}
          >
            {t("coding.study.overviewTitle")}
          </h2>
        </div>
        <p className="pi-prose self-end" style={{ fontSize: 15, color: "var(--text-muted)", lineHeight: 1.7 }}>
          {t("coding.trackOutcome.fullstack")}
        </p>
      </header>

      <section className="pi-panel p-3 desktop:p-4" aria-labelledby="learning-spine-title">
        <h3 id="learning-spine-title" className="pi-label" style={{ fontSize: 10 }}>{labels.learningSpine}</h3>
        <ol className="mt-3 flex items-center gap-2 overflow-x-auto pb-2">
          {modules.map((courseModule, index) => (
            <li key={courseModule.id} className="flex shrink-0 items-center gap-2">
              {index > 0 ? <span aria-hidden style={{ color: "var(--text-dim)" }}>→</span> : null}
              <button
                type="button"
                className="ui-action flex min-h-11 items-center gap-2 border px-3 py-2 text-left"
                style={{
                  width: 148,
                  borderColor: previewModuleId === courseModule.id ? "var(--accent)" : "var(--border)",
                  background: previewModuleId === courseModule.id ? "var(--accent-faint)" : "var(--bg-panel)",
                  color: previewModuleId === courseModule.id ? "var(--accent)" : "var(--text)",
                }}
                onClick={() => onPreview(courseModule.id)}
              >
                <span className="pi-eyebrow" style={{ fontSize: 9 }}>{String(index + 1).padStart(2, "0")}</span>
                <span className="line-clamp-2" style={{ fontSize: 11.5, lineHeight: 1.35 }}>{courseModule.title}</span>
              </button>
            </li>
          ))}
        </ol>
      </section>

      <section className="pi-panel overflow-hidden" aria-label={labels.systemMap}>
        <MapLane label={labels.requestFlow} description={labels.requestHint}>
          <div className="overflow-x-auto pb-1">
            <div className="grid items-stretch gap-2" style={{ minWidth: 720, gridTemplateColumns: "1fr auto 1fr auto 1fr auto 1fr" }}>
              {SYSTEM_LANES.request.map((moduleId, index) => {
                const courseModule = byId.get(moduleId);
                if (!courseModule) return null;
                return (
                  <div key={moduleId} className="contents">
                    {index > 0 ? <span className="self-center" aria-hidden style={{ color: "var(--accent)", fontSize: 20 }}>→</span> : null}
                    <SystemNode
                      kind="request"
                      number={stageNumber(moduleId)}
                      courseModule={courseModule}
                      active={previewModuleId === moduleId}
                      onClick={() => onPreview(moduleId)}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </MapLane>

        <MapLane label={labels.crossCutting} description={labels.crossHint}>
          <div className="grid gap-2 desktop:grid-cols-3">
            {SYSTEM_LANES.crosscut.map((moduleId) => {
              const courseModule = byId.get(moduleId);
              return courseModule ? (
                <SystemNode
                  key={moduleId}
                  kind="crosscut"
                  number={stageNumber(moduleId)}
                  courseModule={courseModule}
                  active={previewModuleId === moduleId}
                  onClick={() => onPreview(moduleId)}
                />
              ) : null;
            })}
          </div>
        </MapLane>

        <MapLane label={labels.operations} description={labels.operationHint} last>
          <div className="grid gap-2 desktop:grid-cols-2">
            {SYSTEM_LANES.operation.map((moduleId) => {
              const courseModule = byId.get(moduleId);
              return courseModule ? (
                <SystemNode
                  key={moduleId}
                  kind="operation"
                  number={stageNumber(moduleId)}
                  courseModule={courseModule}
                  active={previewModuleId === moduleId}
                  onClick={() => onPreview(moduleId)}
                />
              ) : null;
            })}
          </div>
        </MapLane>
      </section>

      {preview ? (
        <section className="pi-panel grid gap-5 p-5 desktop:grid-cols-[minmax(0,1fr)_auto] desktop:p-6" aria-live="polite">
          <div>
            <p className="pi-eyebrow" style={{ fontSize: 9, color: "var(--accent)" }}>
              {labels.chapter} {String(stageNumber(preview.id)).padStart(2, "0")}
            </p>
            <h3 className="mt-2" style={{ fontSize: 25, color: "var(--text)", lineHeight: 1.2 }}>{preview.title}</h3>
            <p className="pi-prose mt-3" style={{ maxWidth: "74ch", fontSize: 15, color: "var(--text-muted)", lineHeight: 1.7 }}>
              {preview.guide.plainLanguage}
            </p>
          </div>
          <button
            type="button"
            className="ui-action pi-chrome-label pi-bracket self-end"
            data-state="accent"
            style={{ minHeight: 44, fontSize: 11 }}
            onClick={() => onEnter(preview)}
          >
            {t("coding.study.openUnit")}
          </button>
        </section>
      ) : (
        <p className="pi-eyebrow text-center" style={{ fontSize: 10, color: "var(--text-dim)" }}>{labels.selectNode}</p>
      )}
    </div>
  );
}

function MapLane({
  label,
  description,
  last = false,
  children,
}: {
  label: string;
  description: string;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`grid gap-4 p-4 desktop:grid-cols-[10rem_minmax(0,1fr)] desktop:p-5${last ? "" : " border-b"}`} style={{ borderColor: "var(--border)" }}>
      <div>
        <h3 className="pi-label" style={{ fontSize: 10 }}>{label}</h3>
        <p className="mt-2" style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>{description}</p>
      </div>
      {children}
    </div>
  );
}

function SystemNode({
  kind,
  number,
  courseModule,
  active,
  onClick,
}: {
  kind: NodeKind;
  number: number;
  courseModule: CurriculumModule;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="ui-action flex min-h-24 w-full flex-col justify-between gap-3 p-3 text-left"
      style={{
        borderStyle: kind === "crosscut" ? "dashed" : "solid",
        borderWidth: kind === "request" ? 2 : kind === "operation" ? "1px 1px 1px 4px" : 1,
        borderColor: active ? "var(--accent)" : kind === "operation" ? "var(--border) var(--border) var(--border) var(--accent-line)" : "var(--accent-line)",
        background: active ? "var(--accent-faint)" : kind === "request" ? "var(--bg-panel)" : "var(--bg-hover)",
        color: active ? "var(--accent)" : "var(--text)",
      }}
      aria-pressed={active}
      onClick={onClick}
    >
      <span className="pi-eyebrow" style={{ fontSize: 9 }}>{String(number).padStart(2, "0")}</span>
      <strong style={{ fontSize: 13.5, fontWeight: 500, lineHeight: 1.4 }}>{courseModule.title}</strong>
    </button>
  );
}

function ChapterReader({
  courseModule,
  chapterIndex,
  total,
  selectedItemId,
  labels,
  t,
  onMap,
  onOpen,
  onPrevious,
  onNext,
}: {
  courseModule: CurriculumModule;
  chapterIndex: number;
  total: number;
  selectedItemId: string | null;
  labels: typeof EN;
  t: (key: string) => string;
  onMap: () => void;
  onOpen: (item: LinkedItem) => void;
  onPrevious: (index: number) => void;
  onNext: (index: number) => void;
}) {
  const plan = resourcePlan(courseModule);

  return (
    <article className="mx-auto w-full p-4 desktop:p-6" style={{ maxWidth: 1120 }}>
      <button type="button" className="ui-action pi-chrome-label pi-bracket" style={{ fontSize: 10 }} onClick={onMap}>
        ← {t("coding.study.overviewTitle")}
      </button>

      <header className="mt-5 border-b pb-6" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-3">
          <span
            className="pi-eyebrow flex h-12 w-12 shrink-0 items-center justify-center"
            style={{ border: "1px solid var(--accent)", color: "var(--accent)", fontSize: 10 }}
          >
            {String(chapterIndex + 1).padStart(2, "0")}/{String(total).padStart(2, "0")}
          </span>
          <p className="pi-eyebrow" style={{ fontSize: 9, color: "var(--accent)" }}>{labels.chapter}</p>
        </div>
        <h2
          className="mt-4"
          style={{ maxWidth: "24ch", fontSize: "clamp(2rem, 5vw, 4rem)", color: "var(--text)", lineHeight: 1.05, letterSpacing: "-0.04em" }}
        >
          {courseModule.title}
        </h2>
        <p className="pi-prose mt-5" style={{ maxWidth: "76ch", fontSize: 18, color: "var(--text)", lineHeight: 1.7 }}>
          {courseModule.outcome}
        </p>
      </header>

      <section className="mt-5 grid gap-px border" style={{ borderColor: "var(--border)", background: "var(--border)" }}>
        <ChapterFact label={t("coding.study.plainLanguage")} value={courseModule.guide.plainLanguage} />
        <div className="grid gap-px desktop:grid-cols-2" style={{ background: "var(--border)" }}>
          <ChapterFact label={t("coding.study.prerequisites")} value={courseModule.guide.prerequisites} />
          <ChapterFact label={t("coding.study.applicationRole")} value={courseModule.guide.applicationRole} />
        </div>
      </section>

      <section className="mt-8" aria-labelledby={`resources-${courseModule.id}`}>
        <p className="pi-eyebrow" style={{ fontSize: 9, color: "var(--accent)" }}>02</p>
        <h3 id={`resources-${courseModule.id}`} className="pi-label mt-2" style={{ fontSize: 11 }}>{labels.recommendedPath}</h3>
        <p className="pi-prose mt-3" style={{ maxWidth: "72ch", fontSize: 14, color: "var(--text-muted)", lineHeight: 1.65 }}>
          {labels.resourceRule}
        </p>

        {plan.primary ? (
          <a
            href={plan.primary.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onOpen(plan.primary)}
            className="ui-action mt-4 grid min-h-32 gap-4 border p-5 desktop:grid-cols-[minmax(0,1fr)_auto]"
            style={{
              borderColor: selectedItemId === plan.primary.id ? "var(--accent)" : "var(--accent-line)",
              borderLeft: "4px solid var(--accent)",
              background: "var(--accent-faint)",
              color: "var(--text)",
              textDecoration: "none",
            }}
            aria-current={selectedItemId === plan.primary.id ? "true" : undefined}
          >
            <span>
              <span className="pi-eyebrow" style={{ fontSize: 9, color: "var(--accent)" }}>{labels.primaryResource}</span>
              <strong className="mt-2 block" style={{ fontSize: 18, fontWeight: 500, lineHeight: 1.4 }}>{plan.primary.title}</strong>
              <span className="pi-prose mt-2 block" style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.6 }}>
                {plan.primary.hint}
              </span>
            </span>
            <span className="pi-chrome-label pi-bracket self-end" style={{ fontSize: 10, color: "var(--accent)" }}>
              {labels.start} ↗
            </span>
          </a>
        ) : null}

        {plan.supporting.length > 0 ? (
          <div className="mt-3 grid gap-3 desktop:grid-cols-2">
            {plan.supporting.map((item) => (
              <ResourceLink
                key={item.id}
                item={item}
                active={selectedItemId === item.id}
                label={`${labels.supplement} · ${t(`coding.kind.${item.kind}`)}`}
                onOpen={() => onOpen(item)}
              />
            ))}
          </div>
        ) : null}

        {plan.more.length > 0 ? (
          <details className="pi-panel mt-3 p-3">
            <summary className="ui-action min-h-11 cursor-pointer py-2" style={{ color: "var(--text-muted)", fontSize: 12 }}>
              {labels.moreResources} ({plan.more.length})
            </summary>
            <div className="mt-2 grid gap-2">
              {plan.more.map((item) => (
                <ResourceLink
                  key={item.id}
                  item={item}
                  active={selectedItemId === item.id}
                  label={t(`coding.kind.${item.kind}`)}
                  onOpen={() => onOpen(item)}
                />
              ))}
            </div>
          </details>
        ) : null}
      </section>

      <section className="mt-8 grid gap-3 desktop:grid-cols-2">
        <LearningOutcome number="03" label={labels.practiceFocus} value={courseModule.guide.smallExercise} color="var(--accent)" />
        <LearningOutcome number="04" label={t("coding.study.exitCriteria")} value={courseModule.guide.exitCriteria} color="var(--success)" />
      </section>

      <nav className="mt-8 flex items-center justify-between gap-4 border-t pt-5" style={{ borderColor: "var(--border)" }} aria-label={labels.chapterNavigation}>
        <button
          type="button"
          className="ui-action pi-chrome-label pi-bracket"
          style={{ minHeight: 44, fontSize: 10, visibility: chapterIndex > 0 ? "visible" : "hidden" }}
          onClick={() => onPrevious(chapterIndex - 1)}
        >
          ← {labels.previous}
        </button>
        <button
          type="button"
          className="ui-action pi-chrome-label pi-bracket"
          data-state="accent"
          style={{ minHeight: 44, fontSize: 10, visibility: chapterIndex + 1 < total ? "visible" : "hidden" }}
          onClick={() => onNext(chapterIndex + 1)}
        >
          {labels.next} →
        </button>
      </nav>
    </article>
  );
}

function ChapterFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-4 desktop:p-5" style={{ background: "var(--bg-panel)" }}>
      <h3 className="pi-eyebrow" style={{ fontSize: 9 }}>{label}</h3>
      <p className="pi-prose mt-2" style={{ fontSize: 14.5, color: "var(--text-muted)", lineHeight: 1.7 }}>{value}</p>
    </div>
  );
}

function ResourceLink({
  item,
  active,
  label,
  onOpen,
}: {
  item: LinkedItem;
  active: boolean;
  label: string;
  onOpen: () => void;
}) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onOpen}
      className="ui-action flex min-h-28 flex-col gap-2 border p-4"
      style={{
        borderColor: active ? "var(--accent)" : "var(--border)",
        background: "var(--bg-panel)",
        color: active ? "var(--accent)" : "var(--text)",
        textDecoration: "none",
      }}
      aria-current={active ? "true" : undefined}
    >
      <span className="pi-eyebrow" style={{ fontSize: 9, color: active ? "var(--accent)" : "var(--text-dim)" }}>{label}</span>
      <strong style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.4 }}>{item.title}</strong>
      <span className="pi-prose" style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.55 }}>{item.hint}</span>
      <span className="pi-eyebrow mt-auto pt-2" style={{ fontSize: 9 }}>↗</span>
    </a>
  );
}

function LearningOutcome({ number, label, value, color }: { number: string; label: string; value: string; color: string }) {
  return (
    <section className="p-5" style={{ borderStyle: "solid", borderWidth: "4px 1px 1px", borderColor: `${color} var(--border) var(--border)`, background: "var(--bg-panel)" }}>
      <p className="pi-eyebrow" style={{ fontSize: 9, color }}>{number}</p>
      <h3 className="pi-label mt-2" style={{ fontSize: 10 }}>{label}</h3>
      <p className="pi-prose mt-3" style={{ fontSize: 15, color: "var(--text)", lineHeight: 1.7 }}>{value}</p>
    </section>
  );
}

const EN = {
  title: "Full stack · prototype",
  contents: "Contents",
  book: "The web, end to end",
  context: "Current context",
  resource: "Resource",
  systemMap: "One request · one system",
  learningSpine: "Recommended learning order",
  requestFlow: "Request flow",
  requestHint: "Follow data from the browser to durable storage.",
  crossCutting: "Cross-cutting",
  crossHint: "Capabilities that protect or connect several layers.",
  operations: "Operate the whole",
  operationHint: "Ship, observe, secure, and review the complete system.",
  chapter: "Chapter",
  selectNode: "Choose a node to see what it teaches.",
  recommendedPath: "Recommended path",
  resourceRule: "Start with one primary resource. Use the supplements only for another explanation or more repetition.",
  primaryResource: "Primary resource",
  supplement: "Optional support",
  moreResources: "More alternatives",
  start: "Start learning",
  practiceFocus: "What to practise",
  chapterNavigation: "Chapter navigation",
  previous: "Previous chapter",
  next: "Next chapter",
};

const ZH: typeof EN = {
  title: "全栈学习 · 原型",
  contents: "章节目录",
  book: "从浏览器到生产环境",
  context: "当前上下文",
  resource: "当前资源",
  systemMap: "一次请求 · 一套系统",
  learningSpine: "推荐学习顺序",
  requestFlow: "请求主链路",
  requestHint: "跟随数据从浏览器一路进入持久化存储。",
  crossCutting: "跨层能力",
  crossHint: "保护或连接多个系统层的能力。",
  operations: "运行完整系统",
  operationHint: "发布、观察、保护并审查整套应用。",
  chapter: "章节",
  selectNode: "选择一个节点，先了解它要解决什么问题。",
  recommendedPath: "推荐学习路径",
  resourceRule: "先学习一个主资源；只有需要另一种解释或更多重复练习时，再打开补充资源。",
  primaryResource: "主资源 · 从这里开始",
  supplement: "可选补充",
  moreResources: "更多备选资源",
  start: "开始学习",
  practiceFocus: "需要重点练习什么",
  chapterNavigation: "章节导航",
  previous: "上一章",
  next: "下一章",
};
