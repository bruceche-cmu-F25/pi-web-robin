"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useI18n } from "@/hooks/useI18n";
import { eventReturnHref } from "./board-navigation";
import styles from "./InformationInbox.module.css";

const JOBS = "/dashboard/jobs";
const EVENTS = "/dashboard/events";
const RESUME = "/dashboard/jobs/resume";

/** Route-backed tabs keep old bookmarks, event return links and browser history intact. */
export function JobHuntWorkspace({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const search = useSearchParams();
  const query = search.toString();
  const [views, setViews] = useState<Record<string, string>>({});
  useEffect(() => {
    if (pathname === JOBS || pathname === EVENTS || pathname === RESUME) {
      setViews((current) => current[pathname] === query ? current : { ...current, [pathname]: query });
    }
  }, [pathname, query]);
  const events = pathname === EVENTS || pathname.startsWith(`${EVENTS}/`);
  if (pathname !== JOBS && pathname !== RESUME && !events) return children;

  const href = (path: string) => {
    const params = new URLSearchParams(path === pathname ? query : views[path]);
    // Details carry their list context inside the validated return URL.
    const context = pathname.startsWith(`${EVENTS}/`)
      ? new URLSearchParams(eventReturnHref(search.get("returnTo")).split("?")[1]) : search;
    for (const key of ["session", "cwd"]) {
      const value = context.get(key);
      if (value) params.set(key, value); else params.delete(key);
    }
    if (path === EVENTS && pathname.startsWith(`${EVENTS}/`)) return eventReturnHref(search.get("returnTo"));
    return path + (params.size ? `?${params}` : "");
  };

  return <div className={styles.inbox}>
    <nav className={`robin-workspace-tabs ${styles.sources} ${styles.jobSources}`} aria-label={t("robin.jobs.views")}>
      <span className="pi-eyebrow">{t("robin.nav.jobs")}</span>
      {[[JOBS, t("robin.jobs.positions")], [RESUME, t("resume.tab")], [EVENTS, t("robin.nav.events")]].map(([path, label]) => {
        const current = (path === EVENTS ? events : path === pathname) ? "page" as const : undefined;
        // The editor owns a beforeunload guard; native entry AND exit also protect browser Back.
        return path === RESUME || pathname === RESUME
          ? <a key={path} href={href(path)} aria-current={current}>{label}</a>
          : <Link key={path} href={href(path)} prefetch={false} scroll={false} aria-current={current}>{label}</Link>;
      })}
    </nav>
    {children}
  </div>;
}
