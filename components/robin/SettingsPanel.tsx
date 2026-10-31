"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type {
  DailyAgendaSettings,
  GmailDigestSettings,
  GoogleCalendarSource,
  JobDigestSettings,
  NotificationChannel,
  ReminderSettings,
  TranscriptionSettings,
} from "@/extension/robin/settings";
import { useI18n } from "@/hooks/useI18n";
import { GoogleConnect } from "./GoogleConnect";
import { ThemePicker } from "../ThemePicker";
import { NavigationPlacementSetting } from "../NavigationPlacementSetting";
import { VoiceSettings } from "./VoiceSettings";
import styles from "./SettingsPanel.module.css";

const settingGroups = [
  { label: "robin.settings.preferences", items: [
    { id: "general", label: "settings.general", icon: "M4 5h16M4 12h16M4 19h16M8 3v4M16 10v4M9 17v4" },
    { id: "voice", label: "voice.settingsTitle", icon: "M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0V5ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" },
    { id: "notifications", label: "robin.settings.notificationsNav", icon: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" },
  ] },
  { label: "robin.settings.connections", items: [
    { id: "google", label: "robin.settings.googleNav", icon: "M4 5h16v15H4zM4 9h16M8 3v4M16 3v4M8 13h3M13 16h3" },
    { id: "cold-reach-email", label: "robin.settings.outreachNav", icon: "M3 5h18v14H3zM3 6l9 7 9-7" },
    { id: "notion", label: "robin.settings.notionTitle", icon: "M5 3h14v18H5zM9 16V8l6 8V8" },
    { id: "telegram", label: "robin.settings.telegramTitle", icon: "m3 10 18-7-6 18-4-7-8-4Zm8 4L21 3" },
    { id: "playwright", label: "robin.settings.browserNav", icon: "M3 4h18v16H3zM3 9h18M7 6.5h.01M11 6.5h.01M9 13l-2 2 2 2M15 13l2 2-2 2" },
  ] },
  { label: "robin.settings.advanced", items: [
    { id: "transcription", label: "robin.settings.transcriptionTitle", icon: "M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0V5ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" },
    { id: "privacy", label: "robin.settings.privacyTitle", icon: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3ZM9 12l2 2 4-4" },
  ] },
] as const;
type SettingsCategory = typeof settingGroups[number]["items"][number]["id"];

interface SecretStatus {
  set: boolean;
  source?: "file" | "env";
  hint?: string;
  length?: number;
}

interface SettingsResponse {
  notifications: { channel: NotificationChannel };
  google: {
    clientId: SecretStatus;
    clientSecret: SecretStatus;
    calendars: GoogleCalendarSource[];
  };
  notion: {
    apiToken: SecretStatus;
  };
  playwright: { extensionToken: SecretStatus };
  telegram: {
    botToken: SecretStatus;
    allowedChatIds: number[];
    dailyAgenda: DailyAgendaSettings;
    jobDigest: JobDigestSettings;
    gmailDigest: GmailDigestSettings;
    reminders: ReminderSettings;
    transcription: TranscriptionSettings & { apiKey: SecretStatus };
  };
  storedAt: string;
  googleRedirectUri: string;
}

type Translate = (key: string, params?: Record<string, string>) => string;
type SaveAction =
  | "google" | "notion" | "playwright" | "token" | "chatIds" | "dailyAgenda" | "jobDigest" | "gmailDigest"
  | "reminders" | "transcription" | "notifications";
type SavePhase = "saving" | "saved";

// Compare each editable field with its own last acknowledged value. Refreshing
// credential status must not replace another form's draft (or edits made mid-save).
const sameDraft = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function refreshDraft<T>(set: Dispatch<SetStateAction<T>>, next: NoInfer<T>, previous: unknown) {
  set(current => previous === undefined || sameDraft(current, previous) ? next : current);
}
function settingsDrafts(body: SettingsResponse) {
  return {
    notificationChannel: body.notifications?.channel ?? "telegram",
    chatIds: body.telegram.allowedChatIds.join(", "),
    dailyAgenda: body.telegram.dailyAgenda,
    jobDigest: body.telegram.jobDigest,
    jobChatIds: (body.telegram.jobDigest.chatIds ?? []).join(", "),
    gmailDigest: body.telegram.gmailDigest,
    gmailChatIds: (body.telegram.gmailDigest.chatIds ?? []).join(", "),
    reminders: body.telegram.reminders,
    reminderChatIds: (body.telegram.reminders.chatIds ?? []).join(", "),
    transcription: {
      enabled: body.telegram.transcription.enabled,
      baseUrl: body.telegram.transcription.baseUrl,
      model: body.telegram.transcription.model,
    },
  };
}
const savedFields: Partial<Record<SaveAction, (keyof ReturnType<typeof settingsDrafts>)[]>> = {
  notifications: ["notificationChannel"], chatIds: ["chatIds"], dailyAgenda: ["dailyAgenda"],
  jobDigest: ["jobDigest", "jobChatIds"], gmailDigest: ["gmailDigest", "gmailChatIds"],
  reminders: ["reminders", "reminderChatIds"], transcription: ["transcription"],
};

const inputStyle = {
  background: "var(--settings-field-background, var(--bg))",
  border: "1px solid var(--border)",
  color: "var(--text)",
} as const;

function SaveButton({
  label,
  phase,
  disabled,
  onClick,
  className = "",
  t,
}: {
  label: string;
  phase?: SavePhase;
  disabled: boolean;
  onClick: () => void;
  className?: string;
  t: Translate;
}) {
  const saved = phase === "saved";
  return (
    <button
      type="button"
      disabled={disabled || phase !== undefined}
      onClick={onClick}
      aria-live="polite"
      aria-busy={phase === "saving"}
      className={`${styles.saveButton} ui-action ui-action--primary min-h-11 cursor-pointer px-3 py-2 disabled:cursor-default ${className}`}
      data-state={saved ? "success" : "accent"}
      style={{
        opacity: disabled && phase === undefined ? 0.4 : 1,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,

      }}
    >
      {saved && (
        <svg
          aria-hidden="true"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
      {saved ? t("i18n.saved") : phase === "saving" ? t("i18n.saving") : label}
    </button>
  );
}

/** Shows presence and provenance only — the value itself never reaches here. */
function StatusLine({ label, status, t }: { label: string; status: SecretStatus; t: Translate }) {
  if (!status.set) {
    return (
      <p className="text-xs" style={{ color: "var(--text-dim)" }}>
        {t("robin.settings.notSet", { label })}
      </p>
    );
  }
  const detail = status.source === "env"
    ? t("robin.settings.fromEnv", { length: String(status.length ?? 0) })
    : t("robin.settings.fromFile", { length: String(status.length ?? 0) });
  return (
    <p className="text-xs" style={{ color: "var(--text-muted)" }}>
      {t("robin.settings.isSet", { label })}{" "}
      <span className="tabular-nums">••••{status.hint}</span>
      <span style={{ color: "var(--text-dim)" }}> （{detail}）</span>
    </p>
  );
}

export function SettingsPanel() {
  const { locale, setLocale, supportedLocales, t } = useI18n();
  const [category, setCategory] = useState<SettingsCategory>("general");
  const contentRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const syncCategory = () => {
      const id = window.location.hash.slice(1);
      const item = settingGroups.flatMap((group) => [...group.items]).find((item) => item.id === id);
      setCategory(item?.id ?? "general");
      setNotice(null);
    };
    syncCategory();
    window.addEventListener("hashchange", syncCategory);
    return () => window.removeEventListener("hashchange", syncCategory);
  }, []);

  useEffect(() => {
    contentRef.current?.scrollTo(0, 0);
    pageRef.current?.scrollTo(0, 0);
  }, [category]);

  function selectCategory(next: SettingsCategory) {
    if (next === category) return;
    window.history.pushState(null, "", `#${next}`);
    setCategory(next);
    setNotice(null);
  }

  const [data, setData] = useState<SettingsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  const [failedAction, setFailedAction] = useState<SaveAction | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<{ action: SaveAction; phase: SavePhase } | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [calendarInput, setCalendarInput] = useState("");
  const [calendarLabel, setCalendarLabel] = useState("");
  const [notionToken, setNotionToken] = useState("");
  const [playwrightToken, setPlaywrightToken] = useState("");
  const [botToken, setBotToken] = useState("");
  const [notificationChannel, setNotificationChannel] = useState<NotificationChannel>("telegram");
  const [testingPush, setTestingPush] = useState(false);
  const [pushTestResult, setPushTestResult] = useState<string | null>(null);
  const [chatIds, setChatIds] = useState("");
  const [jobChatIds, setJobChatIds] = useState("");
  const [dailyAgenda, setDailyAgenda] = useState<DailyAgendaSettings | null>(null);
  const [jobDigest, setJobDigest] = useState<JobDigestSettings | null>(null);
  const [gmailDigest, setGmailDigest] = useState<GmailDigestSettings | null>(null);
  const [reminders, setReminders] = useState<ReminderSettings | null>(null);
  const [reminderChatIds, setReminderChatIds] = useState("");
  const [transcription, setTranscription] = useState<TranscriptionSettings | null>(null);
  // Write-only, like the bot token: the stored key never comes back from the
  // server, so an empty field means "leave it alone".
  const [transcriptionKey, setTranscriptionKey] = useState("");
  const [gmailChatIds, setGmailChatIds] = useState("");
  const [detected, setDetected] = useState<{ id: number; name: string }[] | null>(null);
  const [baseline, setBaseline] = useState<Record<string, unknown> | null>(null);
  const baselineRef = useRef<Record<string, unknown> | null>(null);
  const savingRef = useRef(false);
  const readRef = useRef<AbortController | null>(null);
  const form = { notificationChannel, chatIds, dailyAgenda, jobDigest, jobChatIds, gmailDigest,
    gmailChatIds, reminders, reminderChatIds, transcription };
  const dirty = Boolean(clientId || clientSecret || calendarInput || calendarLabel || notionToken
    || playwrightToken || botToken || transcriptionKey
    || (baseline && Object.entries(form).some(([key, value]) => !sameDraft(value, baseline[key]))));
  useEffect(() => {
    if (!dirty && !busy) return;
    // Settings entry/exit are native links, including Back (RobinMargin's
    // client-navigation allow-list excludes editors). Never persist secrets.
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy]);

  const load = useCallback(async () => {
    readRef.current?.abort();
    const controller = new AbortController();
    readRef.current = controller;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 30_000);
    try {
      const response = await fetch("/api/robin/settings", { signal: controller.signal });
      const body = await response.json() as SettingsResponse & { error?: string };
      if (controller.signal.aborted || readRef.current !== controller) return false;
      if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
      setData(body);
      const next = settingsDrafts(body);
      const previous = baselineRef.current;
      refreshDraft(setNotificationChannel, next.notificationChannel, previous?.notificationChannel);
      refreshDraft(setChatIds, next.chatIds, previous?.chatIds);
      refreshDraft(setDailyAgenda, next.dailyAgenda, previous?.dailyAgenda);
      refreshDraft(setJobDigest, next.jobDigest, previous?.jobDigest);
      refreshDraft(setJobChatIds, next.jobChatIds, previous?.jobChatIds);
      refreshDraft(setGmailDigest, next.gmailDigest, previous?.gmailDigest);
      refreshDraft(setGmailChatIds, next.gmailChatIds, previous?.gmailChatIds);
      refreshDraft(setReminders, next.reminders, previous?.reminders);
      refreshDraft(setReminderChatIds, next.reminderChatIds, previous?.reminderChatIds);
      refreshDraft(setTranscription, next.transcription, previous?.transcription);
      baselineRef.current = next;
      setBaseline(next);
      return true;
    } catch (caught) {
      if (readRef.current === controller && (!controller.signal.aborted || timedOut)) {
        setError(timedOut ? t("robin.common.readTimeout") : caught instanceof Error ? caught.message : String(caught));
      }
      return false;
    } finally { clearTimeout(timer); }
  }, [t]);

  useEffect(() => {
    void load();
    return () => readRef.current?.abort();
  }, [load]);

  useEffect(() => () => {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
  }, []);

  async function send(
    method: string,
    payload: unknown,
    message: string,
    action?: SaveAction,
  ): Promise<boolean> {
    if (savingRef.current) return false;
    savingRef.current = true;
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    setBusy(true);
    setError(null);
    setFailedAction(null);
    setNotice(null);
    setSaveFeedback(action ? { action, phase: "saving" } : null);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    let confirmedResponse = false;
    try {
      const response = await fetch("/api/robin/settings", {
        method,
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(error => { if (controller.signal.aborted) throw error; return null; }) as { error?: string } | null;
      clearTimeout(timer);
      confirmedResponse = true;
      if (!response.ok) throw new Error(body?.error ?? `Request failed (${response.status})`);
      // Only the submitted snapshot is acknowledged. A newer edit in the same
      // field stays dirty and survives the subsequent status read.
      if (action && baselineRef.current) {
        const acknowledged = { ...baselineRef.current };
        for (const key of savedFields[action] ?? []) acknowledged[key] = form[key];
        baselineRef.current = acknowledged;
        setBaseline(acknowledged);
      }
      setNotice(message);
      if (!await load()) setError(t("robin.settings.savedRefreshFailed"));
      if (action) {
        setSaveFeedback({ action, phase: "saved" });
        feedbackTimer.current = setTimeout(() => setSaveFeedback(null), 2000);
      }
      return true;
    } catch (caught) {
      setSaveFeedback(null);
      setFailedAction(action ?? null);
      setError(!confirmedResponse ? t("robin.settings.writeUncertain") : caught instanceof Error ? caught.message : String(caught));
      return false;
    } finally {
      clearTimeout(timer);
      savingRef.current = false;
      setBusy(false);
    }
  }

  const testPush = async () => {
    setTestingPush(true);
    setPushTestResult(null);
    try {
      const response = await fetch("/api/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({ id: `test:${crypto.randomUUID()}`, title: "Robin",
          body: t("robin.settings.pushTestBody"), url: "/dashboard", ttl: 60 }),
      });
      if (!response.ok) throw new Error("Push not accepted");
      setPushTestResult(t("robin.settings.pushTestAccepted"));
    } catch {
      setPushTestResult(t("robin.settings.pushTestFailed"));
    } finally { setTestingPush(false); }
  };

  const detect = async () => {
    setBusy(true);
    setError(null);
    setDetected(null);
    try {
      const response = await fetch("/api/robin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "detectChatIds" }),
      });
      const body = await response.json() as { chats?: { id: number; name: string }[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
      setDetected(body.chats ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    // globals.css locks html/body to the viewport height with
    // overflow:hidden for the chat shell. This page is a document, so it
    // supplies its own scroll container rather than changing that shared rule.
    <div ref={pageRef} className={`robin-page ${styles.page}`}>
      <main className={styles.layout}>
        <aside className={styles.sidebar}>
          <header className={styles.pageHeader}>
            <h1>{t("robin.settings.title")}</h1>
            <p>{t("robin.settings.workspaceHint")}</p>
          </header>
          <nav className={styles.navigation} aria-label={t("robin.settings.categories")}>
            {settingGroups.map((group) => (
              <div className={styles.navGroup} key={group.label}>
                <h2>{t(group.label)}</h2>
                {group.items.map((item) => (
                  <a key={item.id} href={`#${item.id}`} aria-current={category === item.id ? "location" : undefined}
                    onClick={(event) => {
                      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                      event.preventDefault();
                      selectCategory(item.id);
                    }}>
                    <span className={styles.navIcon} aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={item.icon} /></svg>
                    </span>
                    <span>{t(item.label)}</span>
                    <span className={styles.navChevron} aria-hidden="true">›</span>
                  </a>
                ))}
              </div>
            ))}
          </nav>
          <label className={styles.mobileNavigation}>
            <span>{t("robin.settings.categories")}</span>
            <select value={category} onChange={(event) => selectCategory(event.target.value as SettingsCategory)}>
              {settingGroups.map((group) => (
                <optgroup key={group.label} label={t(group.label)}>
                  {group.items.map((item) => <option key={item.id} value={item.id}>{t(item.label)}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
        </aside>
        <div ref={contentRef} className={styles.content}>
        <div className={styles.detail}>
          {dirty && <p role="status" className="text-sm" style={{ color: "var(--text-muted)" }}>{t("robin.settings.unsaved")}</p>}
          {error && <div ref={errorRef} role="alert" tabIndex={-1} className={styles.error}>
            <p>{error}</p>
            <button type="button" disabled={busy} onClick={() => { setError(null); void load(); }}>{t("robin.settings.retryLoad")}</button>
          </div>}
          {notice && <p role="status" className={styles.notice}>{notice}</p>}
          {!data && !error && <p role="status" className={styles.notice}>{t("robin.settings.loading")}</p>}

      <section id="privacy" hidden={category !== "privacy"} className={styles.card}>
        <h2>{t("robin.settings.privacyTitle")}</h2>
        <p>{t("robin.settings.storedAt", { path: data?.storedAt ?? "~/.pi/robin/secrets.json" })}</p>
        <p>{t("robin.settings.privacyNote")}</p>
      </section>

      <section id="general" hidden={category !== "general"} className={styles.card}>
        <div>
          <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
            {t("settings.appearance")}
          </h2>
          <p className="text-xs" style={{ color: "var(--text-dim)" }}>
            {t("settings.appearanceDescription")}
          </p>
        </div>
        <ThemePicker />
        <NavigationPlacementSetting />
      </section>

      <section hidden={category !== "general"} className={styles.card}>
        <div>
          <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
            {t("common.language")}
          </h2>
          <p className="text-xs" style={{ color: "var(--text-dim)" }}>
            {t("settings.languageDescription")}
          </p>
        </div>
        <div role="radiogroup" aria-label={t("common.language")} className={styles.languageOptions}>
          {supportedLocales.map((plugin) => {
            const selected = locale === plugin.id;
            return (
              <label key={plugin.id}>
                <input type="radio" name="settings-language" value={plugin.id} checked={selected}
                  onChange={() => setLocale(plugin.id as typeof locale)} className="sr-only" />
                <span>{plugin.label}</span>
              </label>
            );
          })}
        </div>
      </section>

      <section id="voice" hidden={category !== "voice"} className={styles.card}>
        {category === "voice" && <VoiceSettings />}
      </section>

      {/* ---------- Google ---------- */}
      <section id="google" hidden={category !== "google"} className={styles.card}>
        <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
          {t("robin.settings.googleTitle")}
        </h2>

        <div className="flex flex-col gap-1">
          <StatusLine label={t("robin.settings.clientId")} status={data?.google.clientId ?? { set: false }} t={t} />
          <StatusLine
            label={t("robin.settings.clientSecret")}
            status={data?.google.clientSecret ?? { set: false }}
            t={t}
          />
        </div>

        <p className="text-xs" style={{ color: "var(--text-dim)" }}>{t("robin.settings.redirectHint")}</p>
        <code
          className="block overflow-x-auto rounded px-2 py-1 text-xs"
          style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }}
        >
          {data?.googleRedirectUri ?? "…"}
        </code>

        <label className={styles.field}>
          {t("robin.settings.clientId")}
        <input
          value={clientId}
          onChange={(event) => setClientId(event.target.value)}
          placeholder={t("robin.settings.clientId")}
          autoComplete="off"
          spellCheck={false}
          className="rounded px-2 py-1 text-sm outline-none"
          style={inputStyle}
        />
        </label>
        <label className={styles.field}>
          {t("robin.settings.clientSecret")}
        <input
          type="password"
          value={clientSecret}
          onChange={(event) => setClientSecret(event.target.value)}
          placeholder={t("robin.settings.clientSecret")}
          autoComplete="new-password"
          className="rounded px-2 py-1 text-sm outline-none"
          style={inputStyle}
        />
        </label>
        <div className="flex flex-wrap gap-2">
          <SaveButton
            label={t("robin.common.save")}
            phase={saveFeedback?.action === "google" ? saveFeedback.phase : undefined}
            disabled={busy || !clientId.trim() || !clientSecret.trim()}
            onClick={() => void send(
              "POST",
              { section: "google", clientId, clientSecret },
              t("robin.settings.googleSaved"),
              "google",
            ).then((saved) => {
              if (saved) { setClientId(current => current === clientId ? "" : current); setClientSecret(current => current === clientSecret ? "" : current); }
            })}
            t={t}
          />
          <button
            type="button"
            disabled={busy || !data?.google.clientId.set}
            onClick={() => void send("DELETE", { section: "google" }, t("robin.settings.googleCleared"))}
            className="inline-flex min-h-11 items-center rounded px-3 py-1 text-sm disabled:opacity-40"
            style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}
          >
            {t("robin.common.clear")}
          </button>
        </div>
        <p className="text-xs" style={{ color: "var(--text-dim)" }}>{t("robin.settings.googleNext")}</p>
        <p className="text-xs" style={{ color: "var(--text-dim)" }}>{t("robin.settings.googleGmailHint")}</p>

        <div className="mt-2 flex flex-col gap-3 border-t pt-3" style={{ borderColor: "var(--border)" }}>
          <div>
            <h3 className="text-sm font-medium" style={{ color: "var(--text)" }}>
              {t("robin.settings.calendarSourcesTitle")}
            </h3>
            <p className="text-xs" style={{ color: "var(--text-dim)" }}>
              {t("robin.settings.calendarSourcesHint")}
            </p>
          </div>
          <div className="grid gap-2 desktop:grid-cols-[minmax(0,1fr)_minmax(10rem,0.4fr)_auto]">
            <label className={styles.field}>
              {t("robin.settings.calendarUrlPlaceholder")}
            <input
              value={calendarInput}
              onChange={(event) => setCalendarInput(event.target.value)}
              placeholder={t("robin.settings.calendarUrlPlaceholder")}
              spellCheck={false}
              className="min-h-11 rounded px-2 text-sm outline-none"
              style={inputStyle}
            />
            </label>
            <label className={styles.field}>
              {t("robin.settings.calendarNamePlaceholder")}
            <input
              value={calendarLabel}
              onChange={(event) => setCalendarLabel(event.target.value)}
              placeholder={t("robin.settings.calendarNamePlaceholder")}
              className="min-h-11 rounded px-2 text-sm outline-none"
              style={inputStyle}
            />
            </label>
            <button
              type="button"
              disabled={busy || !calendarInput.trim()}
              onClick={() => void send(
                "POST",
                {
                  section: "googleCalendars",
                  action: "add",
                  value: calendarInput,
                  ...(calendarLabel.trim() ? { label: calendarLabel.trim() } : {}),
                },
                t("robin.settings.calendarAdded"),
              ).then((saved) => {
                if (saved) { setCalendarInput(current => current === calendarInput ? "" : current); setCalendarLabel(current => current === calendarLabel ? "" : current); }
              })}
              className="ui-action ui-action--outline pi-bracket min-h-11 px-3 disabled:opacity-40"
              data-state="accent"
            >
              {t("robin.common.add")}
            </button>
          </div>

          {(data?.google.calendars ?? []).length > 0 && (
            <div className="flex flex-col divide-y" style={{ borderColor: "var(--border)" }}>
              {data?.google.calendars.map((calendar) => (
                <div key={calendar.id} className="flex min-h-11 items-center gap-3 py-2">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      checked={calendar.enabled}
                      disabled={busy}
                      onChange={(event) => void send(
                        "POST",
                        {
                          section: "googleCalendars",
                          action: "toggle",
                          id: calendar.id,
                          enabled: event.target.checked,
                        },
                        event.target.checked
                          ? t("robin.settings.calendarEnabled")
                          : t("robin.settings.calendarDisabled"),
                      )}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm" style={{ color: "var(--text)" }}>
                        {calendar.label ?? calendar.id}
                      </span>
                      {calendar.label && (
                        <span className="block truncate font-mono text-xs" style={{ color: "var(--text-dim)" }}>
                          {calendar.id}
                        </span>
                      )}
                    </span>
                  </label>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void send(
                      "POST",
                      { section: "googleCalendars", action: "remove", id: calendar.id },
                      t("robin.settings.calendarRemoved"),
                    )}
                    className="ui-action min-h-11 px-2 text-xs disabled:opacity-40"
                    style={{ color: "var(--danger)" }}
                  >
                    {t("robin.common.remove")}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section id="cold-reach-email" hidden={category !== "cold-reach-email"} className={styles.card}>
        <h2>{t("robin.settings.outreachTitle")}</h2>
        <GoogleConnect account="outreach" showClientConfig onChanged={() => void load()} />
      </section>

      {/* ---------- Notion ---------- */}
      <section id="notion" hidden={category !== "notion"} className={styles.card}>
        <div>
          <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
            {t("robin.settings.notionTitle")}
          </h2>
          <p className="text-xs" style={{ color: "var(--text-dim)" }}>
            {t("robin.settings.notionHint")}
          </p>
        </div>

        <a
          href="https://www.notion.so/my-integrations"
          target="_blank"
          rel="noopener noreferrer"
          className="ui-action self-start text-xs"
          style={{ color: "var(--accent)" }}
        >
          {t("robin.settings.notionCreateIntegration")} ↗
        </a>

        <StatusLine
          label={t("robin.settings.notionToken")}
          status={data?.notion.apiToken ?? { set: false }}
          t={t}
        />

        <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
          {t("robin.settings.notionToken")}
          <input
            type="password"
            value={notionToken}
            onChange={(event) => setNotionToken(event.target.value)}
            placeholder={t("robin.settings.notionTokenPlaceholder")}
            autoComplete="new-password"
            spellCheck={false}
            className="min-h-11 rounded px-2 text-sm outline-none"
            style={inputStyle}
          />
        </label>

        <p className="text-xs" style={{ color: "var(--text-dim)" }}>
          {t("robin.settings.notionShareHint")}
        </p>

        <div className="flex flex-wrap gap-2">
          <SaveButton
            label={t("robin.settings.saveNotion")}
            phase={saveFeedback?.action === "notion" ? saveFeedback.phase : undefined}
            disabled={busy || !notionToken.trim()}
            onClick={() => void send(
              "POST",
              { section: "notion", apiToken: notionToken },
              t("robin.settings.notionSaved"),
              "notion",
            ).then((saved) => {
              if (saved) setNotionToken(current => current === notionToken ? "" : current);
            })}
            t={t}
          />
          <button
            type="button"
            disabled={busy || !data?.notion.apiToken.set}
            onClick={() => void send("DELETE", { section: "notion" }, t("robin.settings.notionCleared"))}
            className="inline-flex min-h-11 items-center rounded px-3 py-1 text-sm disabled:opacity-40"
            style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}
          >
            {t("robin.common.clear")}
          </button>
        </div>
      </section>

      {/* ---------- Playwright Extension ---------- */}
      <section id="playwright" hidden={category !== "playwright"} className={styles.card}>
        <div>
          <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>{t("robin.settings.playwrightTitle")}</h2>
          <p className="text-xs" style={{ color: "var(--text-dim)" }}>{t("robin.settings.playwrightHint")}</p>
        </div>
        <p className="text-xs" style={{ color: data?.playwright.extensionToken.set ? "var(--text-muted)" : "var(--text-dim)" }}>
          {t(data?.playwright?.extensionToken?.set ? "robin.settings.playwrightSet" : "robin.settings.playwrightUnset")}
        </p>
        <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
          {t("robin.settings.playwrightToken")}
          <input
            type="password"
            value={playwrightToken}
            onChange={(event) => setPlaywrightToken(event.target.value)}
            placeholder={t("robin.settings.playwrightPlaceholder")}
            autoComplete="new-password"
            spellCheck={false}
            className="min-h-11 rounded px-2 text-sm outline-none"
            style={inputStyle}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <SaveButton
            label={t("robin.settings.playwrightSave")}
            phase={saveFeedback?.action === "playwright" ? saveFeedback.phase : undefined}
            disabled={busy || !playwrightToken.trim()}
            onClick={() => void send(
              "POST", { section: "playwright", extensionToken: playwrightToken },
              t("robin.settings.playwrightSaved"), "playwright",
            ).then((saved) => { if (saved) setPlaywrightToken(current => current === playwrightToken ? "" : current); })}
            t={t}
          />
          <button
            type="button"
            disabled={busy || !data?.playwright?.extensionToken?.set}
            onClick={() => void send("DELETE", { section: "playwright" }, t("robin.settings.playwrightCleared"))}
            className="inline-flex min-h-11 items-center rounded px-3 py-1 text-sm disabled:opacity-40"
            style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}
          >
            {t("robin.common.clear")}
          </button>
        </div>
        {failedAction === "playwright" && error && <p role="alert" className="text-xs" style={{ color: "var(--danger)" }}>{error}</p>}
      </section>

      {/* ---------- Telegram ---------- */}
      <section id="telegram" hidden={category !== "telegram"} className={styles.card}>
        <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
          {t("robin.settings.telegramTitle")}
        </h2>

        <StatusLine label={t("robin.settings.botToken")} status={data?.telegram.botToken ?? { set: false }} t={t} />

        <label className={styles.field}>
          {t("robin.settings.botToken")}
        <input
          type="password"
          value={botToken}
          onChange={(event) => setBotToken(event.target.value)}
          placeholder={t("robin.settings.botTokenPlaceholder")}
          autoComplete="new-password"
          className="rounded px-2 py-1 text-sm outline-none"
          style={inputStyle}
        />
        </label>
        <SaveButton
          label={t("robin.settings.saveToken")}
          phase={saveFeedback?.action === "token" ? saveFeedback.phase : undefined}
          disabled={busy || !botToken.trim()}
          onClick={() => void send(
            "POST",
            { section: "telegram", botToken },
            t("robin.settings.tokenSaved"),
            "token",
          ).then((saved) => {
            if (saved) setBotToken(current => current === botToken ? "" : current);
          })}
          className="self-start"
          t={t}
        />

        <div className="mt-2 flex flex-col gap-2 border-t pt-3" style={{ borderColor: "var(--border)" }}>
          <p className="text-xs" style={{ color: "var(--text-dim)" }}>{t("robin.settings.chatIdsHint")}</p>
          <label className={styles.field}>
            {t("robin.settings.allowedChats")}
          <input
            value={chatIds}
            disabled={!data}
            onChange={(event) => setChatIds(event.target.value)}
            placeholder={t("robin.settings.chatIdsPlaceholder")}
            className="rounded px-2 py-1 text-sm outline-none"
            style={inputStyle}
          />
          </label>
          <div className="flex flex-wrap gap-2">
            <SaveButton
              label={t("robin.settings.saveChatIds")}
              phase={saveFeedback?.action === "chatIds" ? saveFeedback.phase : undefined}
              disabled={busy}
              onClick={() => void send(
                "POST",
                { section: "telegram", chatIds },
                t("robin.settings.chatIdsSaved"),
                "chatIds",
              )}
              t={t}
            />
            <button
              type="button"
              disabled={busy || !data?.telegram.botToken.set}
              onClick={() => void detect()}
              className="inline-flex min-h-11 items-center rounded px-3 py-1 text-sm disabled:opacity-40"
              style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}
            >
              {t("robin.settings.detect")}
            </button>
          </div>
          <p className="text-xs" style={{ color: "var(--text-dim)" }}>{t("robin.settings.detectHint")}</p>

          {detected && (
            detected.length === 0 ? (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                {t("robin.settings.detectEmpty")}
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                {detected.map((chat) => (
                  <button
                    key={chat.id}
                    type="button"
                    onClick={() => setChatIds((current) => (
                      current.split(",").map((part) => part.trim()).filter(Boolean).includes(String(chat.id))
                        ? current
                        : [current, String(chat.id)].filter(Boolean).join(", ")
                    ))}
                    className="flex items-center gap-2 rounded px-2 py-1 text-left text-xs"
                    style={{ background: "var(--bg-subtle)", color: "var(--text)" }}
                  >
                    <span className="tabular-nums">{chat.id}</span>
                    <span style={{ color: "var(--text-dim)" }}>{chat.name}</span>
                    <span style={{ color: "var(--accent)" }}>{t("robin.settings.addToAllowlist")}</span>
                  </button>
                ))}
              </div>
            )
          )}
        </div>
        <div className="flex flex-wrap gap-2 border-t pt-3" style={{ borderColor: "var(--border)" }}>
          <button
            type="button"
            disabled={busy || !data?.telegram.botToken.set}
            onClick={() => void send("DELETE", { section: "telegram" }, t("robin.settings.telegramCleared"))}
            className="inline-flex min-h-11 items-center rounded px-3 py-1 text-sm disabled:opacity-40"
            style={{ border: "1px solid var(--border)", color: "var(--danger)" }}
          >
            {t("robin.settings.clearTelegram")}
          </button>
        </div>
        <p className="text-xs" style={{ color: "var(--text-dim)" }}>{t("robin.settings.restartBridge")}</p>
      </section>

      <section id="notifications" hidden={category !== "notifications"} className={styles.card}>
        <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>{t("robin.settings.notificationsTitle")}</h2>
        <p id="notification-channel-hint" className="text-xs" style={{ color: "var(--text-muted)" }}>{t("robin.settings.notificationsHint")}</p>
        <label className="flex flex-col gap-1 text-sm" style={{ color: "var(--text)" }}>
          {t("robin.settings.notificationChannel")}
          <select value={notificationChannel} disabled={busy || !data}
            aria-describedby="notification-channel-hint"
            onChange={(event) => setNotificationChannel(event.target.value === "push" ? "push" : "telegram")}
            className="min-h-11 rounded px-2" style={inputStyle}>
            <option value="push">{t("robin.settings.channelPush")}</option>
            <option value="telegram">Telegram</option>
          </select>
        </label>
        <div className="flex flex-wrap gap-2">
          <SaveButton label={t("robin.common.save")} disabled={busy || !data}
            phase={saveFeedback?.action === "notifications" ? saveFeedback.phase : undefined}
            onClick={() => void send("POST", { section: "notifications", channel: notificationChannel },
              t("robin.settings.notificationsSaved"), "notifications")} t={t} />
          <button type="button" disabled={testingPush || busy} onClick={() => void testPush()}
            aria-busy={testingPush} className="ui-action ui-action--outline min-h-11 rounded px-3 py-2 disabled:opacity-40">
            {t(testingPush ? "robin.settings.pushTestSending" : "robin.settings.pushTest")}
          </button>
        </div>
        {pushTestResult && <p role="status" className="text-sm">{pushTestResult}</p>}
        {failedAction === "notifications" && error && <p role="alert" className="text-sm" style={{ color: "var(--danger)" }}>{error}</p>}
        <p className="text-xs" style={{ color: "var(--text-dim)" }}>{t("robin.settings.notificationRuntime")}</p>

        <div className="flex flex-col gap-3 border-t pt-3" style={{ borderColor: "var(--border)" }}>
          <div>
            <h3 className="text-sm font-medium" style={{ color: "var(--text)" }}>
              {t("robin.settings.dailyAgendaTitle")}
            </h3>
            <p className="text-xs" style={{ color: "var(--text-dim)" }}>
              {t("robin.settings.dailyAgendaHint")}
            </p>
          </div>
          {dailyAgenda && (
            <>
              <label className="flex min-h-11 items-center gap-2 text-sm" style={{ color: "var(--text)" }}>
                <input
                  type="checkbox"
                  role="switch"
                  checked={dailyAgenda.enabled}
                  onChange={(event) => setDailyAgenda({ ...dailyAgenda, enabled: event.target.checked })}
                />
                {t("robin.settings.dailyAgendaEnabled")}
              </label>
              <div className="grid gap-3 desktop:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  {t("robin.settings.dailyAgendaTime")}
                  <input
                    type="time"
                    value={dailyAgenda.time}
                    onChange={(event) => setDailyAgenda({ ...dailyAgenda, time: event.target.value })}
                    className="min-h-11 rounded px-2 text-sm"
                    style={inputStyle}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  {t("robin.settings.dailyAgendaLanguage")}
                  <select
                    value={dailyAgenda.locale}
                    onChange={(event) => setDailyAgenda({
                      ...dailyAgenda,
                      locale: event.target.value === "zh" ? "zh" : "en",
                    })}
                    className="min-h-11 rounded px-2 text-sm"
                    style={inputStyle}
                  >
                    <option value="en">English</option>
                    <option value="zh">中文</option>
                  </select>
                </label>
              </div>
              <SaveButton
                label={t("robin.settings.saveDailyAgenda")}
                phase={saveFeedback?.action === "dailyAgenda" ? saveFeedback.phase : undefined}
                disabled={busy || !dailyAgenda.time}
                onClick={() => void send(
                  "POST",
                  { section: "telegram", dailyAgenda },
                  t("robin.settings.dailyAgendaSaved"),
                  "dailyAgenda",
                )}
                className="self-start"
                t={t}
              />
            </>
          )}
        </div>

        <div className="flex flex-col gap-3 border-t pt-3" style={{ borderColor: "var(--border)" }}>
          <div>
            <h3 className="text-sm font-medium" style={{ color: "var(--text)" }}>
              {t("robin.settings.jobDigestTitle")}
            </h3>
            <p className="text-xs" style={{ color: "var(--text-dim)" }}>
              {t("robin.settings.jobDigestHint")}
            </p>
          </div>
          {jobDigest && (
            <>
              <label className="flex min-h-11 items-center gap-2 text-sm" style={{ color: "var(--text)" }}>
                <input
                  type="checkbox"
                  role="switch"
                  checked={jobDigest.enabled}
                  onChange={(event) => setJobDigest({ ...jobDigest, enabled: event.target.checked })}
                />
                {t("robin.settings.jobDigestEnabled")}
              </label>
              <label hidden={notificationChannel === "push"} className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
                {t("robin.settings.jobChatIds")}
                <input
                  value={jobChatIds}
                  onChange={(event) => setJobChatIds(event.target.value)}
                  placeholder={t("robin.settings.jobChatIdsPlaceholder")}
                  spellCheck={false}
                  className="min-h-11 rounded px-2 text-sm"
                  style={inputStyle}
                />
                <span style={{ color: "var(--text-dim)" }}>{t("robin.settings.jobChatIdsHint")}</span>
              </label>
              <div className="grid gap-3 desktop:grid-cols-5">
                <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  {t("robin.settings.jobDigestSweep")}
                  <input
                    type="time"
                    value={jobDigest.sweepAt}
                    onChange={(event) => setJobDigest({ ...jobDigest, sweepAt: event.target.value })}
                    className="min-h-11 rounded px-2 text-sm"
                    style={inputStyle}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  {t("robin.settings.jobDigestMorning")}
                  <input
                    type="time"
                    value={jobDigest.morning}
                    onChange={(event) => setJobDigest({ ...jobDigest, morning: event.target.value })}
                    className="min-h-11 rounded px-2 text-sm"
                    style={inputStyle}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  {t("robin.settings.jobDigestEvening")}
                  <input
                    type="time"
                    value={jobDigest.evening}
                    onChange={(event) => setJobDigest({ ...jobDigest, evening: event.target.value })}
                    className="min-h-11 rounded px-2 text-sm"
                    style={inputStyle}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  {t("robin.settings.jobDigestCount")}
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={jobDigest.count}
                    onChange={(event) => setJobDigest({ ...jobDigest, count: Number(event.target.value) })}
                    className="min-h-11 rounded px-2 text-sm tabular-nums"
                    style={inputStyle}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  {t("robin.settings.dailyAgendaLanguage")}
                  <select
                    value={jobDigest.locale}
                    onChange={(event) => setJobDigest({
                      ...jobDigest,
                      locale: event.target.value === "zh" ? "zh" : "en",
                    })}
                    className="min-h-11 rounded px-2 text-sm"
                    style={inputStyle}
                  >
                    <option value="en">English</option>
                    <option value="zh">中文</option>
                  </select>
                </label>
              </div>
              <SaveButton
                label={t("robin.settings.saveJobDigest")}
                phase={saveFeedback?.action === "jobDigest" ? saveFeedback.phase : undefined}
                disabled={busy || !jobDigest.morning || !jobDigest.evening}
                onClick={() => void send(
                  "POST",
                  { section: "telegram", jobDigest: { ...jobDigest, chatIds: jobChatIds } },
                  t("robin.settings.jobDigestSaved"),
                  "jobDigest",
                )}
                className="self-start"
                t={t}
              />
            </>
          )}
        </div>

        <div className="flex flex-col gap-3 border-t pt-3" style={{ borderColor: "var(--border)" }}>
          <div>
            <h3 className="text-sm font-medium" style={{ color: "var(--text)" }}>
              {t("robin.settings.gmailDigestTitle")}
            </h3>
            <p className="text-xs" style={{ color: "var(--text-dim)" }}>
              {t("robin.settings.gmailDigestHint")}
            </p>
          </div>
          {gmailDigest && (
            <>
              <label className="flex min-h-11 items-center gap-2 text-sm" style={{ color: "var(--text)" }}>
                <input
                  type="checkbox"
                  role="switch"
                  checked={gmailDigest.enabled}
                  onChange={(event) => setGmailDigest({ ...gmailDigest, enabled: event.target.checked })}
                />
                {t("robin.settings.gmailDigestEnabled")}
              </label>
              <label hidden={notificationChannel === "push"} className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
                {t("robin.settings.gmailDigestChatIds")}
                <input
                  value={gmailChatIds}
                  onChange={(event) => setGmailChatIds(event.target.value)}
                  placeholder={t("robin.settings.gmailDigestChatIdsPlaceholder")}
                  spellCheck={false}
                  className="min-h-11 rounded px-2 text-sm"
                  style={inputStyle}
                />
                <span style={{ color: "var(--text-dim)" }}>{t("robin.settings.gmailDigestChatIdsHint")}</span>
              </label>
              <div className="grid gap-3 desktop:grid-cols-3">
                <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  {t("robin.settings.gmailDigestTime")}
                  <input
                    type="time"
                    value={gmailDigest.time}
                    onChange={(event) => setGmailDigest({ ...gmailDigest, time: event.target.value })}
                    className="min-h-11 rounded px-2 text-sm"
                    style={inputStyle}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  {t("robin.settings.dailyAgendaLanguage")}
                  <select
                    value={gmailDigest.locale}
                    onChange={(event) => setGmailDigest({
                      ...gmailDigest,
                      locale: event.target.value === "zh" ? "zh" : "en",
                    })}
                    className="min-h-11 rounded px-2 text-sm"
                    style={inputStyle}
                  >
                    <option value="en">English</option>
                    <option value="zh">中文</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  {t("robin.settings.gmailDigestQuery")}
                  <input
                    value={gmailDigest.query}
                    onChange={(event) => setGmailDigest({ ...gmailDigest, query: event.target.value })}
                    placeholder="newer_than:1d"
                    spellCheck={false}
                    className="min-h-11 rounded px-2 text-sm"
                    style={inputStyle}
                  />
                </label>
              </div>
              <SaveButton
                label={t("robin.settings.saveGmailDigest")}
                phase={saveFeedback?.action === "gmailDigest" ? saveFeedback.phase : undefined}
                disabled={busy || !gmailDigest.time}
                onClick={() => void send(
                  "POST",
                  { section: "telegram", gmailDigest: { ...gmailDigest, chatIds: gmailChatIds } },
                  t("robin.settings.gmailDigestSaved"),
                  "gmailDigest",
                )}
                className="self-start"
                t={t}
              />
            </>
          )}
        </div>

        <div className="flex flex-col gap-3 border-t pt-3" style={{ borderColor: "var(--border)" }}>
          <div>
            <h3 className="text-sm font-medium" style={{ color: "var(--text)" }}>
              {t("robin.settings.remindersTitle")}
            </h3>
            <p className="text-xs" style={{ color: "var(--text-dim)" }}>
              {t("robin.settings.remindersHint")}
            </p>
          </div>
          {reminders && (
            <>
              <label className="flex min-h-11 items-center gap-2 text-sm" style={{ color: "var(--text)" }}>
                <input
                  type="checkbox"
                  role="switch"
                  checked={reminders.enabled}
                  onChange={(event) => setReminders({ ...reminders, enabled: event.target.checked })}
                />
                {t("robin.settings.remindersEnabled")}
              </label>
              <label hidden={notificationChannel === "push"} className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
                {t("robin.settings.remindersChatIds")}
                <input
                  value={reminderChatIds}
                  onChange={(event) => setReminderChatIds(event.target.value)}
                  placeholder={t("robin.settings.gmailDigestChatIdsPlaceholder")}
                  spellCheck={false}
                  className="min-h-11 rounded px-2 text-sm"
                  style={inputStyle}
                />
                <span style={{ color: "var(--text-dim)" }}>{t("robin.settings.gmailDigestChatIdsHint")}</span>
              </label>
              <div className="grid gap-3 desktop:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  {t("robin.settings.remindersLead")}
                  <input
                    type="number"
                    min={5}
                    max={1440}
                    value={reminders.lead}
                    onChange={(event) => setReminders({ ...reminders, lead: Number(event.target.value) })}
                    className="min-h-11 rounded px-2 text-sm"
                    style={inputStyle}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  {t("robin.settings.dailyAgendaLanguage")}
                  <select
                    value={reminders.locale}
                    onChange={(event) => setReminders({
                      ...reminders,
                      locale: event.target.value === "zh" ? "zh" : "en",
                    })}
                    className="min-h-11 rounded px-2 text-sm"
                    style={inputStyle}
                  >
                    <option value="en">English</option>
                    <option value="zh">中文</option>
                  </select>
                </label>
              </div>
              <SaveButton
                label={t("robin.settings.saveReminders")}
                phase={saveFeedback?.action === "reminders" ? saveFeedback.phase : undefined}
                disabled={busy || !Number.isFinite(reminders.lead)}
                onClick={() => void send(
                  "POST",
                  { section: "telegram", reminders: { ...reminders, chatIds: reminderChatIds } },
                  t("robin.settings.remindersSaved"),
                  "reminders",
                )}
                className="self-start"
                t={t}
              />
            </>
          )}
        </div>

      </section>

      <section id="transcription" hidden={category !== "transcription"} className={styles.card}>
        <div className="flex flex-col gap-3">
          <div>
            <h3 className="text-sm font-medium" style={{ color: "var(--text)" }}>
              {t("robin.settings.transcriptionTitle")}
            </h3>
            <p className="text-xs" style={{ color: "var(--text-dim)" }}>
              {t("robin.settings.transcriptionHint")}
            </p>
          </div>
          {transcription && (
            <>
              <label className="flex min-h-11 items-center gap-2 text-sm" style={{ color: "var(--text)" }}>
                <input
                  type="checkbox"
                  role="switch"
                  checked={transcription.enabled}
                  onChange={(event) => setTranscription({ ...transcription, enabled: event.target.checked })}
                />
                {t("robin.settings.transcriptionEnabled")}
              </label>
              <StatusLine
                label={t("robin.settings.transcriptionKey")}
                status={data?.telegram.transcription.apiKey ?? { set: false }}
                t={t}
              />
              <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
                {t("robin.settings.transcriptionKey")}
                <input
                  type="password"
                  value={transcriptionKey}
                  onChange={(event) => setTranscriptionKey(event.target.value)}
                  placeholder={t("robin.settings.transcriptionKeyPlaceholder")}
                  spellCheck={false}
                  autoComplete="new-password"
                  className="min-h-11 rounded px-2 text-sm"
                  style={inputStyle}
                />
                <span style={{ color: "var(--text-dim)" }}>{t("robin.settings.transcriptionKeyHint")}</span>
              </label>
              <div className="grid gap-3 desktop:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  {t("robin.settings.transcriptionBaseUrl")}
                  <input
                    value={transcription.baseUrl}
                    onChange={(event) => setTranscription({ ...transcription, baseUrl: event.target.value })}
                    placeholder="https://api.openai.com/v1"
                    spellCheck={false}
                    className="min-h-11 rounded px-2 text-sm"
                    style={inputStyle}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  {t("robin.settings.transcriptionModel")}
                  <input
                    value={transcription.model}
                    onChange={(event) => setTranscription({ ...transcription, model: event.target.value })}
                    placeholder="whisper-1"
                    spellCheck={false}
                    className="min-h-11 rounded px-2 text-sm"
                    style={inputStyle}
                  />
                </label>
              </div>
              <SaveButton
                label={t("robin.settings.saveTranscription")}
                phase={saveFeedback?.action === "transcription" ? saveFeedback.phase : undefined}
                disabled={busy || !transcription.baseUrl.trim() || !transcription.model.trim()}
                onClick={() => {
                  void send(
                    "POST",
                    {
                      section: "telegram",
                      transcription: {
                        ...transcription,
                        // Omitted rather than sent empty, so saving the model
                        // alone does not wipe a key that is already stored.
                        ...(transcriptionKey.trim() ? { apiKey: transcriptionKey.trim() } : {}),
                      },
                    },
                    t("robin.settings.transcriptionSaved"),
                    "transcription",
                  ).then((saved) => { if (saved) setTranscriptionKey(current => current === transcriptionKey ? "" : current); });
                }}
                className="self-start"
                t={t}
              />
            </>
          )}
        </div>

      </section>
        </div>
        </div>
      </main>
    </div>
  );
}
