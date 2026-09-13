"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { FSO_PARTS, type FsoChapter } from "@/extension/robin/fso";
import styles from "./FsoWorkspace.module.css";

interface Props {
  width: number | null;
  chapter: FsoChapter;
  isDone: (stepId: string) => boolean;
  notedIds: ReadonlySet<string>;
  onToggle: (stepId: string, done: boolean) => void;
  onOpen: (chapter: FsoChapter) => void;
  onRoadmap: () => void;
}

/**
 * The course's contents beside the page you are reading: every part on one
 * line, the open part's chapters under it, and the open chapter's exercises
 * under that — each with the checkbox that ticks it on the dashboard too.
 */
export function FsoRail({ width, chapter, isDone, notedIds, onToggle, onOpen, onRoadmap }: Props) {
  const { t } = useI18n();
  const [openPart, setOpenPart] = useState(chapter.part);

  // Follow the reader: opening a chapter elsewhere unfolds its part here.
  useEffect(() => setOpenPart(chapter.part), [chapter.part]);

  return (
    <nav id="fso-rail" className={styles.rail} aria-label={t("fso.contents")}
      style={width === null ? { flex: 1 } : { width, flex: "0 0 auto" }}>
      <div className={styles.railBack}>
        <button type="button" className="ui-action pi-chrome-label pi-bracket" style={{ fontSize: 10 }} onClick={onRoadmap}>
          {t("fso.roadmap")}
        </button>
      </div>
      <ul className={styles.railParts}>
        {FSO_PARTS.map((part) => {
          const done = part.stepIds.filter(isDone).length;
          const open = part.part === openPart;
          return (
            <li key={part.part} className={styles.railPart} data-open={open} data-active={part.part === chapter.part}>
              <button type="button" aria-expanded={open} onClick={() => setOpenPart(open ? -1 : part.part)}>
                <span className={styles.railPartNumber}>{part.part}</span>
                <span className={styles.railPartTitle}>{part.title}</span>
                <span className={styles.railPartCount}>{done}/{part.stepIds.length}</span>
              </button>
              {open && (
                <ul className={styles.railChapters}>
                  {part.chapters.map((entry) => {
                    const read = isDone(entry.id);
                    const current = entry.id === chapter.id;
                    return (
                      <li key={entry.id} className={styles.railChapter} data-open={current} data-done={read}>
                        <input type="checkbox" checked={read}
                          aria-label={`${t(entry.external ? "fso.markCourse" : "fso.markRead")}: ${entry.title}`}
                          onChange={(event) => onToggle(entry.id, event.target.checked)} />
                        <button type="button" className={styles.railChapterButton}
                          aria-current={current ? "page" : undefined} onClick={() => onOpen(entry)}>
                          <span className={styles.nodeLetter}>{entry.letter}</span>
                          <span>{entry.title}{entry.external ? " ↗" : ""}</span>
                          {notedIds.has(entry.id) && <span className={styles.nodeNote} title={t("fso.hasNote")}>✎</span>}
                        </button>
                        {current && entry.exercises.length > 0 && (
                          <ul className={styles.railExercises} aria-label={t("fso.exercisesHeading")}>
                            {entry.exercises.map((step) => {
                              const exerciseDone = isDone(step.id);
                              return (
                                <li key={step.id} className={styles.railExercise} data-done={exerciseDone}>
                                  <input id={`fso-ex-${step.id}`} type="checkbox" checked={exerciseDone}
                                    onChange={(event) => onToggle(step.id, event.target.checked)} />
                                  <label htmlFor={`fso-ex-${step.id}`}>{step.title}</label>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
