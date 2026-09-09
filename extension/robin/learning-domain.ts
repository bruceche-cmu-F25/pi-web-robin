import { localDate } from "./dates.ts";
import { FULLSTACK_STEPS, fullstackPlan, practicePlan, type LearningSnapshot } from "./learning.ts";
import { readJsonObject, updateJsonObject } from "./paths.ts";
import { readPracticeRecords, readPracticeState } from "./store.ts";

const FILE = "fullstack-open-progress.json";
interface FullstackProgress { completedIds: string[] }

function completedIds(state: FullstackProgress | null): string[] {
  if (state === null) return [];
  if (!Array.isArray(state.completedIds) || state.completedIds.some((id) => typeof id !== "string")) {
    throw new Error("Invalid Full Stack Open progress file");
  }
  return state.completedIds;
}

export function learningSnapshot(): LearningSnapshot {
  return {
    practice: practicePlan(readPracticeRecords(), readPracticeState().list ?? "neetcode150", localDate()),
    fullstack: fullstackPlan(completedIds(readJsonObject<FullstackProgress>(FILE))),
  };
}

/** Explicit, idempotent writes; a repeated click never completes the next step. */
export function setFullstackCompleted(id: string, completed: boolean): void {
  if (!FULLSTACK_STEPS.some((step) => step.id === id)) throw new Error("Unknown course step");
  if (typeof completed !== "boolean") throw new Error("completed must be a boolean");
  updateJsonObject<FullstackProgress, void>(FILE, (state) => {
    const ids = new Set(completedIds(state));
    const changed = ids.has(id) !== completed;
    if (completed) ids.add(id);
    else ids.delete(id);
    return { value: { ...state, completedIds: [...ids] }, result: undefined, changed };
  });
}
