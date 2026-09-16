import { localDate } from "./dates.ts";
import { fullstackSnapshot } from "./fso-domain.ts";
import { practicePlan, type LearningSnapshot } from "./learning.ts";
import { readPracticeRecords, readPracticeState } from "./store.ts";

/** The Learning Hub combines two independent tracks; neither track reads through this module. */
export function learningSnapshot(): LearningSnapshot {
  return {
    practice: practicePlan(readPracticeRecords(), readPracticeState().list ?? "neetcode150", localDate()),
    fullstack: fullstackSnapshot(),
  };
}
