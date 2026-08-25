/**
 * "You need to leave now."
 *
 * The digests answer *what is my day*, at a fixed hour. This answers *the thing
 * you agreed to is starting*, which is only useful at one specific moment and
 * useless at every other. That is why it rides the poll cycle rather than a
 * slot: the loop already comes round every thirty seconds, which is finer than
 * any reminder needs.
 *
 * Google events count. A reminder that knows about the meeting on your work
 * calendar and not the one you typed into Robin would be worse than none, so
 * this reads the same merged feed the dashboard does.
 */
import { occursOn, type DashboardEvent } from "../../extension/robin/events.ts";
import type { DeliveryLedger } from "../../extension/robin/delivery-ledger.ts";
import { piWeb, type PiWebContext } from "./pi-web.ts";
import type { BridgeLocale } from "./protocol.ts";

/** Minutes since midnight, from a wall-clock `HH:MM`. Null when unparseable. */
export function minutesOfDay(time: string | undefined): number | null {
  if (!time) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Which of today's events are about to start.
 *
 * Strictly forward-looking: an event that has already begun is not a reminder,
 * it is a notification about the past, and firing those on startup would mean a
 * restart at nine in the morning replaying the whole morning.
 *
 * All-day events are excluded for the same reason — they have no moment to be
 * early for, and the daily briefing already lists them.
 */
export function dueReminders(
  events: DashboardEvent[],
  today: string,
  nowMinutes: number,
  leadMinutes: number,
): DashboardEvent[] {
  return events
    .filter((event) => occursOn(event, today))
    .filter((event) => {
      // A multi-day event only "starts" on its first day; its start time on
      // day three is not a thing to be reminded about.
      if (event.date !== today) return false;
      const start = minutesOfDay(event.start);
      if (start === null) return false;
      return start > nowMinutes && start - nowMinutes <= leadMinutes;
    })
    .sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""));
}

const STRINGS: Record<BridgeLocale, { soon: (minutes: number) => string; at: string }> = {
  en: {
    soon: (minutes) => `Starting in ${minutes} min`,
    at: "at",
  },
  zh: {
    soon: (minutes) => `${minutes} 分钟后开始`,
    at: "于",
  },
};

/** One reminder, phrased for a glance at a lock screen. */
export function formatReminder(
  event: DashboardEvent,
  nowMinutes: number,
  locale: BridgeLocale,
): string {
  const strings = STRINGS[locale];
  const start = minutesOfDay(event.start) ?? nowMinutes;
  const away = Math.max(0, start - nowMinutes);
  const where = event.location ? ` — ${event.location}` : "";
  return `⏰ **${event.title}**\n${strings.soon(away)} (${strings.at} ${event.start})${where}`;
}

/**
 * A reminder is claimed per event per day, not per run.
 *
 * The date is in the key so the same weekly meeting is remindable again next
 * week; the event id is in it so two events an hour apart are two reminders.
 */
export function reminderKey(today: string, eventId: string): string {
  return `${today}:${eventId}`;
}

export interface ReminderRun {
  ctx: PiWebContext;
  ledger: DeliveryLedger;
  audience: number[];
  leadMinutes: number;
  locale: BridgeLocale;
  now: () => number;
  log: (message: string) => void;
  send: (chatId: number, text: string) => Promise<void>;
}

/**
 * Check for imminent events and push what is due.
 *
 * Failures are logged and swallowed: this runs on every poll cycle, and a
 * calendar that cannot be read must not turn into an error every thirty
 * seconds — nor stop the messages the same loop is there to deliver.
 */
export async function runReminders(run: ReminderRun): Promise<void> {
  if (run.audience.length === 0) return;

  let events: DashboardEvent[];
  let today: string;
  try {
    const feed = await piWeb<{ events?: DashboardEvent[]; today?: string }>(
      run.ctx, "/api/robin/events", undefined, 20_000, "GET");
    events = feed.events ?? [];
    // pi-web's date, for the same reason /today uses it: it is the clock the
    // dates were written against.
    if (!feed.today) return;
    today = feed.today;
  } catch (error) {
    run.log(`[reminders] could not read the calendar — ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const at = new Date(run.now());
  const nowMinutes = at.getHours() * 60 + at.getMinutes();

  for (const event of dueReminders(events, today, nowMinutes, run.leadMinutes)) {
    const key = reminderKey(today, event.id);
    const pending = run.ledger.pending(key, run.audience);
    if (pending.length === 0) continue;

    const text = formatReminder(event, nowMinutes, run.locale);
    for (const chatId of pending) {
      try {
        await run.send(chatId, text);
        run.ledger.mark(key, chatId);
      } catch (error) {
        // Left unmarked on purpose: the next cycle is thirty seconds away and
        // the event has not started yet, so a retry is still a useful reminder.
        run.log(`[reminders] send to ${chatId} failed — ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    run.log(`[reminders] ${event.title} at ${event.start} → ${pending.length} chat(s)`);
  }
}
