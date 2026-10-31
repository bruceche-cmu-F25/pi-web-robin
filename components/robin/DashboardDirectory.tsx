"use client";

import Link from "next/link";
import { useI18n } from "@/hooks/useI18n";
import styles from "./Dashboard.module.css";

// Fixed destinations, grouped by what people do. Descriptions explain the
// contents; icons and tones aid recognition without carrying meaning alone.
const GROUPS = [
  { key: "work", tone: "slate", items: [
    { href: "/dashboard/gmail", key: "inbox", label: "robin.nav.gmail", icon: "M3 6h18v13H3zM3 6l9 7 9-7" },
    { href: "/dashboard/jobs", key: "jobs", label: "robin.nav.jobs", icon: "M3 7h18v13H3zM8 7V4h8v3M3 12h18M10 12v3h4v-3" },
    { href: "/dashboard/kanban", key: "kanban", label: "robin.nav.kanban", icon: "M3 3h18v18H3zM9 3v18M15 3v18M5 7h2M11 7h2M17 7h2M5 11h2M11 11h2M5 15h2" },
  ] },
  { key: "knowledge", tone: "teal", items: [
    { href: "/learn", key: "learn", label: "robin.nav.learn", icon: "M3 4h5a4 4 0 014 4v13a4 4 0 00-4-3H3zM21 4h-5a4 4 0 00-4 4v13a4 4 0 014-3h5z" },
    { href: "/notes", key: "notes", label: "robin.nav.notes", icon: "M5 3h11l3 3v15H5zM16 3v4h3M8 11h8M8 15h8M8 18h5" },
    { href: "/obsidian", key: "obsidian", label: "robin.nav.obsidian", icon: "m12 2 7 5 2 10-9 5-9-5 2-10zM12 2 8 12l4 10 4-10zM3 17l5-5M21 17l-5-5" },
    { href: "/research", key: "research", label: "robin.nav.research", icon: "M10 3h4M10.5 3v6.2L5.2 18a2 2 0 001.7 3h10.2a2 2 0 001.7-3l-5.3-8.8V3M8 14h8" },
  ] },
  { key: "create", tone: "iris", items: [
    { href: "/product", key: "product", label: "robin.nav.product", icon: "m12 3 8 4.5-8 4.5-8-4.5zM4 12l8 4.5 8-4.5M4 16.5l8 4.5 8-4.5" },
    { href: "/tools", key: "tools", label: "toolbox.shortcut", icon: "M14 6a5 5 0 00-6 6L3 17a3 3 0 004 4l5-5a5 5 0 006-6l-3 3-4-4z" },
  ] },
  { key: "preferences", tone: "clay", items: [
    { href: "/dashboard/settings", key: "settings", label: "robin.nav.settings", icon: "M4 7h16M4 17h16M8 4v6M16 14v6" },
  ] },
] as const;

export function DashboardDirectory({ href }: { href: (path: string) => string }) {
  const { t } = useI18n();
  return <section className={styles.directory} aria-labelledby="dashboard-directory-title">
    <h2 id="dashboard-directory-title" className="sr-only">{t("daily.directory")}</h2>
    <div className={styles.directoryGroups}>{GROUPS.map(group => <section key={group.key} className={styles.directoryGroup} data-tone={group.tone} aria-labelledby={`directory-${group.key}`}>
      <h3 id={`directory-${group.key}`}>{t(`daily.directory.${group.key}`)}</h3>
      <div className={styles.directoryLinks}>{group.items.map(item => {
        // Settings holds write-only credential drafts: Back must cross a native
        // document boundary so its beforeunload guard can protect them too.
        const NavigationLink = item.key === "settings" ? "a" : Link;
        return <NavigationLink key={item.href} href={href(item.href)} {...(item.key === "settings" ? {} : { prefetch: false })} className="ui-action" data-workspace={item.key}>
        <span className={styles.directoryIcon} aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={item.icon} /></svg></span>
        <span className={styles.directoryCopy}><span>{t(item.label)}</span><small>{t(`daily.directory.${item.key}Hint`)}</small></span>
        <svg className={styles.directoryArrow} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
      </NavigationLink>;
      })}</div>
    </section>)}</div>
  </section>;
}
