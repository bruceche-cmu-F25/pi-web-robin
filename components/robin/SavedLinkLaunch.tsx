"use client";

import { useSyncExternalStore } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { Link } from "@/extension/robin/links";
import { SavedLinkIcon } from "./SavedLinkIcon";
import { isIOSLinkPlatform, savedLinkLaunch } from "./saved-link-launch";
import styles from "./SavedLinkLaunch.module.css";

const subscribe = () => () => {};
const iosSnapshot = () => isIOSLinkPlatform(navigator);
const serverSnapshot = () => false;

/** Direct user-activated anchors; no installation probes or timed redirects. */
export function SavedLinkLaunch({ link, mobile, compact = false }: { link: Link; mobile: boolean; compact?: boolean }) {
  const { t } = useI18n();
  const ios = useSyncExternalStore(subscribe, iosSnapshot, serverSnapshot);
  const destination = savedLinkLaunch(link.url, mobile && ios);
  return <div className={styles.launch} data-compact={compact || undefined} data-app-link={destination.app}>
    <a href={destination.href} target={mobile ? undefined : "_blank"} rel="noopener noreferrer"
      className={`robin-saved-link ui-action ${styles.main}`} title={link.url}
      aria-label={destination.app ? t(destination.home ? "daily.links.appHomeLabel" : "daily.links.appPageLabel", { title: link.title, app: destination.app }) : undefined}>
      <span className={styles.icon}><SavedLinkIcon link={link} size={compact ? 18 : 24} /></span>
      <span className={styles.copy}><span className={styles.title}>{link.title}</span>
        {mobile && destination.app && <span className={styles.hint}>{t(destination.home ? "daily.links.appHome" : "daily.links.appPage")}</span>}
      </span>
      {mobile && !destination.app && <span className={styles.arrow} aria-hidden="true">↗</span>}
    </a>
  </div>;
}
