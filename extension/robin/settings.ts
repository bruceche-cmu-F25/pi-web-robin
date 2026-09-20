/**
 * Credential and integration preference storage for the dashboard settings screen.
 *
 * Server-only. Nothing here may be imported by a client component, and the
 * values themselves must never be sent to the browser — the API returns
 * `describe*()` summaries instead, which say whether a secret is present
 * without disclosing it.
 *
 * ## Why a file and not .env.local
 *
 * Next reads .env only at startup, so a settings screen writing there would do
 * nothing until a restart — which defeats the point of having the screen. These
 * values are read per request instead, so an edit takes effect immediately.
 *
 * ## Precedence
 *
 * The file wins; the environment is a fallback. A value typed into the UI has
 * to override an older `.env.local` entry, otherwise editing appears to do
 * nothing. Where a value is coming from is reported back to the UI so a
 * lingering environment variable is never a silent surprise.
 */
import { chmodSync } from "node:fs";
import { dataPath, readJsonObject, writeJsonObject } from "./paths.ts";

const SECRETS_FILE = "secrets.json";
const CLOCK_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export interface DailyAgendaSettings {
  enabled: boolean;
  time: string;
  locale: "en" | "zh";
}

export const DEFAULT_DAILY_AGENDA: DailyAgendaSettings = {
  enabled: false,
  time: "08:00",
  locale: "en",
};

/**
 * The twice-daily job push.
 *
 * Two send times rather than an interval: a job digest is something you read
 * over coffee and again after work, and a posting that appeared at 11am is no
 * more urgent for arriving at 11:05. Each slot claims its own batch, so the
 * evening push never repeats the morning's.
 */
export interface JobDigestSettings {
  enabled: boolean;
  morning: string;
  evening: string;
  /** Jobs per push. */
  count: number;
  locale: "en" | "zh";
  /**
   * Who receives the job digest.
   *
   * Separate from the main allow-list because the two are different
   * conversations: the assistant chat is where you talk to Robin, and the job
   * feed is a stream you skim and tap. Mixing them buries one in the other.
   * Empty falls back to the main allow-list, so an existing setup keeps working.
   */
  chatIds: number[];
  /**
   * When to walk the whole ATS directory, once a day.
   *
   * It rides in the bridge rather than a launchd agent of its own because the
   * bridge is already a supervised always-on process on this machine — a
   * second daemon to run one job a night is a second thing to keep alive.
   * Empty disables it.
   */
  sweepAt: string;
}

export const DEFAULT_JOB_DIGEST: JobDigestSettings = {
  enabled: false,
  morning: "08:00",
  evening: "20:00",
  count: 10,
  locale: "en",
  chatIds: [],
  // Before the morning digest, and late enough that the boards have settled.
  sweepAt: "03:00",
};

/**
 * The once-a-day email check.
 *
 * One send time, not two: unlike jobs — which you read over coffee and again
 * after work — important mail (OA, interviews, deliveries, deadlines) is
 * exactly the kind of thing that should surface once and then sit in the
 * conversation where you can ask about it.
 */
export interface GmailDigestSettings {
  enabled: boolean;
  time: string;
  locale: "en" | "zh";
  /** Who receives it; empty falls back to the main allow-list, like the job feed. */
  chatIds: number[];
  /** Gmail search query for the window the agent reviews. */
  query: string;
}

export const DEFAULT_GMAIL_DIGEST: GmailDigestSettings = {
  enabled: false,
  time: "08:00",
  locale: "en",
  chatIds: [],
  query: "newer_than:1d",
};

/**
 * Reminders for events that are about to start.
 *
 * Not a digest: the digests answer "what is my day", and this answers "you
 * need to leave now". It runs off the same poll cycle rather than a slot, so
 * `lead` is the only thing to configure.
 */
export interface ReminderSettings {
  enabled: boolean;
  /** Minutes before an event starts. */
  lead: number;
  locale: "en" | "zh";
  /** Empty falls back to the main allow-list, like the other feeds. */
  chatIds: number[];
}

export const DEFAULT_REMINDERS: ReminderSettings = {
  enabled: false,
  lead: 30,
  locale: "en",
  chatIds: [],
};

/**
 * Speech-to-text for voice notes.
 *
 * Its own key rather than pi's provider auth: pi's logins are OAuth
 * subscriptions resolved inside an extension's tool context, and the bridge is
 * a separate process with no such context. A plain API key is the honest way
 * to say "this costs something and here is what pays for it".
 */
export interface TranscriptionSettings {
  enabled: boolean;
  /** OpenAI-compatible /v1/audio/transcriptions endpoint. */
  baseUrl: string;
  model: string;
}

export const DEFAULT_TRANSCRIPTION: TranscriptionSettings = {
  enabled: false,
  baseUrl: "https://api.openai.com/v1",
  model: "whisper-1",
};

export interface GoogleCalendarSource {
  id: string;
  label?: string;
  enabled: boolean;
}

export interface RobinSecrets {
  google?: {
    clientId?: string;
    clientSecret?: string;
    calendars?: GoogleCalendarSource[];
  };
  notion?: {
    apiToken?: string;
  };
  telegram?: {
    botToken?: string;
    allowedChatIds?: number[];
    dailyAgenda?: DailyAgendaSettings;
    jobDigest?: JobDigestSettings;
    gmailDigest?: GmailDigestSettings;
    reminders?: ReminderSettings;
    transcription?: TranscriptionSettings;
  };
  transcription?: { apiKey?: string };
}

export type SecretSource = "file" | "env";

/** What the browser is allowed to know about a secret. */
export interface SecretStatus {
  set: boolean;
  source?: SecretSource;
  /** Last four characters, enough to tell two credentials apart. */
  hint?: string;
  length?: number;
}

function read(): RobinSecrets {
  return readJsonObject<RobinSecrets>(SECRETS_FILE) ?? {};
}

function write(secrets: RobinSecrets): void {
  writeJsonObject(SECRETS_FILE, secrets);
  // Standing credentials for the user's integrations; do not
  // leave them group- or world-readable.
  try {
    chmodSync(dataPath(SECRETS_FILE), 0o600);
  } catch {
    // Best effort — a filesystem without POSIX modes is not a reason to fail.
  }
}

export function secretsPath(): string {
  return dataPath(SECRETS_FILE);
}

function pick(fileValue: string | undefined, envValue: string | undefined): {
  value: string | undefined;
  source: SecretSource | undefined;
} {
  const fromFile = fileValue?.trim();
  if (fromFile) return { value: fromFile, source: "file" };
  const fromEnv = envValue?.trim();
  if (fromEnv) return { value: fromEnv, source: "env" };
  return { value: undefined, source: undefined };
}

export function describeSecret(value: string | undefined, source: SecretSource | undefined): SecretStatus {
  if (!value) return { set: false };
  return {
    set: true,
    ...(source ? { source } : {}),
    hint: value.slice(-4),
    length: value.length,
  };
}

/* ---------- Google ---------- */

export function googleCredentials(): { clientId?: string; clientSecret?: string } {
  const secrets = read();
  return {
    clientId: pick(secrets.google?.clientId, process.env.ROBIN_GOOGLE_CLIENT_ID).value,
    clientSecret: pick(secrets.google?.clientSecret, process.env.ROBIN_GOOGLE_CLIENT_SECRET).value,
  };
}

export function googleCalendarSources(): GoogleCalendarSource[] {
  const stored = read().google?.calendars;
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((source) => {
    if (!source || typeof source.id !== "string" || !source.id.trim()) return [];
    const label = typeof source.label === "string" && source.label.trim()
      ? source.label.trim()
      : undefined;
    return [{ id: source.id.trim(), ...(label ? { label } : {}), enabled: source.enabled !== false }];
  }).slice(0, 20);
}

export function parseGoogleCalendarId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Calendar URL or ID is required");

  let id = trimmed;
  try {
    const url = new URL(trimmed);
    id = url.searchParams.get("src")?.trim() ?? "";
  } catch {
    // A raw calendar id is valid input too.
  }
  if (!id || id.length > 512 || /[\u0000-\u001f\u007f]/.test(id)) {
    throw new Error("Invalid Google Calendar URL or ID");
  }
  return id;
}

export function setGoogleCalendarSources(calendars: GoogleCalendarSource[]): void {
  if (calendars.length > 20) throw new Error("At most 20 additional calendars are supported");
  const normalized = calendars.map((source) => ({
    id: parseGoogleCalendarId(source.id),
    ...(source.label?.trim() ? { label: source.label.trim().slice(0, 100) } : {}),
    enabled: source.enabled !== false,
  }));
  if (new Set(normalized.map((source) => source.id)).size !== normalized.length) {
    throw new Error("That calendar is already configured");
  }
  const secrets = read();
  write({ ...secrets, google: { ...secrets.google, calendars: normalized } });
}

export function describeGoogle(): { clientId: SecretStatus; clientSecret: SecretStatus; calendars: GoogleCalendarSource[] } {
  const secrets = read();
  const id = pick(secrets.google?.clientId, process.env.ROBIN_GOOGLE_CLIENT_ID);
  const secret = pick(secrets.google?.clientSecret, process.env.ROBIN_GOOGLE_CLIENT_SECRET);
  return {
    clientId: describeSecret(id.value, id.source),
    clientSecret: describeSecret(secret.value, secret.source),
    calendars: googleCalendarSources(),
  };
}

export function setGoogleCredentials(clientId: string, clientSecret: string): void {
  const secrets = read();
  write({
    ...secrets,
    google: { ...secrets.google, clientId: clientId.trim(), clientSecret: clientSecret.trim() },
  });
}

export function clearGoogleCredentials(): void {
  const secrets = read();
  const { google: _dropped, ...rest } = secrets;
  void _dropped;
  write(rest);
}

/* ---------- Notion ---------- */

export function notionSettings(): { apiToken?: string } {
  const secrets = read();
  return {
    apiToken: pick(secrets.notion?.apiToken, process.env.NOTION_API_TOKEN).value,
  };
}

export function describeNotion(): { apiToken: SecretStatus } {
  const secrets = read();
  const token = pick(secrets.notion?.apiToken, process.env.NOTION_API_TOKEN);
  return { apiToken: describeSecret(token.value, token.source) };
}

export function setNotionToken(apiToken: string): void {
  const token = apiToken.trim();
  if (!token) throw new Error("Notion integration token is required");
  const secrets = read();
  write({ ...secrets, notion: { apiToken: token } });
}

export function clearNotion(): void {
  const secrets = read();
  const { notion: _dropped, ...rest } = secrets;
  void _dropped;
  write(rest);
}

/* ---------- Telegram ---------- */

/** Stored values are never trusted raw — an edited file must not crash the bridge. */
function normalizeDailyAgenda(stored: DailyAgendaSettings | undefined): DailyAgendaSettings {
  if (!stored) return { ...DEFAULT_DAILY_AGENDA };
  return {
    enabled: stored.enabled === true,
    time: CLOCK_TIME.test(stored.time) ? stored.time : DEFAULT_DAILY_AGENDA.time,
    locale: stored.locale === "zh" ? "zh" : "en",
  };
}

function normalizeGmailDigest(stored: GmailDigestSettings | undefined): GmailDigestSettings {
  if (!stored) return { ...DEFAULT_GMAIL_DIGEST };
  return {
    enabled: stored.enabled === true,
    time: CLOCK_TIME.test(stored.time) ? stored.time : DEFAULT_GMAIL_DIGEST.time,
    locale: stored.locale === "zh" ? "zh" : "en",
    chatIds: Array.isArray(stored.chatIds)
      ? stored.chatIds.filter((id): id is number => Number.isInteger(id))
      : [],
    query: typeof stored.query === "string" && stored.query.trim()
      ? stored.query.trim()
      : DEFAULT_GMAIL_DIGEST.query,
  };
}

function normalizeJobDigest(stored: JobDigestSettings | undefined): JobDigestSettings {
  if (!stored) return { ...DEFAULT_JOB_DIGEST };
  const count = Number(stored.count);
  return {
    enabled: stored.enabled === true,
    morning: CLOCK_TIME.test(stored.morning) ? stored.morning : DEFAULT_JOB_DIGEST.morning,
    evening: CLOCK_TIME.test(stored.evening) ? stored.evening : DEFAULT_JOB_DIGEST.evening,
    count: Number.isFinite(count) ? Math.min(Math.max(Math.round(count), 1), 50) : DEFAULT_JOB_DIGEST.count,
    locale: stored.locale === "zh" ? "zh" : "en",
    chatIds: Array.isArray(stored.chatIds)
      ? stored.chatIds.filter((id): id is number => Number.isInteger(id))
      : [],
    // An empty string is a real value here — it means "no nightly sweep" — so
    // it has to survive normalisation rather than falling back to the default.
    sweepAt: stored.sweepAt === "" || CLOCK_TIME.test(stored.sweepAt ?? "")
      ? stored.sweepAt ?? DEFAULT_JOB_DIGEST.sweepAt
      : DEFAULT_JOB_DIGEST.sweepAt,
  };
}

function normalizeReminders(stored: ReminderSettings | undefined): ReminderSettings {
  if (!stored) return { ...DEFAULT_REMINDERS };
  const lead = Number(stored.lead);
  return {
    enabled: stored.enabled === true,
    // Under five minutes is not a reminder, and over a day is the digest's job.
    lead: Number.isFinite(lead) ? Math.min(Math.max(Math.round(lead), 5), 1440) : DEFAULT_REMINDERS.lead,
    locale: stored.locale === "zh" ? "zh" : "en",
    chatIds: Array.isArray(stored.chatIds)
      ? stored.chatIds.filter((id): id is number => Number.isInteger(id))
      : [],
  };
}

function normalizeTranscription(stored: TranscriptionSettings | undefined): TranscriptionSettings {
  if (!stored) return { ...DEFAULT_TRANSCRIPTION };
  const baseUrl = typeof stored.baseUrl === "string" ? stored.baseUrl.trim().replace(/\/$/, "") : "";
  return {
    enabled: stored.enabled === true,
    // Only http(s): this URL is fetched with an API key attached.
    baseUrl: /^https?:\/\//i.test(baseUrl) ? baseUrl : DEFAULT_TRANSCRIPTION.baseUrl,
    model: typeof stored.model === "string" && stored.model.trim()
      ? stored.model.trim()
      : DEFAULT_TRANSCRIPTION.model,
  };
}

export function telegramSettings(): {
  botToken?: string;
  allowedChatIds: number[];
  dailyAgenda: DailyAgendaSettings;
  jobDigest: JobDigestSettings;
  gmailDigest: GmailDigestSettings;
  reminders: ReminderSettings;
  transcription: TranscriptionSettings & { apiKey?: string };
} {
  const secrets = read();
  const token = pick(secrets.telegram?.botToken, process.env.TELEGRAM_BOT_TOKEN);
  const fileIds = secrets.telegram?.allowedChatIds;
  const transcriptionKey = pick(secrets.transcription?.apiKey, process.env.OPENAI_API_KEY);
  return {
    botToken: token.value,
    allowedChatIds: Array.isArray(fileIds) && fileIds.length > 0
      ? fileIds
      : parseChatIds(process.env.TELEGRAM_ALLOWED_CHAT_IDS),
    dailyAgenda: normalizeDailyAgenda(secrets.telegram?.dailyAgenda),
    jobDigest: normalizeJobDigest(secrets.telegram?.jobDigest),
    gmailDigest: normalizeGmailDigest(secrets.telegram?.gmailDigest),
    reminders: normalizeReminders(secrets.telegram?.reminders),
    transcription: {
      ...normalizeTranscription(secrets.telegram?.transcription),
      ...(transcriptionKey.value ? { apiKey: transcriptionKey.value } : {}),
    },
  };
}

/** Chat ids and reminder settings are not secret, so they are returned in full. */
export function describeTelegram(): {
  botToken: SecretStatus;
  allowedChatIds: number[];
  dailyAgenda: DailyAgendaSettings;
  jobDigest: JobDigestSettings;
  gmailDigest: GmailDigestSettings;
  reminders: ReminderSettings;
  transcription: TranscriptionSettings & { apiKey: SecretStatus };
} {
  const secrets = read();
  const token = pick(secrets.telegram?.botToken, process.env.TELEGRAM_BOT_TOKEN);
  const transcriptionKey = pick(secrets.transcription?.apiKey, process.env.OPENAI_API_KEY);
  const settings = telegramSettings();
  // The key itself never crosses back to the browser; only whether it is set.
  const { apiKey: _withheld, ...transcription } = settings.transcription;
  void _withheld;
  return {
    botToken: describeSecret(token.value, token.source),
    allowedChatIds: settings.allowedChatIds,
    dailyAgenda: settings.dailyAgenda,
    jobDigest: settings.jobDigest,
    gmailDigest: settings.gmailDigest,
    reminders: settings.reminders,
    transcription: {
      ...transcription,
      apiKey: describeSecret(transcriptionKey.value, transcriptionKey.source),
    },
  };
}

export function setReminders(reminders: ReminderSettings): void {
  if (!Number.isFinite(reminders.lead) || reminders.lead < 5 || reminders.lead > 1440) {
    throw new Error("Reminder lead time must be between 5 and 1440 minutes");
  }
  if (reminders.locale !== "en" && reminders.locale !== "zh") {
    throw new Error("Reminder language must be en or zh");
  }
  const secrets = read();
  write({ ...secrets, telegram: { ...secrets.telegram, reminders } });
}

export function setTranscription(transcription: TranscriptionSettings, apiKey?: string): void {
  if (!/^https?:\/\//i.test(transcription.baseUrl.trim())) {
    throw new Error("Transcription base URL must be http(s)");
  }
  if (!transcription.model.trim()) throw new Error("Transcription model is required");
  const secrets = read();
  const trimmedKey = apiKey?.trim();
  write({
    ...secrets,
    telegram: {
      ...secrets.telegram,
      transcription: {
        ...transcription,
        baseUrl: transcription.baseUrl.trim().replace(/\/$/, ""),
        model: transcription.model.trim(),
      },
    },
    // An omitted key leaves the stored one alone; an empty string clears it.
    ...(apiKey === undefined
      ? {}
      : trimmedKey
        ? { transcription: { apiKey: trimmedKey } }
        : { transcription: {} }),
  });
}

export function setTelegramToken(botToken: string): void {
  const secrets = read();
  write({ ...secrets, telegram: { ...secrets.telegram, botToken: botToken.trim() } });
}

export function setTelegramChatIds(allowedChatIds: number[]): void {
  const secrets = read();
  write({ ...secrets, telegram: { ...secrets.telegram, allowedChatIds } });
}

export function setDailyAgenda(dailyAgenda: DailyAgendaSettings): void {
  if (!CLOCK_TIME.test(dailyAgenda.time)) {
    throw new Error("Daily agenda time must be HH:MM");
  }
  if (dailyAgenda.locale !== "en" && dailyAgenda.locale !== "zh") {
    throw new Error("Daily agenda language must be en or zh");
  }
  const secrets = read();
  write({ ...secrets, telegram: { ...secrets.telegram, dailyAgenda } });
}

export function setGmailDigest(gmailDigest: GmailDigestSettings): void {
  if (!CLOCK_TIME.test(gmailDigest.time)) {
    throw new Error("Gmail digest time must be HH:MM");
  }
  if (gmailDigest.locale !== "en" && gmailDigest.locale !== "zh") {
    throw new Error("Gmail digest language must be en or zh");
  }
  const secrets = read();
  write({ ...secrets, telegram: { ...secrets.telegram, gmailDigest } });
}

export function setJobDigest(jobDigest: JobDigestSettings): void {
  if (!CLOCK_TIME.test(jobDigest.morning) || !CLOCK_TIME.test(jobDigest.evening)) {
    throw new Error("Job digest times must be HH:MM");
  }
  if (jobDigest.sweepAt !== "" && !CLOCK_TIME.test(jobDigest.sweepAt)) {
    throw new Error("Sweep time must be HH:MM, or empty to disable it");
  }
  if (jobDigest.locale !== "en" && jobDigest.locale !== "zh") {
    throw new Error("Job digest language must be en or zh");
  }
  if (!Number.isFinite(jobDigest.count) || jobDigest.count < 1 || jobDigest.count > 50) {
    throw new Error("Job digest size must be between 1 and 50");
  }
  const secrets = read();
  write({ ...secrets, telegram: { ...secrets.telegram, jobDigest } });
}

export function clearTelegram(): void {
  const secrets = read();
  const { telegram: _dropped, ...rest } = secrets;
  void _dropped;
  write(rest);
}

/** Accepts "123, -456" and rejects anything that is not a whole number. */
export function parseChatIds(raw: string | undefined): number[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const parsed = Number(part);
      if (!Number.isInteger(parsed)) throw new Error(`Not a numeric chat id: "${part}"`);
      return parsed;
    });
}

/* ────────────────── the settings screen's sections ────────────────── */

/**
 * The settings screen edits four sections, and every field it sends arrives as
 * untrusted JSON that has to be coerced into one of the typed records above.
 *
 * That coercion is domain knowledge — what a locale may be, that a digest's
 * chat list can arrive as a string or an array, that an absent key means
 * "leave the stored value alone" while an empty string means "clear it". It
 * used to live in the HTTP route, which meant the route imported twenty-three
 * setters and knew the shape of every field. Adding a setting meant editing
 * two files.
 */
export const SETTINGS_SECTIONS = ["google", "googleCalendars", "notion", "telegram"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** Configuration state as the screen renders it — presence and origin, never a secret. */
export interface SettingsView {
  google: ReturnType<typeof describeGoogle>;
  notion: ReturnType<typeof describeNotion>;
  telegram: ReturnType<typeof describeTelegram>;
  /** Where the file lives, so the screen can tell the user where to look. */
  storedAt: string;
}

export type SettingsResult<T> = T | { error: string; status?: number };

export function settingsView(): SettingsView {
  return {
    google: describeGoogle(),
    notion: describeNotion(),
    telegram: describeTelegram(),
    storedAt: secretsPath(),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

const str = (value: unknown): string => (typeof value === "string" ? value : "");
const locale = (value: unknown): "en" | "zh" => (value === "zh" ? "zh" : "en");

/** A digest's audience arrives as a comma string from the form, or an array on replay. */
function chatList(value: unknown): number[] {
  if (typeof value === "string") return parseChatIds(value);
  if (Array.isArray(value)) return value.filter((id): id is number => Number.isInteger(id));
  return [];
}

function applyGoogle(body: Record<string, unknown>): SettingsResult<Pick<SettingsView, "google">> {
  const clientId = str(body.clientId).trim();
  const clientSecret = str(body.clientSecret).trim();
  if (!clientId || !clientSecret) {
    return { error: "Both the client ID and the client secret are required" };
  }
  setGoogleCredentials(clientId, clientSecret);
  return { google: describeGoogle() };
}

function applyGoogleCalendars(body: Record<string, unknown>): SettingsResult<Pick<SettingsView, "google">> {
  const calendars = googleCalendarSources();
  const id = typeof body.id === "string" ? body.id : null;

  if (body.action === "add") {
    if (typeof body.value !== "string") return { error: "Calendar URL or ID is required" };
    const added = parseGoogleCalendarId(body.value);
    if (calendars.some((source) => source.id === added)) {
      return { error: "That calendar is already configured" };
    }
    const label = str(body.label).trim();
    setGoogleCalendarSources([...calendars, { id: added, ...(label ? { label } : {}), enabled: true }]);
  } else if (body.action === "toggle" || body.action === "remove") {
    if (!id) return { error: "Calendar id is required" };
    if (!calendars.some((source) => source.id === id)) return { error: "Calendar not found", status: 404 };
    setGoogleCalendarSources(body.action === "remove"
      ? calendars.filter((source) => source.id !== id)
      : calendars.map((source) => (source.id === id ? { ...source, enabled: body.enabled === true } : source)));
  } else {
    return { error: 'action must be "add", "toggle", or "remove"' };
  }
  return { google: describeGoogle() };
}

function applyTelegram(body: Record<string, unknown>): SettingsResult<Pick<SettingsView, "telegram">> {
  // The token and the chat list are edited separately, so an empty field means
  // "leave alone" rather than "clear" — clearing is its own action.
  if (typeof body.botToken === "string" && body.botToken.trim()) setTelegramToken(body.botToken);
  if (typeof body.chatIds === "string") setTelegramChatIds(parseChatIds(body.chatIds));

  const agenda = asRecord(body.dailyAgenda);
  if (agenda) {
    setDailyAgenda({ enabled: agenda.enabled === true, time: str(agenda.time), locale: locale(agenda.locale) });
  }

  const jobDigest = asRecord(body.jobDigest);
  if (jobDigest) {
    setJobDigest({
      enabled: jobDigest.enabled === true,
      morning: str(jobDigest.morning),
      evening: str(jobDigest.evening),
      count: Number(jobDigest.count),
      locale: locale(jobDigest.locale),
      chatIds: chatList(jobDigest.chatIds),
      sweepAt: str(jobDigest.sweepAt),
    });
  }

  const gmailDigest = asRecord(body.gmailDigest);
  if (gmailDigest) {
    setGmailDigest({
      enabled: gmailDigest.enabled === true,
      time: str(gmailDigest.time),
      locale: locale(gmailDigest.locale),
      chatIds: chatList(gmailDigest.chatIds),
      query: str(gmailDigest.query).trim(),
    });
  }

  const reminders = asRecord(body.reminders);
  if (reminders) {
    setReminders({
      enabled: reminders.enabled === true,
      lead: Number(reminders.lead),
      locale: locale(reminders.locale),
      chatIds: chatList(reminders.chatIds),
    });
  }

  const transcription = asRecord(body.transcription);
  if (transcription) {
    // An absent key means "leave the stored one alone", matching how the bot
    // token behaves; an empty string is an explicit clear.
    setTranscription(
      {
        enabled: transcription.enabled === true,
        baseUrl: str(transcription.baseUrl),
        model: str(transcription.model),
      },
      typeof transcription.apiKey === "string" ? transcription.apiKey : undefined,
    );
  }

  return { telegram: describeTelegram() };
}

/** Apply one section of the settings screen, coercing whatever the browser sent. */
export function applySettingsSection(
  section: unknown,
  body: Record<string, unknown>,
): SettingsResult<Partial<SettingsView>> {
  switch (section) {
    case "google": return applyGoogle(body);
    case "googleCalendars": return applyGoogleCalendars(body);
    case "notion":
      setNotionToken(str(body.apiToken));
      return { notion: describeNotion() };
    case "telegram": return applyTelegram(body);
    default:
      return { error: `section must be one of: ${SETTINGS_SECTIONS.join(", ")}` };
  }
}

/** Forget one section's credentials; the environment becomes the fallback again. */
export function clearSettingsSection(section: unknown): SettingsResult<Partial<SettingsView>> {
  switch (section) {
    case "google":
      clearGoogleCredentials();
      return { google: describeGoogle() };
    case "notion":
      clearNotion();
      return { notion: describeNotion() };
    case "telegram":
      clearTelegram();
      return { telegram: describeTelegram() };
    default:
      return { error: 'section must be "google", "notion", or "telegram"' };
  }
}

export interface DetectedChat {
  id: number;
  name: string;
}

/**
 * One-shot chat-id discovery: ask Telegram for pending updates and report the
 * chats they came from.
 *
 * Sent without an `offset`, so it reads the backlog without acknowledging it
 * and does not consume messages the bridge still needs.
 */
export async function detectTelegramChats(): Promise<SettingsResult<{ chats: DetectedChat[] }>> {
  const { botToken } = telegramSettings();
  if (!botToken) return { error: "Save a bot token first" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  let payload: { ok?: boolean; result?: unknown[]; description?: string };
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timeout: 0, allowed_updates: ["message", "channel_post", "my_chat_member"] }),
    });
    payload = await response.json() as typeof payload;
    if (!response.ok || !payload.ok) {
      return { error: payload.description ?? `Telegram returned HTTP ${response.status}` };
    }
  } finally {
    clearTimeout(timer);
  }

  const seen = new Map<number, string>();
  for (const raw of payload.result ?? []) {
    // A private chat arrives as `message`; a channel the bot was just added to
    // arrives as `my_chat_member`, and a channel it can post in as
    // `channel_post`. Reading only `message` is why adding the bot to a channel
    // used to detect nothing.
    const update = raw as {
      message?: { chat?: { id?: unknown; title?: unknown }; from?: { username?: unknown; first_name?: unknown } };
      channel_post?: { chat?: { id?: unknown; title?: unknown } };
      my_chat_member?: { chat?: { id?: unknown; title?: unknown; type?: unknown } };
    };
    const source = update.message ?? update.channel_post ?? update.my_chat_member;
    const id = source?.chat?.id;
    if (typeof id !== "number") continue;
    const from = update.message?.from;
    seen.set(id, String(source?.chat?.title ?? from?.username ?? from?.first_name ?? "unknown"));
  }

  return { chats: [...seen].map(([id, name]) => ({ id, name })) };
}
