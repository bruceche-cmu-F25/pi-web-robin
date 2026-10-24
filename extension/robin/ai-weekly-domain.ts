/** One domain owns editions, preferences, reading state, run history and delivery receipts.
 * New domain storage, not one of the legacy task/runtime files migrated to SQLite.
 * All publications are atomic and fenced by the shared cross-process run lease.
 */
import { randomUUID } from "node:crypto";
import { readJsonObject, updateJsonObject } from "./paths.ts";
import { backgroundRunActive, executeBackgroundRun } from "./background-run-domain.ts";
import { telegramSettings } from "./settings.ts";
import {
  WEEKLY_LANES, weeklyClock, shiftDay, calendarDay, weeklyStoryId,
  type WeeklyPreferences, type WeeklyEdition, type WeeklyRun, type WeeklyDelivery, type WeeklyView,
} from "./ai-weekly.ts";
import { parseHarvest, parseBrief, verifyWeeklySources } from "./ai-weekly-research.ts";

const FILE = "ai-weekly/state.json";
const RUN = "ai-weekly:generate";
const DELIVERY = "ai-weekly:deliver";
interface State {
  version: 1;
  preferences: WeeklyPreferences;
  editions: WeeklyEdition[];
  runs: WeeklyRun[];
  read: string[];
  deliveries: WeeklyDelivery[];
}
function initial(): State {
  return { version: 1, preferences: { enabled: false, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    at: "08:00", telegram: false,
    interests: "模型与 API、Coding Agent、开源工具与工程实践；重要研究、中国与全球 AI 产业、算力、商业和政策。实用与全景同等重要。" },
  editions: [], runs: [], read: [], deliveries: [] };
}
function checked(value: State | null): State {
  if (!value) return initial();
  if (value.version !== 1 || !value.preferences || !Array.isArray(value.editions) || !Array.isArray(value.runs)
    || !Array.isArray(value.read) || !Array.isArray(value.deliveries)) throw new Error("AI weekly storage is invalid; refusing to overwrite it");
  return value;
}
function readState(): State { return checked(readJsonObject<State>(FILE)); }
function update<T>(fn: (state: State) => T): T {
  return updateJsonObject<State, T>(FILE, (stored) => {
    const state = checked(stored);
    const result = fn(state);
    return { value: state, result, changed: true };
  });
}
export function weeklyPreferences(): WeeklyPreferences { return readState().preferences; }
export function setWeeklyPreferences(input: unknown): WeeklyPreferences {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid weekly preferences");
  const patch = input as Record<string, unknown>;
  for (const key of Object.keys(patch)) if (!["enabled", "timezone", "at", "telegram", "interests"].includes(key)) throw new Error(`Unknown weekly preference: ${key}`);
  return update((state) => {
    const p = { ...state.preferences, ...patch };
    if (typeof p.enabled !== "boolean" || typeof p.telegram !== "boolean") throw new Error("Invalid automation switch");
    if (typeof p.at !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(p.at)) throw new Error("Time must be HH:MM");
    if (typeof p.timezone !== "string" || p.timezone.length > 100) throw new Error("Invalid timezone");
    weeklyClock(new Date(), p.timezone);
    if (typeof p.interests !== "string" || !p.interests.trim() || p.interests.length > 2000) throw new Error("Interests must contain 1–2000 characters");
    if (p.telegram) {
      const config = telegramSettings();
      if (!config.botToken || !config.allowedChatIds.length) throw new Error("Configure Telegram and its allowed chats first");
    }
    state.preferences = p as WeeklyPreferences;
    return state.preferences;
  });
}
export function weeklyView(week?: string, now = new Date()): WeeklyView {
  if (week !== undefined && !calendarDay(week)) throw new Error("Invalid edition date");
  const state = readState();
  const clock = weeklyClock(now, state.preferences.timezone);
  const running = backgroundRunActive(RUN);
  const run = state.runs.at(-1) ?? null;
  const telegram = telegramSettings();
  return { preferences: state.preferences, today: clock.today, week: clock.week,
    edition: state.editions.find((e) => e.week === (week ?? clock.week)) ?? null,
    archive: state.editions.map(({ week, headline }) => ({ week, headline })).reverse(),
    run, running, interrupted: Boolean(run && !["done", "failed"].includes(run.stage) && !running),
    read: state.read, deliveries: state.deliveries.filter((d) => d.date === clock.today),
    telegramReady: Boolean(telegram.botToken && telegram.allowedChatIds.length) };
}
export function setWeeklyRead(week: unknown, date: unknown, read: unknown): void {
  if (!calendarDay(week) || !calendarDay(date) || typeof read !== "boolean") throw new Error("Invalid reading state");
  update((state) => {
    const edition = state.editions.find((e) => e.week === week);
    const slot = edition?.slots.find((s) => s.date === date);
    if (!edition || !slot?.story) throw new Error("Story not found");
    const id = weeklyStoryId(edition, slot);
    state.read = state.read.filter((key) => key !== id);
    if (read) state.read.push(id);
  });
}
export interface WeeklyResearchDeps {
  harvest: (message: string, signal: AbortSignal, remember: (id: string) => void) => Promise<string>;
  brief: (message: string, signal: AbortSignal, remember: (id: string) => void) => Promise<string>;
  fetchImpl?: typeof fetch;
}
/** Automatic failures retry hourly (quota errors: six hours), at most three attempts per week.
 * A manual retry is explicit and can exceed that budget. A published edition is immutable.
 */
export async function generateWeekly(deps: WeeklyResearchDeps, manual = false, now = new Date()) {
  return executeBackgroundRun(RUN, async ({ signal, commit }) => {
    const state = readState();
    const clock = weeklyClock(now, state.preferences.timezone);
    if (state.editions.some((e) => e.week === clock.week)) return "exists";
    const attempts = state.runs.filter((r) => r.week === clock.week);
    if (!manual && (!state.preferences.enabled || clock.time < state.preferences.at || attempts.length >= 3
      || (attempts.at(-1)?.retryAt ?? "") > now.toISOString())) return "not-due";
    const id = randomUUID();
    const save = (fn: (s: State) => void) => {
      signal.throwIfAborted();
      const result = commit(() => update(fn));
      if (!result.owned) throw new Error("AI weekly run ownership expired");
    };
    save((s) => {
      s.runs = [...s.runs.slice(-59), { id, week: clock.week, startedAt: now.toISOString(), stage: "harvest", sessions: [] }];
    });
    const progress = (patch: Partial<WeeklyRun>) => save((s) => { Object.assign(s.runs.find((r) => r.id === id)!, patch); });
    const remember = (session: string) => save((s) => { s.runs.find((r) => r.id === id)!.sessions.push(session); });
    try {
      const previous = state.editions.slice(-12);
      const harvestReply = await deps.harvest(JSON.stringify({
        reportingWindow: { from: clock.from, through: clock.through },
        interests: state.preferences.interests,
        alreadyCovered: previous.flatMap((e) => e.slots.flatMap((s) => s.story ? [{ key: s.story.key, title: s.story.title, url: s.story.source.url }] : [])),
      }), signal, remember);
      const harvested = parseHarvest(harvestReply, clock.from, clock.through, previous);
      progress({ stage: "verify", candidates: harvested.candidates.length });
      const evidence = await verifyWeeklySources(harvested.candidates, signal, deps.fetchImpl);
      if (!evidence.verified.length) throw new Error(`No source passages passed verification. ${[...harvested.gaps, ...evidence.gaps].slice(0, 3).join("; ")}`);
      progress({ stage: "brief", verified: evidence.verified.length });
      const reply = await deps.brief(JSON.stringify({ reportingWindow: { from: clock.from, through: clock.through },
        interests: state.preferences.interests, candidates: evidence.verified }), signal, remember);
      const brief = parseBrief(reply, evidence.verified);
      if (!brief.stories.length) throw new Error("Editor found no publishable events; nothing published");
      const remaining = [...brief.stories];
      const slots = WEEKLY_LANES.map((lane, index) => {
        const at = remaining.findIndex((s) => s.lane === lane);
        return { date: shiftDay(clock.week, index), lane, story: at < 0 ? null : remaining.splice(at, 1)[0]! };
      });
      const edition: WeeklyEdition = { week: clock.week, from: clock.from, through: clock.through,
        createdAt: new Date().toISOString(), headline: brief.headline, slots,
        gaps: [...new Set([...harvested.gaps, ...evidence.gaps,
          ...slots.filter((s) => !s.story).map((s) => `${s.date} · ${s.lane === "practical" ? "实用" : "全景"}：本期没有足够可靠且不重复的条目，不凑数。`)])].slice(0, 40),
        ignored: brief.ignored };
      save((s) => {
        if (s.editions.some((e) => e.week === clock.week)) throw new Error("Edition was already published");
        s.editions = [...s.editions, edition].sort((a, b) => a.week.localeCompare(b.week)).slice(-26);
        const first = s.editions[0]!.week;
        s.read = s.read.filter((key) => key.slice(0, 10) >= first);
        Object.assign(s.runs.find((r) => r.id === id)!, { stage: "done", finishedAt: new Date().toISOString() });
      });
      return "published";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const delay = /quota|rate.?limit|429|usage.?limit/i.test(message) ? 6 * 3600_000 : 3600_000;
      // A replaced owner cannot publish a failure over its successor either.
      commit(() => update((s) => {
        Object.assign(s.runs.find((r) => r.id === id)!, { stage: "failed", error: message.slice(0, 2000),
          finishedAt: new Date().toISOString(), retryAt: new Date(Date.now() + delay).toISOString() });
      }));
      throw error;
    }
  });
}

export interface WeeklyDeliveryDeps {
  /** Throw for uncertain transport outcomes; false only for an explicit API rejection. */
  send: (chatId: number, text: string, signal: AbortSignal) => Promise<boolean>;
  audience: number[];
}
/** Latest day only: waking after downtime never dumps a week's backlog on the user. */
export async function deliverWeeklyDay(deps: WeeklyDeliveryDeps, now = new Date()) {
  return executeBackgroundRun(DELIVERY, async ({ signal, commit }) => {
    const state = readState();
    const clock = weeklyClock(now, state.preferences.timezone);
    if (!state.preferences.enabled || !state.preferences.telegram || clock.time < state.preferences.at) return;
    const edition = state.editions.find((e) => e.week === clock.week);
    const slot = edition?.slots.find((s) => s.date === clock.today);
    if (!edition || !slot) return;
    const story = slot.story;
    const text = story
      ? `AI 每日一件 · ${clock.today} · ${story.lane === "practical" ? "实用" : "全景"}\n回顾 ${edition.from} — ${edition.through}\n\n${story.title}\n\n${story.what.slice(0, 500)}\n\n为什么关注\n${story.why.slice(0, 500)}\n\n下一步\n${story.action.slice(0, 160)}\n\n注意\n${story.caveat.slice(0, 200)}\n\n来源：${story.source.url}`
      : `AI 每日一件 · ${clock.today}\n本期这个阅读日没有足够可靠的新条目。无需补课，也不凑数。`;
    for (const chatId of [...new Set(deps.audience)]) {
      signal.throwIfAborted();
      const key = `${clock.today}:${chatId}`;
      // Recheck consent before each outbound message, not only at wake time.
      const current = readState();
      if (!current.preferences.enabled || !current.preferences.telegram) break;
      const prior = current.deliveries.find((d) => d.key === key);
      if (prior?.status === "sent" || prior?.status === "uncertain") continue;
      if (prior?.status === "pending") {
        commit(() => update((s) => { const d = s.deliveries.find((d) => d.key === key)!; d.status = "uncertain"; d.error = "Previous delivery was interrupted; not automatically resent"; }));
        continue;
      }
      if (prior && (prior.attempts >= 3 || (prior.retryAt ?? "") > now.toISOString())) continue;
      const reserved = commit(() => update((s) => {
        s.deliveries = s.deliveries.filter((d) => d.key !== key && d.date >= shiftDay(clock.today, -30));
        s.deliveries.push({ key, date: clock.today, status: "pending", at: now.toISOString(), attempts: (prior?.attempts ?? 0) + 1 });
      }));
      if (!reserved.owned) return;
      let status: WeeklyDelivery["status"] = "uncertain";
      try { status = await deps.send(chatId, text, signal) ? "sent" : "failed"; }
      catch { /* Transport failures are uncertain, never permission to send a duplicate. */ }
      commit(() => update((s) => {
        Object.assign(s.deliveries.find((d) => d.key === key)!, { status,
          ...(status === "failed" ? { retryAt: new Date(now.getTime() + 3600_000).toISOString(), error: "Telegram rejected delivery" } : {}),
          ...(status === "uncertain" ? { error: "Delivery outcome unknown; not automatically resent" } : {}) });
      }));
    }
  });
}
