"use client";

import { useI18n } from "@/hooks/useI18n";
import type { JobsResponse } from "./JobsPanel";

/** Scan counts are observations, not an estimate of eligible applications. */
export function JobScanFunnel({ scan }: { scan: NonNullable<JobsResponse["scan"]> }) {
  const { t } = useI18n();
  if (scan.admitted === undefined) return null; // pre-instrumentation state
  const total = (field: "scanned" | "matched" | "admitted" | "duplicates" | "added") =>
    (scan.history ?? []).reduce((sum, run) => sum + run[field], 0);
  return (
    <section className="pi-card flex flex-col gap-2 p-4">
      <h2 className="pi-label">{t("robin.jobs.funnelTitle")}</h2>
      <p className="pi-eyebrow tabular-nums">
        {t("robin.jobs.funnelRun", { scanned: String(scan.scanned), matched: String(scan.matched),
          admitted: String(scan.admitted), duplicates: String(scan.duplicates ?? 0), added: String(scan.added) })}
      </p>
      {!!scan.history?.length && (
        <p className="pi-eyebrow tabular-nums">
          {t("robin.jobs.funnelWeek", { scanned: String(total("scanned")), matched: String(total("matched")),
            admitted: String(total("admitted")), duplicates: String(total("duplicates")), added: String(total("added")),
            verified: String(scan.history.reduce((sum, run) => sum + (run.verifiedNew ?? 0), 0)) })}
        </p>
      )}
      <details className="text-xs" style={{ color: "var(--text-dim)" }}>
        <summary className="cursor-pointer">{t("robin.jobs.funnelSources")}</summary>
        <ul className="mt-2 flex flex-col gap-2">
          {scan.sources.map((source) => (
            <li key={source.id} className="min-w-0 break-words">
              <strong style={{ color: "var(--copy)" }}>{source.name}</strong>{" — "}
              {source.error ?? t("robin.jobs.funnelSource", { scanned: String(source.count),
                date: String(source.rejected?.date ?? 0), title: String(source.rejected?.title ?? 0),
                location: String(source.rejected?.location ?? 0), matched: String(source.matched ?? 0),
                admitted: String(source.admitted ?? 0), duplicates: String(source.duplicates ?? 0),
                added: String(source.added ?? 0), missingJd: String(source.missingJd ?? 0) })}
              {!source.error && (source.id === "won-newgrad" || source.id === "ml-newgrad") &&
                ` · ${t("robin.jobs.funnelVerified", { count: String(source.verifiedNew ?? 0) })}`}
            </li>
          ))}
        </ul>
      </details>
      <p className="pi-eyebrow">{t("robin.jobs.funnelCaveat")}</p>
    </section>
  );
}
