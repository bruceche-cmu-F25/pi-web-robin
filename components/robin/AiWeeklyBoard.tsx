"use client";

import { useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { useI18n } from "@/hooks/useI18n";
import { weeklyStoryId, type WeeklyPreferences, type WeeklyView } from "@/extension/robin/ai-weekly";
import { mutate, usePolledResource } from "./usePolledResource";
import styles from "./AiWeeklyBoard.module.css";

const API = "/api/robin/ai-weekly";

export function AiWeeklyBoard() {
  const { t, locale } = useI18n();
  const search = useSearchParams();
  const [week, setWeek] = useState(search.get("week") ?? "");
  const [selected, setSelected] = useState(search.get("day") ?? "");
  const resource = usePolledResource<WeeklyView>(`${API}${week ? `?week=${encodeURIComponent(week)}` : ""}`, 10_000);
  const { data, loading, error, refresh } = resource;
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [actionError, setActionError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const storyHeading = useRef<HTMLHeadingElement>(null);
  const evidence = useRef<HTMLDetailsElement>(null);
  const [feedback, setFeedback] = useState("");
  const chooseDay = (date: string, focus = false) => {
    setSelected(date); setFeedback("");
    if (focus) requestAnimationFrame(() => {
      storyHeading.current?.focus({ preventScroll: true });
      storyHeading.current?.scrollIntoView({ block: "start" });
    });
  };
  const showEvidence = () => {
    if (!evidence.current) return;
    evidence.current.open = true;
    const summary = evidence.current.querySelector("summary");
    summary?.focus({ preventScroll: true });
    summary?.scrollIntoView({ block: "nearest" });
  };
  const edition = data?.edition;
  const slot = edition?.slots.find((s) => s.date === selected)
    ?? edition?.slots.find((s) => s.date === data?.today) ?? edition?.slots[0];
  const story = slot?.story;
  const isRead = Boolean(edition && slot && data?.read.includes(weeklyStoryId(edition, slot)));
  const dayLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString(locale, { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
  const timestamp = (iso: string) => new Date(iso).toLocaleString(locale, { timeZone: data?.preferences.timezone });
  const act = async (method: string, body: unknown) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setActionError("");
    try { await mutate(API, method, body); await refresh();
      if (method === "PATCH" && (body as { action?: string }).action === "read") setFeedback(t((body as { read: boolean }).read ? "weekly.readSaved" : "weekly.unreadSaved"));
    }
    catch (error) { setActionError(error instanceof Error ? error.message : String(error)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const hasCurrent = data?.archive.some((e) => e.week === data.week);
  const position = edition?.slots.findIndex((s) => s.date === slot?.date) ?? -1;
  const available = edition?.slots.filter((s) => s.story) ?? [];
  const readCount = edition ? available.filter((s) => data?.read.includes(weeklyStoryId(edition, s))).length : 0;
  const sourceHost = story ? new URL(story.source.url).hostname.replace(/^www\./, "") : "";

  return <main className={`robin-dashboard ${styles.page}`}>
    <div className={styles.content}>
      <header className={styles.header}>
        <div><p className="pi-eyebrow">{t("weekly.title")}</p><h1>{t("weekly.subtitle")}</h1><p>{t("weekly.intro")}</p></div>
        <button ref={settingsTrigger} className="ui-action pi-bracket" type="button" onClick={() => setSettingsOpen(!settingsOpen)} aria-expanded={settingsOpen}>{t("weekly.settings")}</button>
      </header>
      {settingsOpen && data && <WeeklySettings preferences={data.preferences} telegramReady={data.telegramReady} onSaved={refresh} onClose={() => { setSettingsOpen(false); settingsTrigger.current?.focus(); }} />}
      <div className={styles.toolbar}>
        <label>{t("weekly.edition")} <select value={week} disabled={busy} onChange={(event) => { setWeek(event.target.value); setSelected(""); setFeedback(""); }}>
          <option value="">{t("weekly.thisWeek")}</option>
          {(data?.archive ?? []).map((e) => <option key={e.week} value={e.week}>{e.week}</option>)}
        </select></label>
        <span className={styles.meta}>{t(data?.preferences.enabled ? "weekly.automationOn" : "weekly.automationOff")}</span>
        <button type="button" className="ui-action pi-bracket" onClick={() => void refresh()}>{t("weekly.refresh")}</button>
        {(!hasCurrent || data?.running) && <button type="button" className="ui-action pi-bracket" disabled={busy || !data || data.running} onClick={() => void act("POST", { action: "generate" })}>
          {t(data?.run?.stage === "failed" || data?.interrupted ? "weekly.retry" : "weekly.generate")}
        </button>}
      </div>
      {(error || actionError) && <p role="alert" className={styles.error}>{error || actionError}</p>}
      {loading && !data && <p role="status">{t("weekly.loading")}</p>}
      {data?.running && <p role="status" className={styles.notice}>{t(`weekly.stage.${data.run?.stage ?? "harvest"}`)} · {t("weekly.busy")}</p>}
      {data?.interrupted && <p role="alert" className={styles.error}>{t("weekly.interrupted")}</p>}
      {data?.run?.stage === "failed" && <div role="alert" className={styles.error}>
        <p>{t("weekly.stage.failed")}: {data.run.error}</p>
        {data.preferences.enabled && data.run.retryAt && <p>{t("weekly.retryAt")} {timestamp(data.run.retryAt)}. {t("weekly.runLimit")}</p>}
      </div>}
      {data && !edition && <section className={styles.empty}>
        <h2>{t("weekly.empty")}</h2><p>{t("weekly.emptyHint")}</p>
      </section>}
      {edition && slot && <>
        <section className={styles.overview}>
          <div><p className={styles.meta}>{t("weekly.coverage")} · {edition.from} — {edition.through}</p>
            <h2>{edition.headline}</h2></div>
          <div className={styles.legend}>
            <span data-lane="practical">{t("weekly.practical")} · {available.filter((s) => s.lane === "practical").length}</span>
            <span data-lane="world">{t("weekly.world")} · {available.filter((s) => s.lane === "world").length}</span>
            <span>{t("weekly.readProgress", { read: readCount, total: available.length })}</span>
          </div>
        </section>
        <div className={styles.reading}>
          <nav className={styles.days} aria-label={t("weekly.day")}>
            {edition.slots.map((day, index) => {
              const read = data?.read.includes(weeklyStoryId(edition, day));
              return <button type="button" key={day.date} aria-pressed={day.date === slot.date} disabled={busy}
                data-lane={day.lane} data-today={day.date === data?.today} data-empty={!day.story} data-read={read}
                aria-label={`${dayLabel(day.date)} · ${t(`weekly.${day.lane}`)} · ${day.story?.title ?? t("weekly.gap")}${read ? ` · ${t("weekly.readDone")}` : ""}`}
                className={styles.day} onClick={() => chooseDay(day.date, window.matchMedia("(max-width: 760px)").matches)}>
                <span className={styles.dayNumber} aria-hidden="true">{read ? "✓" : String(index + 1).padStart(2, "0")}</span>
                <span className={styles.shortDay} aria-hidden="true">{t(`weekly.${day.lane}`)}</span>
                <span className={styles.dayCopy}><span className={styles.meta}>{dayLabel(day.date)} · {t(`weekly.${day.lane}`)}</span>
                  <strong>{day.story?.title ?? t("weekly.emptyDay")}</strong>
                  {day.date === data?.today && <span className={styles.today}>{t("weekly.today")}</span>}
                  {read && <span className={styles.readLabel}>{t("weekly.readDone")}</span>}
                </span>
              </button>;
            })}
          </nav>
          <article key={`${edition.week}:${slot.date}`} className={styles.article} data-lane={slot.lane} aria-labelledby="weekly-story-title">
            <div className={styles.articleTop}>
              <div className={styles.articleMeta}><span className={styles.laneBadge}>{t(`weekly.${slot.lane}`)}</span>
                <span className={styles.meta}>{dayLabel(slot.date)}{slot.date > (data?.today ?? "") ? ` · ${t("weekly.preview")}` : ""}</span></div>
              {edition.week === data?.week && slot.date !== data.today && <button type="button" className="ui-action" disabled={busy} onClick={() => chooseDay(data.today, true)}>{t("weekly.backToday")}</button>}
            </div>
            {!story ? <div className={styles.quietDay}><LaneIcon lane={slot.lane} /><h2 ref={storyHeading} tabIndex={-1} id="weekly-story-title">{t("weekly.gap")}</h2></div> : <>
              <h2 ref={storyHeading} tabIndex={-1} id="weekly-story-title">{story.title}</h2>
              <div className={styles.sourceLine}>
                <span className={styles.release}>{t(`weekly.${story.status}`)}</span>
                <button type="button" onClick={showEvidence} aria-label={t("weekly.citation")} className={styles.sourceChip}>[1] {sourceHost}</button>
                <a href={story.source.url} target="_blank" rel="noopener noreferrer">{t("weekly.openOriginal")} ↗</a>
              </div>
              <WeeklyIllustration week={edition.week} date={slot.date} eventDate={story.eventDate} sourceTitle={story.source.title} sourceUrl={story.source.url} lane={slot.lane} />
              {(["what", "why", "action", "caveat"] as const).map((section, index) => <section key={section} className={styles.section} data-section={section}>
                <h3><span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>{t(`weekly.${section}`)}{section === "why" && <small>{t("weekly.interpretation")}</small>}</h3>
                <p>{story[section]}{section === "what" && <button type="button" className={styles.citation} onClick={showEvidence} aria-label={t("weekly.citation")}>[1]</button>}</p>
              </section>)}
              <details ref={evidence} id="weekly-evidence" className={`${styles.details} ${styles.evidence}`}>
                <summary>{t("weekly.evidence")} <span className={styles.meta}>[1] · {sourceHost}</span></summary>
                <a href={story.source.url} target="_blank" rel="noopener noreferrer">{story.source.title} ↗</a>
                <p className={styles.meta}>{t("weekly.published")} {story.source.publishedOn} · {t("weekly.checkedAt")} {timestamp(story.source.checkedAt)}</p>
                <blockquote><span className={styles.quoteMark} aria-hidden="true">“</span>{story.source.quote}</blockquote>
                <p className={styles.meta}>{t("weekly.checked")}</p>
              </details>
              <p className={styles.aiNote}>{t("weekly.aiNote")}</p>
            </>}
            <footer className={styles.readingActions}>
              <button type="button" className="ui-action" disabled={busy || position <= 0} onClick={() => chooseDay(edition.slots[position - 1]!.date, true)}>← {t("weekly.previous")}</button>
              {story && <button type="button" className={`ui-action ${styles.readButton}`} aria-pressed={isRead} disabled={busy} onClick={() => void act("PATCH", { action: "read", week: edition.week, date: slot.date, read: !isRead })}>{isRead ? "✓ " : ""}{t(isRead ? "weekly.unread" : "weekly.read")}</button>}
              <button type="button" className="ui-action" disabled={busy || position >= edition.slots.length - 1} onClick={() => chooseDay(edition.slots[position + 1]!.date, true)}>{t("weekly.next")} →</button>
            </footer>
            <p role="status" className={styles.readFeedback}>{feedback}</p>
          </article>
        </div>
        {edition.ignored.length > 0 && <details className={styles.details}><summary>{t("weekly.ignored")}</summary><ul>{edition.ignored.map((line, i) => <li key={i}>{line}</li>)}</ul></details>}
        {edition.gaps.length > 0 && <details className={styles.details}><summary>{t("weekly.gaps")} · {edition.gaps.length}</summary><ul>{edition.gaps.map((line, i) => <li key={i}>{line}</li>)}</ul></details>}
      </>}
      {data && <details className={styles.details}>
        <summary>{t("weekly.history")}</summary>
        {!data.run ? <p>{t("weekly.noRun")}</p> : <>
          <p>{data.run.week} · {t(`weekly.stage.${data.run.stage}`)} · {timestamp(data.run.startedAt)}</p>
          <p>{t("weekly.counts", { candidates: data.run.candidates ?? 0, verified: data.run.verified ?? 0 })}</p>
          {data.run.sessions.map((id, index) => <p key={id}><a href={`/?session=${encodeURIComponent(id)}`} target="_blank" rel="noopener noreferrer">{t("weekly.session")} {index + 1} ↗</a></p>)}
        </>}
        {data.deliveries.map((d) => <p key={d.key}>{d.date} · {t(`weekly.delivery.${d.status}`)}{d.error ? ` · ${d.error}` : ""}</p>)}
        <p className={styles.meta}>{t("weekly.scheduleHint")}</p><p className={styles.meta}>{t("weekly.deliveryHint")}</p>
      </details>}
    </div>
  </main>;
}

function LaneIcon({ lane }: { lane: "practical" | "world" }) {
  return <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" focusable="false">
    {lane === "practical" ? <><rect x="7" y="13" width="50" height="38" rx="2" /><path d="M7 22h50M15 17.5h2m4 0h2m4 0h2M24 30l-7 6 7 6m16-12 7 6-7 6m-5-14-6 17" /></>
      : <><circle cx="32" cy="32" r="24" /><ellipse cx="32" cy="32" rx="11" ry="24" /><path d="M8 32h48M12 19h40M12 45h40" /></>}
  </svg>;
}

function WeeklyIllustration({ week, date, eventDate, sourceTitle, sourceUrl, lane }: {
  week: string; date: string; eventDate: string; sourceTitle: string; sourceUrl: string; lane: "practical" | "world";
}) {
  const { t } = useI18n();
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const imageUrl = `${API}/image?week=${encodeURIComponent(week)}&day=${encodeURIComponent(date)}`;
  return <figure className={styles.illustration}>
    <div className={styles.imageFrame}>
      {!loaded && <div className={styles.imageFallback}>
        <LaneIcon lane={lane} />
        <div><span className="pi-eyebrow">{new URL(sourceUrl).hostname.replace(/^www\./, "")}</span>
          <div className={styles.dateDiagram}>
            <span><small>{t("weekly.eventDate")}</small><strong>{eventDate}</strong></span>
            <span aria-hidden="true">→</span>
            <span><small>{t("weekly.day")}</small><strong>{date}</strong></span>
          </div>
        </div>
      </div>}
      {!failed && <a href={imageUrl} target="_blank" rel="noopener noreferrer" aria-label={t("weekly.enlargeImage")} className={styles.imageLink} data-loaded={loaded} aria-hidden={!loaded} tabIndex={loaded ? 0 : -1}>
        {/* eslint-disable-next-line @next/next/no-img-element -- Bounded same-origin source preview, no third-party optimizer or browser tracking. */}
        <img src={imageUrl} alt={t("weekly.imageAlt", { title: sourceTitle })} width={1200} height={630} loading="lazy" decoding="async" referrerPolicy="no-referrer" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />
        {loaded && <span className={styles.enlarge}>{t("weekly.enlargeImage")} ↗</span>}
      </a>}
    </div>
    <figcaption>{loaded ? <>{t("weekly.sourceImage")} · <a href={sourceUrl} target="_blank" rel="noopener noreferrer">{sourceTitle} ↗</a></>
      : t(failed ? "weekly.imageFallback" : "weekly.imageLoading")}</figcaption>
  </figure>;
}

function WeeklySettings({ preferences, telegramReady, onSaved, onClose }: {
  preferences: WeeklyPreferences; telegramReady: boolean; onSaved: () => Promise<void>; onClose: () => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(preferences);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(""); setSaved(false);
    try { await mutate(API, "PATCH", { action: "preferences", preferences: draft }); await onSaved(); setSaved(true); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <form className={styles.settings} onSubmit={save}>
    <label htmlFor="weekly-interests">{t("weekly.interests")}</label>
    <textarea id="weekly-interests" rows={3} maxLength={2000} required value={draft.interests} onChange={(e) => { setSaved(false); setDraft({ ...draft, interests: e.target.value }); }} />
    <div className={styles.toolbar}>
      <label>{t("weekly.timezone")}<input required value={draft.timezone} onChange={(e) => { setSaved(false); setDraft({ ...draft, timezone: e.target.value }); }} /></label>
      <label>{t("weekly.at")}<input type="time" required value={draft.at} onChange={(e) => { setSaved(false); setDraft({ ...draft, at: e.target.value }); }} /></label>
    </div>
    <label className={styles.check}><input type="checkbox" checked={draft.enabled} onChange={(e) => { setSaved(false); setDraft({ ...draft, enabled: e.target.checked }); }} />{t("weekly.enabled")}</label>
    <label className={styles.check}><input type="checkbox" disabled={!telegramReady} checked={draft.telegram} onChange={(e) => { setSaved(false); setDraft({ ...draft, telegram: e.target.checked }); }} />{t("weekly.telegram")}</label>
    {!telegramReady && <a href="/dashboard/settings">{t("weekly.telegramSetup")}</a>}
    <p className={styles.meta}>{t("weekly.scheduleHint")}</p><p className={styles.meta}>{t("weekly.deliveryHint")}</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {saved && <p role="status">{t("weekly.saved")}</p>}
    <div className={styles.toolbar}><button type="submit" className="ui-action pi-bracket" disabled={busy}>{t("weekly.save")}</button><button type="button" className="ui-action" onClick={onClose} disabled={busy}>{t("weekly.cancel")}</button></div>
  </form>;
}
