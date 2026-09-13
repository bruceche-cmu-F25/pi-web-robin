/**
 * Full Stack Open as its own course: parts, chapters, and the exercises in
 * each chapter.
 *
 * Built from the same generated catalog and step ids as the dashboard's course
 * progress, so a tick here is a tick there. Browser-safe: no `node:fs`.
 */
import { FSO_SECTIONS } from "./fullstack-open-catalog.ts";
import { FULLSTACK_STEPS, type CourseStep } from "./learning.ts";

/** Part titles as the course homepage lists them. The catalog only has chapter titles. */
export const FSO_PART_TITLES: Readonly<Record<number, string>> = {
  0: "Fundamentals of Web apps",
  1: "Introduction to React",
  2: "Communicating with server",
  3: "Programming a server with NodeJS and Express",
  4: "Testing Express servers, user administration",
  5: "Testing React apps, React Router",
  6: "Advanced state management",
  7: "Custom hooks, esbuild",
  8: "GraphQL",
  9: "TypeScript",
  10: "React Native",
  11: "CI/CD",
  12: "Containers",
  13: "Using relational databases",
  14: "Next.JS",
};

/** Consecutive exercises that build the same thing: "unicafe 1.6–1.11". */
export interface FsoProject {
  name: string;
  steps: CourseStep[];
}

export interface FsoChapter {
  /** The chapter's reading step id — its catalog path, or the mooc.fi URL. */
  id: string;
  part: number;
  /** The course's own a, b, c… lettering within a part. */
  letter: string;
  title: string;
  url: string;
  /** Moved to courses.mooc.fi, which refuses to be framed. */
  external: boolean;
  exercises: CourseStep[];
  projects: FsoProject[];
}

export interface FsoPart {
  part: number;
  title: string;
  chapters: FsoChapter[];
  /** Every completable step in the part: each chapter's reading plus its exercises. */
  stepIds: string[];
}

const EXERCISE_NUMBER = /^(\d+\.\d+)(\*?)/;

/** "1.11*: unicafe step 6" → "1.11". */
export function exerciseNumber(step: CourseStep): string {
  return step.title.match(EXERCISE_NUMBER)?.[1] ?? step.title;
}

/** Starred exercises are optional in the course. */
export function isOptionalExercise(step: CourseStep): boolean {
  return step.title.match(EXERCISE_NUMBER)?.[2] === "*";
}

/** "3.9 Phonebook backend step 9" and "4.1 Blog List, step 1" → the project's name. */
function projectName(step: CourseStep): string {
  return step.title
    .replace(/^\d+\.\d+\*?:?\s*/, "")
    .replace(/,?\s*step\s*\d+$/i, "")
    .trim();
}

function groupProjects(exercises: CourseStep[]): FsoProject[] {
  const projects: FsoProject[] = [];
  for (const step of exercises) {
    const name = projectName(step);
    const last = projects.at(-1);
    if (last && last.name.toLowerCase() === name.toLowerCase()) last.steps.push(step);
    else projects.push({ name, steps: [step] });
  }
  return projects;
}

const STEP_BY_ID = new Map(FULLSTACK_STEPS.map((step) => [step.id, step]));

export const FSO_PARTS: readonly FsoPart[] = (() => {
  const parts = new Map<number, FsoPart>();
  for (const [part, path, title] of FSO_SECTIONS) {
    const reading = STEP_BY_ID.get(path);
    if (!reading) continue;
    const entry = parts.get(part) ?? { part, title: FSO_PART_TITLES[part] ?? title, chapters: [], stepIds: [] };
    const exercises = FULLSTACK_STEPS.filter((step) => step.kind === "exercise" && step.id.startsWith(`${path}/`));
    entry.chapters.push({
      id: path,
      part,
      letter: String.fromCharCode(97 + entry.chapters.length),
      title,
      url: reading.url,
      external: reading.kind === "course",
      exercises,
      projects: groupProjects(exercises),
    });
    entry.stepIds.push(path, ...exercises.map((step) => step.id));
    parts.set(part, entry);
  }
  return [...parts.values()];
})();

export const FSO_CHAPTERS: readonly FsoChapter[] = FSO_PARTS.flatMap((part) => part.chapters);

const CHAPTER_BY_ID = new Map(FSO_CHAPTERS.map((chapter) => [chapter.id, chapter]));

export function findChapter(id: string | null | undefined): FsoChapter | null {
  return id ? CHAPTER_BY_ID.get(id) ?? null : null;
}

/** The chapter a course step belongs to — itself for a reading step. */
export function chapterForStep(stepId: string | null | undefined): FsoChapter | null {
  if (!stepId) return null;
  return CHAPTER_BY_ID.get(stepId)
    ?? FSO_CHAPTERS.find((chapter) => chapter.exercises.some((step) => step.id === stepId))
    ?? null;
}

export function nextChapter(chapter: FsoChapter): FsoChapter | null {
  const index = FSO_CHAPTERS.indexOf(chapter);
  return index >= 0 ? FSO_CHAPTERS[index + 1] ?? null : null;
}

/** "1.6–1.14", or the single number. */
export function exerciseRange(steps: readonly CourseStep[]): string {
  if (!steps.length) return "";
  const first = exerciseNumber(steps[0]);
  const last = exerciseNumber(steps[steps.length - 1]);
  return first === last ? first : `${first}–${last}`;
}

/**
 * Where the workspace should send "continue": the chapter holding the first
 * unfinished step, in course order.
 */
export function continueChapter(completedIds: readonly string[]): FsoChapter | null {
  const done = new Set(completedIds);
  const next = FULLSTACK_STEPS.find((step) => !done.has(step.id));
  return chapterForStep(next?.id);
}
