"use client";

import { Fragment } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  FSO_PARTS, exerciseRange, isOptionalExercise,
  type FsoChapter, type FsoPart,
} from "@/extension/robin/fso";
import styles from "./FsoWorkspace.module.css";

interface Props {
  isDone: (stepId: string) => boolean;
  current: FsoChapter | null;
  notedIds: ReadonlySet<string>;
  completed: number;
  total: number;
  onOpen: (chapter: FsoChapter) => void;
}

function partProgress(part: FsoPart, isDone: (id: string) => boolean) {
  const done = part.stepIds.filter(isDone).length;
  return { done, total: part.stepIds.length };
}

/** A project's name once, however many steps it spans: "unicafe · anecdotes". */
function projectNames(chapter: FsoChapter): string {
  const names = [...new Set(chapter.projects.map((project) => project.name))];
  return names.length > 3 ? `${names.slice(0, 2).join(" · ")} +${names.length - 2}` : names.join(" · ");
}

/**
 * The course as roadmap.sh draws a path: parts on one spine, each chapter
 * hanging off its left, and the exercises that chapter asks for off its right
 * — read on one side, build on the other. Fixed order and fixed places, so
 * the map is the same every time it is opened.
 */
export function FsoRoadmap({ isDone, current, notedIds, completed, total, onOpen }: Props) {
  const { t } = useI18n();

  return (
    <div className={styles.roadmapScroll}>
      <div className={styles.roadmap}>
        <section className={styles.intro}>
          <div>
            <p className="pi-eyebrow">{t("fso.eyebrow")}</p>
            <h1>Full Stack Open</h1>
            <p>{t("fso.intro")}</p>
          </div>
          <div className={styles.summary}>
            <div className={styles.total}>
              <strong>{completed}</strong>
              <span>/ {total} {t("fso.steps")}</span>
            </div>
            <div className={styles.totalMeter} role="progressbar" aria-label={t("fso.progressLabel")}
              aria-valuemin={0} aria-valuemax={total} aria-valuenow={completed}>
              <span style={{ width: `${total ? (completed / total) * 100 : 0}%` }} />
            </div>
            {current && (
              <button type="button" className={styles.continue} onClick={() => onOpen(current)}>
                <span className="pi-eyebrow">{t("fso.continue")} · {t("fso.part", { part: current.part })}{current.letter}</span>
                <span>{current.title} →</span>
              </button>
            )}
          </div>
        </section>

        <ul className={styles.legend}>
          <li><i data-kind="part" />{t("fso.legend.part")}</li>
          <li><i />{t("fso.legend.chapter")}</li>
          <li><i data-kind="exercise" />{t("fso.legend.exercises")}</li>
          <li><i data-kind="external" />{t("fso.legend.external")}</li>
        </ul>

        <div className={styles.spine}>
          {FSO_PARTS.map((part) => {
            const progress = partProgress(part, isDone);
            const partDone = progress.done === progress.total;
            const firstOpen = part.chapters.find((chapter) =>
              [chapter.id, ...chapter.exercises.map((step) => step.id)].some((id) => !isDone(id))) ?? part.chapters[0];
            return (
              <Fragment key={part.part}>
                <div className={styles.partRow} id={`fso-part-${part.part}`}>
                  <button type="button" className={styles.partNode} data-done={partDone}
                    onClick={() => onOpen(firstOpen)}
                    aria-label={`${t("fso.part", { part: part.part })}: ${part.title} — ${progress.done}/${progress.total}`}>
                    <span className={styles.partNumber}>{t("fso.part", { part: part.part })}</span>
                    <span className={styles.partTitle}>{part.title}</span>
                    <span className={styles.partMeta}>
                      <span className={styles.partMeter}><span style={{ width: `${(progress.done / progress.total) * 100}%` }} /></span>
                      {progress.done}/{progress.total}
                    </span>
                  </button>
                </div>
                {part.chapters.map((chapter) => (
                  <ChapterRow key={chapter.id} chapter={chapter} isDone={isDone}
                    current={chapter.id === current?.id} noted={notedIds.has(chapter.id)} onOpen={onOpen} />
                ))}
              </Fragment>
            );
          })}
          <div className={styles.finish}><span>{t("fso.finish")}</span></div>
        </div>
      </div>
    </div>
  );
}

function ChapterRow({ chapter, isDone, current, noted, onOpen }: {
  chapter: FsoChapter;
  isDone: (stepId: string) => boolean;
  current: boolean;
  noted: boolean;
  onOpen: (chapter: FsoChapter) => void;
}) {
  const { t } = useI18n();
  const read = isDone(chapter.id);
  const exercisesDone = chapter.exercises.filter((step) => isDone(step.id)).length;
  const allDone = read && exercisesDone === chapter.exercises.length;

  return (
    <>
      <div className={styles.chapterCell}>
        <button type="button" className={styles.chapterNode} onClick={() => onOpen(chapter)}
          data-done={read} data-current={current} data-external={chapter.external}>
          {current && <span className={styles.hereTag}>{t("fso.here")}</span>}
          <span className={styles.nodeHead}>
            <span className={styles.nodeLetter}>{chapter.part}{chapter.letter}</span>
            <span className={styles.nodeTitle}>{chapter.title}{chapter.external ? " ↗" : ""}</span>
            {noted && <span className={styles.nodeNote} title={t("fso.hasNote")}>✎</span>}
            {read && <span className={styles.nodeCheck} aria-label={t("fso.read")}>✓</span>}
          </span>
          {chapter.external && <span className={styles.nodeSub}>{t("fso.externalShort")}</span>}
        </button>
      </div>
      <span className={styles.junction} data-done={allDone} aria-hidden="true" />
      <div className={styles.exerciseCell}>
        {chapter.exercises.length > 0 && (
          <button type="button" className={styles.exerciseNode} onClick={() => onOpen(chapter)}
            aria-label={`${t("fso.exercises", { range: exerciseRange(chapter.exercises) })}: ${exercisesDone}/${chapter.exercises.length}`}>
            <span className={styles.nodeHead}>
              <span className={styles.nodeLetter}>{exerciseRange(chapter.exercises)}</span>
              <span className={styles.nodeTitle}>{projectNames(chapter)}</span>
              {exercisesDone === chapter.exercises.length && <span className={styles.nodeCheck}>✓</span>}
            </span>
            <span className={styles.ticks}>
              {chapter.exercises.map((step) => (
                <span key={step.id} className={styles.tick} title={step.title}
                  data-done={isDone(step.id)} data-optional={isOptionalExercise(step)} />
              ))}
            </span>
          </button>
        )}
      </div>
    </>
  );
}
