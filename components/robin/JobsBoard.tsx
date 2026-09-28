"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  DEFAULT_JOB_PROFILE,
  JOB_STATUSES,
  appliedJobs,
  roleKey,
  type Job,
  type JobProfile,
  type JobStatus,
} from "@/extension/robin/jobs";
import { JobFilterDialog, type FilterCatalogue } from "./JobFilterDialog";
import { JobLinks } from "./JobLinks";
import { JobRow } from "./JobRow";
import rowStyles from "./JobRow.module.css";
import type { JobsResponse } from "./JobsPanel";
import { RoundsSection } from "./RoundsSection";
import { mutate, usePolledResource } from "./usePolledResource";
import sheet from "./Worksheet.module.css";

interface SweepState {
  running: boolean;
  boardsTotal: number;
  boardsDone: number;
  unreachable: number;
  /** Known-dead boards the sweep skipped without a request. */
  parked?: number;
  scanned: number;
  matched: number;
  added: number;
  finishedAt: string | null;
  error: string | null;
  directories: { id: string; label: string; status: string; boards: number; matched: number }[];
}

interface ScoringState {
  running: boolean;
  round: number;
  totalRounds: number;
  startedWith: number;
  remaining: number;
  model: string | null;
  fallbackFrom?: string;
  finishedAt: string | null;
  error: string | null;
}

interface ProfileResponse extends FilterCatalogue {
  profile: JobProfile;
}

type Filter = JobStatus | "all";

/** Rows rendered per step. "New" alone runs to hundreds, and all of them at once is a slow page. */
const PAGE_SIZE = 50;

function Section({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="pi-card flex flex-col gap-3 p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="pi-label">{title}</h2>
        {actions}
      </header>
      {children}
    </section>
  );
}

/** The viewer's calendar day for an instant, as YYYY-MM-DD. */
function localDay(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-CA");
}

/** Put `values` in bold where a translated string carries \u0001<index> markers. */
function rich(text: string, values: string[]): React.ReactNode[] {
  return text.split(/\u0001(\d)/).map((part, index) =>
    index % 2 === 1 ? <b key={index}>{values[Number(part)]}</b> : part);
}

function ProgressBar({ done, total, label }: { done: number; total: number; label: string }) {
  return (
    <div
      className="h-1.5 w-full overflow-hidden"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total || 1}
      aria-valuenow={done}
      aria-label={label}
      style={{ background: "var(--bg-subtle)", border: "1px solid var(--border)" }}
    >
      <div
        style={{
          width: `${Math.min(100, (done / Math.max(total, 1)) * 100)}%`,
          height: "100%",
          background: "var(--accent)",
          transition: "width 0.4s linear",
        }}
      />
    </div>
  );
}

/** A finished run as dotted-leader rows: label, leader, figure (Worksheet's margin idiom). */
function Leaders({ rows }: { rows: [label: string, value: string, accent?: boolean][] }) {
  return (
    <dl className={sheet.leaders} style={{ marginTop: 0 }}>
      {rows.map(([label, value, accent]) => (
        <div key={label} data-accent={accent ? "true" : undefined}>
          <dt>{label}</dt>
          <span className={sheet.leader} aria-hidden />
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** First few entries, then a count — the bar summarises, the dialog details. */
function summarise(values: string[], limit: number): string {
  if (values.length === 0) return "—";
  const head = values.slice(0, limit).join(" · ");
  return values.length > limit ? `${head} +${values.length - limit}` : head;
}

/**
 * The job-hunt workspace: the sites you open, what came back, and one button
 * to the filter behind it all.
 *
 * The filter is a dialog rather than a form down the page because the two have
 * opposite rhythms — you read the discoveries daily and touch the keywords
 * monthly, so an inline form spends every day pushing the thing you came for
 * below the fold.
 */
export function JobsBoard() {
  const { t, locale } = useI18n();
  const when = (iso: string) => new Date(iso).toLocaleString(locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const number = (value: number) => value.toLocaleString(locale);
  const dayLabel = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(locale, { weekday: "long", month: "long", day: "numeric" });
  const { data, error, refresh } = usePolledResource<JobsResponse>("/api/robin/jobs", 30000);

  const [profile, setProfile] = useState<JobProfile | null>(null);
  const [catalogue, setCatalogue] = useState<FilterCatalogue | null>(null);
  const [editing, setEditing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [busyJob, setBusyJob] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("new");
  const [shown, setShown] = useState(PAGE_SIZE);
  const [preview, setPreview] = useState<string | null>(null);
  const [sweeping, setSweeping] = useState(false);
  /** In "New", rows below the push floor stay folded until asked for. */
  const [showBelow, setShowBelow] = useState(false);
  /**
   * The last reversible action, offered back for ten seconds. `commit` is the
   * half that has not happened yet — a delete waits here rather than running,
   * because a deleted row cannot be put back — and it runs when the offer
   * lapses or is replaced by the next one.
   */
  const [undo, setUndo] = useState<{ message: string; run: () => Promise<void>; commit?: () => Promise<void> } | null>(null);
  const undoRef = useRef(undo);
  /** Rows deleted on screen whose DELETE is still waiting out its undo window. */
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  /** Keyboard cursor over the visible cards; null until a key is used, so nothing is highlighted by default. */
  const [cursor, setCursor] = useState<number | null>(null);

  // Polled fast only while a sweep is live — it is a progress bar, and at rest
  // it is one stale line nobody is watching.
  const sweep = usePolledResource<{ sweep: SweepState | null }>("/api/robin/jobs/sweep", 4000);
  const sweepState = sweep.data?.sweep ?? null;

  const scoring = usePolledResource<{ scoring: ScoringState | null; pending: number; model: string | null }>(
    "/api/robin/jobs/score",
    4000,
  );
  const scoringState = scoring.data?.scoring ?? null;
  const pendingCount = scoring.data?.pending ?? 0;

  const loadProfile = useCallback(async () => {
    try {
      const response = await fetch("/api/robin/jobs/profile");
      const body = await response.json().catch(() => null) as (ProfileResponse & { error?: string }) | null;
      if (!response.ok) throw new Error(body?.error ?? `Request failed (${response.status})`);
      if (!body) return;
      setProfile(body.profile);
      setCatalogue({
        providers: body.providers,
        presets: body.presets,
        starterCompanies: body.starterCompanies ?? [],
      });
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const saveProfile = async (next: JobProfile) => {
    const response = await fetch("/api/robin/jobs/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
    const body = await response.json().catch(() => null) as (ProfileResponse & { error?: string }) | null;
    if (!response.ok) throw new Error(body?.error ?? `Save failed (${response.status})`);
    if (body?.profile) setProfile(body.profile);
    setNotice(t("robin.jobs.saved"));
    await refresh();
  };

  const scan = async () => {
    setScanning(true);
    setActionError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/robin/jobs/scan", { method: "POST" });
      const body = await response.json().catch(() => null) as
        {
          scan?: {
            scanned: number;
            matched: number;
            added: number;
            sources: { name: string; error?: string }[];
          };
          error?: string;
        } | null;
      if (!response.ok) throw new Error(body?.error ?? `Scan failed (${response.status})`);
      await refresh();
      if (body?.scan) {
        const failed = body.scan.sources.filter((source) => source.error);
        // A scan with no sources finishes in milliseconds and reports zero of
        // everything, which reads exactly like "nothing new today". Say which
        // one it was, or the empty result looks like a broken scanner.
        setNotice(body.scan.sources.length === 0
          ? t("robin.jobs.scanNoSources")
          : t("robin.jobs.scanDone", {
            scanned: String(body.scan.scanned),
            matched: String(body.scan.matched),
            added: String(body.scan.added),
          }));
        // A board that 404s is the single most likely reason a scan came back
        // thin, and it is invisible unless the page says so.
        if (failed.length > 0) {
          setActionError(t("robin.jobs.scanFailures", {
            detail: failed.map((source) => `${source.name}: ${source.error}`).join(" · "),
          }));
        }
      }
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setScanning(false);
    }
  };

  /**
   * Start the reverse sweep. It returns immediately — the run outlives the
   * request, and the progress line below is how you watch it.
   */
  const startSweep = async () => {
    setSweeping(true);
    setActionError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/robin/jobs/sweep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume: true }),
      });
      const body = await response.json().catch(() => null) as
        { started?: boolean; reason?: string; error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? `Sweep failed (${response.status})`);
      setNotice(body?.started ? t("robin.jobs.sweepStarted") : t("robin.jobs.sweepAlreadyRunning"));
      await sweep.refresh();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSweeping(false);
    }
  };

  /** Score the backlog. Returns at once; the bar below is how you watch it. */
  const startScoring = async () => {
    setActionError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/robin/jobs/score", { method: "POST" });
      const body = await response.json().catch(() => null) as
        { started?: boolean; reason?: string; error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? `Scoring failed (${response.status})`);
      setNotice(body?.started
        ? t("robin.jobs.scoringStarted")
        : body?.reason === "nothing-pending"
          ? t("robin.jobs.scoringNothing")
          : t("robin.jobs.scoringAlreadyRunning"));
      await scoring.refresh();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  /** Shows what the next push would carry without consuming the queue. */
  const previewDigest = async () => {
    setActionError(null);
    try {
      const response = await fetch("/api/robin/jobs/digest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preview: true, locale: locale.startsWith("zh") ? "zh" : "en" }),
      });
      const body = await response.json().catch(() => null) as { text?: string; error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? `Request failed (${response.status})`);
      setPreview(body?.text ?? "");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const act = async (id: string, action: () => Promise<void>) => {
    setBusyJob(id);
    setActionError(null);
    try {
      await action();
      await refresh();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusyJob(null);
    }
  };

  // Memoised so the identity is stable: `data?.jobs ?? []` would hand the
  // counts a fresh array on every render and re-tally the whole list each time.
  const jobs = useMemo(() => data?.jobs ?? [], [data]);
  const counts = useMemo(() => {
    const tally = new Map<Filter, number>([["all", jobs.length]]);
    for (const status of JOB_STATUSES) {
      tally.set(status, jobs.filter((job) => job.status === status).length);
    }
    return tally;
  }, [jobs]);
  // The applied list is a log, not a ranking: you browse it by when you sent
  // things, and the score that got it there stopped mattering the moment you did.
  const visible = useMemo(() => {
    const shown = jobs.filter((job) => !hidden.has(job.id));
    return filter === "all"
      ? shown
      : filter === "applied"
        ? appliedJobs(shown)
        : shown.filter((job) => job.status === filter);
  }, [jobs, filter, hidden]);

  // "New" runs to a thousand rows, three quarters of them under 3: the few
  // worth a look were buried. Below-floor rows fold into one line that can be
  // opened or cleared in bulk. Unscored rows are not "below" — they are unknown.
  const minScore = data?.minScore ?? DEFAULT_JOB_PROFILE.minScore;
  const { below, listed } = useMemo(() => {
    const isBelow = (job: Job) => typeof job.score === "number" && job.score < minScore;
    const low = filter === "new" ? visible.filter(isBelow) : [];
    return { below: low, listed: low.length > 0 && !showBelow ? visible.filter((job) => !isBelow(job)) : visible };
  }, [visible, filter, minScore, showBelow]);

  // One card per role. The same opening arrives as a repost under a new
  // requisition and again through BuiltIn's mirror; showing each as its own
  // card made one MintMCP role three rows. The best-ranked copy leads, the
  // others ride along as links, and a status change applies to all of them.
  //
  // "New" and "Shortlist" then read as dated sections, newest day first and
  // best score inside a day: most of the list sits at 3.9, so score order alone
  // was one undivided wall, and what you come back for is what arrived since.
  // Below-floor rows, when opened, follow undated.
  const groups = useMemo(() => {
    const byRole = new Map<string, { job: Job; also: Job[]; day?: string }>();
    for (const job of listed) {
      const key = roleKey(job);
      const group = byRole.get(key);
      if (group) group.also.push(job);
      else byRole.set(key, { job, also: [] });
    }
    const all = [...byRole.values()];
    if (filter !== "new" && filter !== "shortlist") return all;
    const isBelow = (job: Job) => typeof job.score === "number" && job.score < minScore;
    const dated = all
      .filter((group) => !isBelow(group.job))
      .map((group) => ({ ...group, day: localDay(group.job.discoveredAt) }))
      .sort((a, b) => b.day.localeCompare(a.day) || (b.job.score ?? -1) - (a.job.score ?? -1));
    return [...dated, ...all.filter((group) => isBelow(group.job))];
  }, [listed, filter, minScore]);
  const datedCount = groups.filter((group) => group.day !== undefined).length;
  const dayCounts = useMemo(() => {
    const tally = new Map<string, number>();
    for (const group of groups) if (group.day) tally.set(group.day, (tally.get(group.day) ?? 0) + 1);
    return tally;
  }, [groups]);

  // The page's lede, independent of the tab: what today brought and what waits.
  const lede = useMemo(() => {
    const today = localDay(new Date().toISOString());
    const roles = new Map<string, Job>();
    let lastPush = "";
    for (const job of jobs) {
      if (job.notifiedAt && job.notifiedAt > lastPush) lastPush = job.notifiedAt;
      if (job.status !== "new" || typeof job.score !== "number" || job.score < minScore) continue;
      if (!roles.has(roleKey(job))) roles.set(roleKey(job), job);
    }
    const waiting = [...roles.values()];
    return {
      today: waiting.filter((job) => localDay(job.discoveredAt) === today).length,
      waiting: waiting.length,
      lastPush,
    };
  }, [jobs, minScore]);

  const fail = (caught: unknown) => setActionError(caught instanceof Error ? caught.message : String(caught));

  /** Offer an undo, first settling whatever the previous offer still owed. */
  const offerUndo = useCallback((next: NonNullable<typeof undo> | null) => {
    const previous = undoRef.current;
    undoRef.current = next;
    setUndo(next);
    previous?.commit?.().catch((caught: unknown) =>
      setActionError(caught instanceof Error ? caught.message : String(caught)));
  }, []);

  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => offerUndo(null), 10_000);
    return () => clearTimeout(timer);
  }, [undo, offerUndo]);

  // Leaving the page settles a pending delete rather than silently keeping the row.
  useEffect(() => () => { undoRef.current?.commit?.().catch(() => {}); }, []);

  const takeUndo = () => {
    const current = undoRef.current;
    if (!current) return;
    undoRef.current = null;
    setUndo(null);
    current.run().catch(fail);
  };

  const label = (job: Job) => `${job.company} — ${job.title}`;

  /** Change a card's status (and its duplicates'), with an undo back to where each was. */
  const changeStatus = (job: Job, also: Job[], status: JobStatus) => void act(job.id, async () => {
    const rows = [job, ...also];
    await setStatuses(rows.map((row) => row.id), status);
    const before = new Map<JobStatus, string[]>();
    for (const row of rows) before.set(row.status, [...(before.get(row.status) ?? []), row.id]);
    offerUndo({
      message: t("robin.jobs.statusChanged", { job: label(job), status: t(`robin.jobs.status.${status}`) }),
      run: async () => {
        for (const [previous, ids] of before) await setStatuses(ids, previous);
        await refresh();
      },
    });
  });

  /** Hide now, delete when the undo window closes. */
  const removeJob = (job: Job) => {
    setHidden((current) => new Set(current).add(job.id));
    const unhide = () => setHidden((current) => {
      const next = new Set(current);
      next.delete(job.id);
      return next;
    });
    offerUndo({
      message: t("robin.jobs.deleted", { job: label(job) }),
      run: async () => unhide(),
      commit: async () => {
        await mutate("/api/robin/jobs", "DELETE", { id: job.id });
        await refresh();
        unhide();
      },
    });
  };

  const setStatuses = (ids: string[], status: JobStatus) =>
    mutate("/api/robin/jobs", "POST", { ids, status });

  /** Drop every row below the floor, with an undo that puts exactly those back. */
  const dropBelow = async () => {
    const ids = below.map((job) => job.id);
    if (ids.length === 0) return;
    setActionError(null);
    try {
      await setStatuses(ids, "dropped");
      await refresh();
      setShowBelow(false);
      offerUndo({
        message: t("robin.jobs.bulkDropped", { count: String(ids.length) }),
        run: async () => { await setStatuses(ids, "new"); await refresh(); },
      });
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  // Triage from the keyboard: a thousand rows is a lot of mouse travel.
  const onScreen = Math.min(groups.length, shown);
  const activeIndex = cursor === null || onScreen === 0 ? null : Math.min(cursor, onScreen - 1);
  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => {});
  keyHandler.current = (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey || editing) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(?:INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    const current = activeIndex === null ? null : groups[activeIndex];
    switch (event.key) {
      case "j":
        setCursor(activeIndex === null ? 0 : Math.min(activeIndex + 1, onScreen - 1));
        break;
      case "k":
        setCursor(activeIndex === null ? 0 : Math.max(activeIndex - 1, 0));
        break;
      case "o":
        if (!current) return;
        window.open(current.job.url, "_blank", "noopener,noreferrer");
        break;
      case "s":
      case "a":
      case "d": {
        if (!current) return;
        const status: JobStatus = event.key === "s" ? "shortlist" : event.key === "a" ? "applied" : "dropped";
        if (current.job.status === status) return;
        changeStatus(current.job, current.also, status);
        break;
      }
      case "z":
        takeUndo();
        break;
      default:
        return;
    }
    event.preventDefault();
  };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keyHandler.current(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  // Folded below-floor rows: one line that can open them or clear them all.
  const foldBar = below.length > 0 ? (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t pt-2" style={{ borderColor: "var(--border)" }}>
      <span className="text-xs" style={{ color: "var(--text-dim)" }}>
        {t("robin.jobs.belowFloor", { count: String(below.length), score: minScore.toFixed(2).replace(/0$/, "") })}
      </span>
      <button
        type="button"
        onClick={() => setShowBelow((current) => !current)}
        className="ui-action pi-eyebrow"
        aria-expanded={showBelow}
      >
        {showBelow ? t("robin.jobs.hideBelow") : t("robin.jobs.showBelow")}
      </button>
      <button
        type="button"
        onClick={() => void dropBelow()}
        className="ui-action pi-eyebrow"
        data-hover="danger"
      >
        {t("robin.jobs.dropBelow", { count: String(below.length) })}
      </button>
    </div>
  ) : null;

  const enabledCompanies = profile?.companies.filter((company) => company.enabled).length ?? 0;

  return (
    <div className="robin-page robin-dashboard flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
      {/* Stated in pixels: the root font size is 13px, so max-w-5xl is 832px. */}
      <main className="mx-auto flex w-full max-w-[1240px] flex-col gap-4 p-4 desktop:p-6">
        <header className="flex flex-wrap items-baseline justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl" style={{ fontStyle: "italic", fontWeight: 400, color: "var(--text)" }}>
              {t("robin.jobs.title")}
            </h1>
            <p className="pi-eyebrow">{t("robin.jobs.subtitle")}</p>
            {data && (
              <p className={rowStyles.lede}>
                {rich(t(lede.lastPush ? "robin.jobs.lede" : "robin.jobs.ledeNoPush", {
                  today: "\u00010",
                  waiting: "\u00011",
                  last: "\u00012",
                }), [
                  String(lede.today),
                  String(lede.waiting),
                  lede.lastPush ? when(lede.lastPush) : "",
                ])}
              </p>
            )}
          </div>
          <nav className="flex flex-wrap items-baseline gap-3">
            <button
              type="button"
              onClick={() => void scan()}
              disabled={scanning}
              className="ui-action pi-chrome-label pi-bracket text-xs disabled:opacity-40"
            >
              {scanning ? t("robin.jobs.scanning") : t("robin.jobs.scan")}
            </button>
            <button
              type="button"
              onClick={() => void startScoring()}
              disabled={scoringState?.running === true || pendingCount === 0}
              className="ui-action pi-chrome-label pi-bracket text-xs disabled:opacity-40"
              data-state={pendingCount > 0 && !scoringState?.running ? "accent" : "muted"}
            >
              {scoringState?.running
                ? t("robin.jobs.scoringBusy")
                : t("robin.jobs.score", { count: String(pendingCount) })}
            </button>
            <button
              type="button"
              onClick={() => void startSweep()}
              disabled={sweeping || sweepState?.running === true}
              className="ui-action pi-chrome-label pi-bracket text-xs disabled:opacity-40"
            >
              {sweepState?.running ? t("robin.jobs.sweeping") : t("robin.jobs.sweep")}
            </button>
          </nav>
        </header>

        {(actionError || error) && (
          <p className="text-sm" style={{ color: "var(--danger)" }}>{actionError ?? error}</p>
        )}
        {notice && <p className="text-sm" style={{ color: "var(--accent)" }}>{notice}</p>}

        {/* The margin holds what you set up once and glance at; the list is
            what you came for, so it starts at the top of the page. */}
        <div className={sheet.sheet}>
          <div className={`${sheet.margin} ${sheet.sticky}`}>
            <JobLinks group={profile?.linkGroup || DEFAULT_JOB_PROFILE.linkGroup} />

            {/* ── Filter summary ──────────────────────────────────────────── */}
            {profile && (
              <Section
                title={t("robin.jobs.filterTitle")}
                actions={(
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="ui-action pi-chrome-label pi-bracket text-xs"
                    data-state="accent"
                  >
                    {t("robin.jobs.filterEdit")}
                  </button>
                )}
              >
                <dl className="grid gap-y-2">
                  {[
                    { key: "roles", value: summarise(profile.titles, 4) },
                    {
                      key: "locations",
                      value: profile.locationAllow.length === 0
                        ? t("robin.jobs.summaryAnywhere")
                        : summarise(profile.locationAllow, 4),
                    },
                    {
                      key: "sources",
                      value: t("robin.jobs.summarySources", {
                        companies: String(enabledCompanies),
                        feeds: String(profile.boards.length),
                      }),
                    },
                    {
                      key: "delivery",
                      // A gate that silently drops postings belongs next to the
                      // other delivery rules, not only inside the dialog.
                      value: t(
                        profile.maxYears > 0 ? "robin.jobs.summaryDeliveryYears" : "robin.jobs.summaryDelivery",
                        {
                          days: String(profile.sinceDays),
                          // 3.75 must not round to "3.8"; 4 still reads "4.0".
                          score: profile.minScore.toFixed(Number.isInteger(profile.minScore * 10) ? 1 : 2),
                          count: String(profile.digestSize),
                          years: String(profile.maxYears),
                        },
                      ),
                    },
                  ].map(({ key, value }) => (
                    <div key={key} className="flex min-w-0 gap-3">
                      <dt className="pi-eyebrow shrink-0" style={{ width: "5.5rem" }}>
                        {t(`robin.jobs.summary.${key}`)}
                      </dt>
                      <dd className="line-clamp-3 min-w-0 flex-1 text-sm" style={{ color: "var(--copy)" }} title={value}>
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
                {profile.excludeTitles.length > 0 && (
                  <p className="text-xs" style={{ color: "var(--text-dim)" }}>
                    {t("robin.jobs.summaryExcluding", { list: summarise(profile.excludeTitles, 6) })}
                  </p>
                )}
              </Section>
            )}

            {/* ── Scoring progress ────────────────────────────────────────── */}
            {scoringState && (scoringState.running || scoringState.startedWith > 0) && (
              <Section title={t("robin.jobs.scoringTitle")}>
                <div className="flex flex-col gap-2">
                  {/* A bar is a live thing; at rest it was a full stripe that said nothing. */}
                  {scoringState.running ? (
                    <>
                      <ProgressBar
                        done={scoringState.startedWith - scoringState.remaining}
                        total={scoringState.startedWith}
                        label={t("robin.jobs.scoringTitle")}
                      />
                      <p className="pi-eyebrow tabular-nums">
                        {t("robin.jobs.scoringProgress", {
                          done: String(scoringState.startedWith - scoringState.remaining),
                          total: String(scoringState.startedWith),
                          round: String(scoringState.round),
                          rounds: String(scoringState.totalRounds),
                          model: scoringState.model ?? t("robin.jobs.scoreModelDefault"),
                        })}
                      </p>
                    </>
                  ) : (
                    <Leaders rows={[
                      [t("robin.jobs.leader.lastRun"), scoringState.finishedAt ? when(scoringState.finishedAt) : "—"],
                      [t("robin.jobs.leader.scored"), `${scoringState.startedWith - scoringState.remaining} / ${scoringState.startedWith}`],
                      [t("robin.jobs.leader.model"), (scoringState.model ?? t("robin.jobs.scoreModelDefault")).replace(/^[^/]+\//, "")],
                    ]} />
                  )}
                  {scoringState.fallbackFrom && (
                    <p className="text-xs" style={{ color: "var(--text-dim)" }}>
                      {t("robin.jobs.scoreModelFallback", { model: scoringState.fallbackFrom })}
                    </p>
                  )}
                  {scoringState.error && (
                    <p className="text-xs" style={{ color: "var(--danger)" }}>{scoringState.error}</p>
                  )}
                </div>
              </Section>
            )}

            {/* ── Sweep progress ──────────────────────────────────────────── */}
            {sweepState && (sweepState.running || sweepState.boardsDone > 0) && (
              <Section title={t("robin.jobs.sweepTitle")}>
                <div className="flex flex-col gap-2">
                  {sweepState.running ? (
                    <>
                      <ProgressBar done={sweepState.boardsDone} total={sweepState.boardsTotal} label={t("robin.jobs.sweepTitle")} />
                      <p className="pi-eyebrow tabular-nums">
                        {t("robin.jobs.sweepProgress", {
                          done: String(sweepState.boardsDone),
                          total: String(sweepState.boardsTotal),
                          scanned: String(sweepState.scanned),
                          matched: String(sweepState.matched),
                          dead: String(sweepState.unreachable + (sweepState.parked ?? 0)),
                        })}
                      </p>
                    </>
                  ) : (
                    <Leaders rows={[
                      [t("robin.jobs.leader.lastRun"), sweepState.finishedAt ? when(sweepState.finishedAt) : "—"],
                      [t("robin.jobs.leader.boards"), number(sweepState.boardsDone)],
                      [t("robin.jobs.leader.postings"), number(sweepState.scanned)],
                      [t("robin.jobs.leader.matched"), number(sweepState.matched), true],
                      [t("robin.jobs.leader.dead"), number(sweepState.unreachable + (sweepState.parked ?? 0))],
                    ]} />
                  )}
                  {sweepState.error && (
                    <p className="text-xs" style={{ color: "var(--danger)" }}>{sweepState.error}</p>
                  )}
                  {sweepState.directories.some((entry) => entry.status === "stale") && (
                    <p className="text-xs" style={{ color: "var(--text-dim)" }}>{t("robin.jobs.sweepStale")}</p>
                  )}
                </div>
              </Section>
            )}
          </div>

          {/* ── What you owe, then what is on offer ─────────────────────── */}
          <div className={`${sheet.list} flex flex-col gap-4`}>
            {/* Above the discoveries: an OA has a deadline and a posting does not. */}
            <RoundsSection />

            <Section
              title={t("robin.jobs.listTitle")}
              actions={(
                <button
                  type="button"
                  onClick={() => void previewDigest()}
                  className="ui-action pi-chrome-label pi-bracket text-xs"
                >
                  {t("robin.jobs.previewDigest")}
                </button>
              )}
            >
              <div className="flex flex-wrap gap-2">
                {(["new", "shortlist", "applied", "dropped", "all"] as Filter[]).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => { setFilter(option); setShown(PAGE_SIZE); setShowBelow(false); setCursor(null); }}
                    className="ui-action ui-action--chip pi-eyebrow px-2 py-1"
                    data-state={filter === option ? "accent" : "muted"}
                    aria-pressed={filter === option}
                  >
                    {t(`robin.jobs.filter.${option}`)} {counts.get(option) ?? 0}
                  </button>
                ))}
              </div>

              {preview !== null && (
                <div className="flex flex-col gap-1">
                  <span className="pi-eyebrow">{t("robin.jobs.previewDigest")}</span>
                  <pre
                    className="overflow-x-auto p-3 text-xs"
                    style={{ background: "var(--bg-deep)", border: "1px solid var(--border)", color: "var(--copy)" }}
                  >{preview || t("robin.jobs.emptyToday")}</pre>
                  <button
                    type="button"
                    onClick={() => setPreview(null)}
                    className="ui-action pi-eyebrow self-start"
                  >
                    {t("robin.common.cancel")}
                  </button>
                </div>
              )}

              {visible.length === 0
                ? <p className="py-2 text-sm" style={{ color: "var(--text-dim)" }}>{t("robin.jobs.emptyList")}</p>
                : (
                  // A container, so JobRow can switch to ruled one-line-meta rows
                  // when it has the width. The dashboard panel is not one.
                  <div className="@container flex flex-col gap-3">
                    <div className="flex flex-col">
                      {groups.slice(0, shown).map(({ job, also, day }, index, visibleGroups) => (
                        <Fragment key={job.id}>
                          {day && day !== visibleGroups[index - 1]?.day && (
                            <div className={rowStyles.day}>
                              <h3>{dayLabel(day)}</h3>
                              <span>{dayCounts.get(day)}</span>
                              <i aria-hidden />
                            </div>
                          )}
                          {showBelow && index === datedCount && datedCount > 0 && foldBar}
                          <JobRow
                            job={job}
                            also={also}
                            minScore={minScore}
                            busy={busyJob === job.id}
                            active={index === activeIndex}
                            onStatus={(status) => changeStatus(job, also, status)}
                            onNote={(note) => void act(job.id, () =>
                              mutate("/api/robin/jobs", "PATCH", { id: job.id, note }))}
                            onDelete={() => removeJob(job)}
                          />
                        </Fragment>
                      ))}
                    </div>
                    {groups.length > shown && (
                      <button
                        type="button"
                        onClick={() => setShown((current) => current + PAGE_SIZE)}
                        className="ui-action pi-chrome-label pi-bracket self-start text-xs"
                      >
                        {t("robin.jobs.showMore", {
                          count: String(Math.min(PAGE_SIZE, groups.length - shown)),
                          remaining: String(groups.length - shown),
                        })}
                      </button>
                    )}
                    {below.length > 0 && !(showBelow && shown > datedCount && datedCount > 0) && foldBar}
                    <p className="pi-eyebrow hidden desktop:block" style={{ color: "var(--text-dim)" }}>
                      {t("robin.jobs.keysHint")}
                    </p>
                  </div>
                )}
            </Section>
          </div>
        </div>
      </main>

      {undo && (
        <div
          role="status"
          className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-baseline gap-4 px-4 py-2 text-sm shadow-lg"
          style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", color: "var(--text)" }}
        >
          <span>{undo.message}</span>
          <button
            type="button"
            onClick={takeUndo}
            className="ui-action pi-eyebrow"
            data-state="accent"
          >
            {t("robin.jobs.undo")}
          </button>
        </div>
      )}

      {editing && profile && catalogue && (
        <JobFilterDialog
          profile={profile}
          catalogue={catalogue}
          onSave={saveProfile}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}
