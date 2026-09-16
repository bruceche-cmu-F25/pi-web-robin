/** Hiring-round behavior shared by the HTTP and Pi tool adapters. */
import { newId, readJsonObject, updateJsonArray, writeJsonObject } from "./paths.ts";
import {
  companyKey,
  hasTime,
  isRoundKind,
  isSameRound,
  normalizeWhen,
  roundDay,
  type Round,
  type RoundInput,
  type RoundStatus,
} from "./rounds.ts";
import { listTodos, updateTodo, type Todo } from "./todo-domain.ts";

const ROUNDS_FILE = "rounds.json";
const ROUND_SCAN_FILE = "round-scan.json";

export interface RoundScanState {
  /** UTC instant the last look back through the mailbox finished. */
  finishedAt: string;
  days: number;
}

export interface RoundPatch {
  status?: RoundStatus;
  company?: string;
  role?: string;
  /** An empty string removes it. */
  due?: string;
  detail?: string;
}

export type RoundResult<T> = T | { error: string };

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * The todo that is this OA's, if the mail turn made one.
 *
 * The agent writes the todo and the round in separate calls and never quotes
 * one's id in the other, so the link is found rather than told: a todo whose
 * title names the company, on the same day when both have one. A todo already
 * ticked counts too — then the round arrives settled.
 */
function findTodo(round: Round, todos: Todo[], taken: Set<string>): Todo | undefined {
  // Only an OA *is* its todo. An interview's todo is booking or prep
  // ("预约 Claude Corps 面试"), and ticking that must not file the interview
  // away before it has happened.
  if (round.kind !== "oa") return undefined;
  const key = companyKey(round.company);
  if (key.length < 3) return undefined;
  const day = roundDay(round.due);
  return todos.find((todo) => {
    if (taken.has(todo.id) || !companyKey(todo.title).includes(key)) return false;
    // A ticked todo would settle the round on sight, so it has to prove it is
    // this one: the same day on both. "Verify your Roblox email" is not the
    // Roblox interview.
    if (todo.done) return Boolean(day && todo.due === day);
    return !day || !todo.due || todo.due === day;
  });
}

/**
 * All rounds, with the todo side folded in first: a todo ticked on the
 * dashboard closes its round, and a todo written after its round gets linked.
 * Only writes when one of those actually changed something.
 */
export function listRounds(): Round[] {
  const todos = listTodos({ includeDone: true }).todos;
  const byId = new Map(todos.map((todo) => [todo.id, todo]));
  return updateJsonArray<Round, Round[]>(ROUNDS_FILE, (rounds) => {
    let changed = false;
    const taken = new Set(rounds.map((round) => round.todoId).filter((id): id is string => Boolean(id)));
    for (const round of rounds) {
      if (round.status !== "open") continue;
      if (!round.todoId) {
        const todo = findTodo(round, todos, taken);
        if (todo) {
          round.todoId = todo.id;
          taken.add(todo.id);
          changed = true;
        }
      }
      const todo = round.todoId ? byId.get(round.todoId) : undefined;
      if (todo?.done) {
        round.status = "done";
        round.closedAt = todo.completedAt ?? new Date().toISOString();
        round.updatedAt = new Date().toISOString();
        changed = true;
      }
    }
    return { value: [...rounds], changed };
  });
}

/**
 * Add a round, or fold the new details into the one it repeats.
 *
 * Mail about a round arrives more than once — the invitation, a reminder, a
 * reschedule — so the later message's facts win, but a round you already
 * closed stays closed.
 */
export function recordRound(input: RoundInput): { round: Round; created: boolean } {
  if (!isRoundKind(input.kind)) throw new Error(`kind must be "oa" or "interview", not "${input.kind}"`);
  const kind = input.kind;
  const company = input.company.trim();
  if (!company) throw new Error("company is required");
  const due = clean(input.due) ? normalizeWhen(input.due!) : undefined;
  const role = clean(input.role);
  const detail = clean(input.detail);
  const threadId = clean(input.threadId);
  const now = new Date().toISOString();

  return updateJsonArray<Round, { round: Round; created: boolean }>(ROUNDS_FILE, (rounds) => {
    const existing = rounds.find((round) => isSameRound(round, { kind, company, due, threadId }));
    if (existing) {
      // A bare day never overwrites a time already known for the same day.
      if (due && !(hasTime(existing.due) && !hasTime(due) && roundDay(existing.due) === due)) existing.due = due;
      if (role) existing.role = role;
      if (detail) existing.detail = detail;
      if (threadId && !existing.threadId) existing.threadId = threadId;
      existing.updatedAt = now;
      return { value: { round: existing, created: false }, changed: true };
    }
    const round: Round = {
      id: newId(),
      kind,
      company,
      ...(role ? { role } : {}),
      ...(due ? { due } : {}),
      ...(detail ? { detail } : {}),
      ...(threadId ? { threadId } : {}),
      status: "open",
      createdAt: now,
      updatedAt: now,
    };
    const todos = listTodos({ includeDone: true }).todos;
    const taken = new Set(rounds.map((entry) => entry.todoId).filter((id): id is string => Boolean(id)));
    const todo = findTodo(round, todos, taken);
    if (todo) {
      round.todoId = todo.id;
      if (todo.done) {
        round.status = "done";
        round.closedAt = todo.completedAt ?? now;
      }
    }
    rounds.push(round);
    return { value: { round, created: true }, changed: true };
  });
}

/** Settling a round settles its todo too, and reopening one reopens both. */
export function updateRound(id: string, patch: RoundPatch): RoundResult<Round> {
  const result = updateJsonArray<Round, RoundResult<Round>>(ROUNDS_FILE, (rounds) => {
    const round = rounds.find((entry) => entry.id === id);
    if (!round) return { value: { error: `No round with id "${id}".` }, changed: false };
    if (patch.company !== undefined) {
      const company = patch.company.trim();
      if (!company) throw new Error("company cannot be empty");
      round.company = company;
    }
    if (patch.role !== undefined) {
      if (patch.role.trim()) round.role = patch.role.trim();
      else delete round.role;
    }
    if (patch.detail !== undefined) {
      if (patch.detail.trim()) round.detail = patch.detail.trim();
      else delete round.detail;
    }
    if (patch.due !== undefined) {
      if (patch.due.trim()) round.due = normalizeWhen(patch.due);
      else delete round.due;
    }
    if (patch.status !== undefined && patch.status !== round.status) {
      round.status = patch.status;
      if (patch.status === "open") delete round.closedAt;
      else round.closedAt = new Date().toISOString();
    }
    round.updatedAt = new Date().toISOString();
    return { value: round, changed: true };
  });
  if ("error" in result || patch.status === undefined || !result.todoId) return result;

  // The todo is a mirror, not a precondition: it may have been deleted or
  // pruned a week after completion, and the round is settled either way.
  try {
    const done = patch.status === "done" || patch.status === "missed" || patch.status === "cancelled";
    updateTodo({ id: result.todoId }, { done });
  } catch {
    // Nothing to mirror.
  }
  return result;
}

export function deleteRound(id: string): RoundResult<Round> {
  return updateJsonArray<Round, RoundResult<Round>>(ROUNDS_FILE, (rounds) => {
    const index = rounds.findIndex((round) => round.id === id);
    if (index < 0) return { value: { error: `No round with id "${id}".` }, changed: false };
    const [round] = rounds.splice(index, 1);
    return { value: round, changed: true };
  });
}

/** English tool-facing representation of one round. */
export function formatRound(round: Round): string {
  const what = round.kind === "oa" ? "OA" : "Interview";
  const role = round.role ? ` — ${round.role}` : "";
  const due = round.due ? ` · ${round.kind === "oa" ? "due" : "at"} ${round.due}` : "";
  const detail = round.detail ? ` · ${round.detail}` : "";
  const status = round.status === "open" ? "" : ` [${round.status}]`;
  return `${round.id}  ${what}: ${round.company}${role}${due}${detail}${status}`;
}

export function readRoundScanState(): RoundScanState | null {
  return readJsonObject<RoundScanState>(ROUND_SCAN_FILE);
}

export function writeRoundScanState(state: RoundScanState): void {
  writeJsonObject(ROUND_SCAN_FILE, state);
}
