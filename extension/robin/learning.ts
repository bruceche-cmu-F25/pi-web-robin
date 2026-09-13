import { FSO_SECTIONS } from "./fullstack-open-catalog.ts";
import {
  dailyPracticePlan, groupByPattern, problemsInList, recordMap, statsFor,
  type PracticeList, type PracticeRecord,
} from "./practice.ts";

export interface CourseStep {
  id: string;
  part: number;
  kind: "reading" | "exercise" | "course";
  title: string;
  url: string;
}

/** The current course path, excluding legacy Redux and duplicate alternatives. */
export const FULLSTACK_STEPS: CourseStep[] = FSO_SECTIONS.flatMap(([part, path, title, exercises]) => {
  const migrated = path.startsWith("https:");
  const url = migrated ? path : `https://fullstackopen.com${path}`;
  return [
    { id: path, part, kind: migrated ? "course" as const : "reading" as const, title, url },
    ...exercises.map((exercise) => ({
      id: `${path}/${exercise.match(/^\d+\.\d+/)![0]}`,
      part,
      kind: "exercise" as const,
      title: exercise,
      // The official HTML has no heading IDs. Text fragments locate the actual
      // exercise in supporting browsers and safely fall back to its section.
      url: `${url}#:~:text=${encodeURIComponent(exercise)}`,
    })),
  ];
});

export function fullstackPlan(completedIds: readonly string[]) {
  const completed = new Set(completedIds);
  const remaining = FULLSTACK_STEPS.filter((step) => !completed.has(step.id));
  const next = remaining[0] ?? null;
  const partSteps = next ? FULLSTACK_STEPS.filter((step) => step.part === next.part) : [];
  return {
    next,
    upcoming: remaining.slice(1, 4),
    currentPart: next ? {
      part: next.part,
      completed: partSteps.filter((step) => completed.has(step.id)).length,
      total: partSteps.length,
      // Course-authored section titles, not generated goals or extra tasks.
      topics: FSO_SECTIONS.filter(([part]) => part === next.part).map(([, , title]) => title),
      byKind: (["reading", "exercise", "course"] as const).map((kind) => ({
        kind,
        completed: partSteps.filter((step) => step.kind === kind && completed.has(step.id)).length,
        total: partSteps.filter((step) => step.kind === kind).length,
      })).filter((group) => group.total > 0),
    } : null,
    completed: FULLSTACK_STEPS.filter((step) => completed.has(step.id)).length,
    total: FULLSTACK_STEPS.length,
    completedIds: [...completed],
    lastCompleted: [...completedIds].reverse()
      .map((id) => FULLSTACK_STEPS.find((step) => step.id === id)).find(Boolean) ?? null,
  };
}

/** New work never changes with the date; reviews are a separate daily queue. */
export function practicePlan(records: PracticeRecord[], list: PracticeList, today: string) {
  const problems = problemsInList(list);
  const bySlug = recordMap(records);
  const ordered = groupByPattern(problems, bySlug).flatMap((group) => group.problems);
  const daily = dailyPracticePlan(problems, bySlug, today);
  return {
    list,
    next: ordered.find((problem) => bySlug.get(problem.link)?.status !== "solved") ?? null,
    review: daily.reviews[0] ?? null,
    daily,
    stats: statsFor(problems, bySlug, today),
  };
}

export function practiceHref(slug: string, list: PracticeList): string {
  return `/coding?problem=${encodeURIComponent(slug)}&list=${list}`;
}

export interface LearningSnapshot {
  practice: ReturnType<typeof practicePlan>;
  fullstack: ReturnType<typeof fullstackPlan>;
}
