"use client";

import Link from "next/link";
import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { Job } from "@/extension/robin/jobs";
import type { JobBoard } from "@/extension/robin/job-domain";
import { JobRow } from "./JobRow";
import { groupJobRoles } from "./jobs-view";
import { mutateResponse, usePolledResource } from "./usePolledResource";

/** Enough to be worth a glance on the dashboard; the rest is one click away. */
const PREVIEW_COUNT = 5;

export interface JobsResponse {
  jobs: Job[];
  scan: {
    finishedAt: string;
    scanned: number;
    matched: number;
    admitted?: number;
    duplicates?: number;
    added: number;
    history?: { startedAt: string; scanned: number; matched: number; admitted: number;
      duplicates: number; added: number; closed: number; errors: number;
      missingJd?: number; verifiedNew?: number }[];
    sources: { id: string; name: string; count: number; matched?: number; admitted?: number;
      duplicates?: number; added?: number; missingJd?: number; verifiedNew?: number;
      rejected?: { date: number; title: number; location: number; blacklist: number }; error?: string }[];
  } | null;
  minScore: number;
  digestSize: number;
  configured: boolean;
  scope?: JobBoard["scope"];
  cards?: JobBoard["cards"];
  overview?: JobBoard["overview"];
}

/**
 * The dashboard's window onto the job hunt.
 *
 * Deliberately read-only apart from the scan button: this panel sits under the
 * calendar in a page you open to see your day, so it answers "is there
 * anything today" and hands off to /dashboard/jobs for everything else.
 */
export function JobsPanel() {
  const { t } = useI18n();
  const { data, error, loading, refresh } = usePolledResource<JobsResponse>("/api/robin/jobs?status=new&view=cards", 60000);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const jobs = data?.jobs ?? [];
  const fresh = groupJobRoles(jobs.filter((job) => job.status === "new" && typeof job.score === "number" && job.score >= (data?.minScore ?? 4)))
    .map(({ job }) => job);
  const preview = fresh.slice(0, PREVIEW_COUNT);
  const empty = jobs.length === 0 && !error && !scanError;

  const scan = async () => {
    setScanning(true);
    setScanError(null);
    try {
      await mutateResponse("/api/robin/jobs/scan", "POST", {});
      await refresh();
    } catch (caught) {
      setScanError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setScanning(false);
    }
  };

  return (
    <section id="dashboard-jobs" hidden={empty} style={{ display: empty ? "none" : undefined }} tabIndex={-1} className="pi-card flex scroll-mt-24 flex-col gap-3 p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-3">
          <h2 className="pi-section-title">{t("robin.jobs.title")}</h2>
          <span className="text-xs tabular-nums" style={{ color: "var(--text-dim)" }}>
            {t("robin.attention.matchingJobs", { count: String(fresh.length) })}
          </span>
        </div>
        <div className="flex flex-wrap items-baseline gap-3">
          <button
            type="button"
            onClick={() => void scan()}
            disabled={scanning}
            className="ui-action pi-chrome-label pi-bracket text-xs disabled:opacity-40"
          >
            {scanning ? t("robin.jobs.scanning") : t("robin.jobs.scan")}
          </button>
          <Link
            href="/dashboard/jobs"
            className="ui-action pi-chrome-label pi-bracket text-xs"
            data-state="accent"
          >
            {t("robin.jobs.manage")}
          </Link>
        </div>
      </header>

      {(error || scanError) && (
        <p className="text-xs" style={{ color: "var(--danger)" }}>{scanError ?? error}</p>
      )}

      {!loading && data && !data.configured && (
        <p className="py-2 text-sm" style={{ color: "var(--text-dim)" }}>
          {t("robin.jobs.unconfigured")}{" "}
          <Link href="/dashboard/jobs" className="underline" style={{ color: "var(--accent)" }}>
            {t("robin.jobs.manage")}
          </Link>
        </p>
      )}

      {!loading && data?.configured && preview.length === 0 && (
        <p className="py-2 text-sm" style={{ color: "var(--text-dim)" }}>
          {t(jobs.length > 0 ? "robin.jobs.belowPreview" : "robin.jobs.emptyToday", { count: String(groupJobRoles(jobs).length) })}
        </p>
      )}

      {preview.length > 0 && (
        <div className="flex flex-col gap-1">
          {preview.map((job) => (
            <JobRow key={job.id} job={job} minScore={data?.minScore ?? 0} />
          ))}
        </div>
      )}

      {data?.scan && data.scan.sources.length === 0 && (
        <p className="pi-eyebrow">{t("robin.jobs.scanNoSources")}</p>
      )}

      {data?.scan && data.scan.sources.length > 0 && (
        <p className="pi-eyebrow">
          {t("robin.jobs.lastScan", {
            time: new Date(data.scan.finishedAt).toLocaleString(),
            scanned: String(data.scan.scanned),
            matched: String(data.scan.matched),
          })}
        </p>
      )}
    </section>
  );
}
