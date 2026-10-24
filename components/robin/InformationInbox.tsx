"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "@/hooks/useI18n";
import { GmailBoard } from "./GmailBoard";
import { AiWeeklyBoard } from "./AiWeeklyBoard";
import styles from "./InformationInbox.module.css";

/** One incoming-information destination; each source keeps its own state and actions. */
export function InformationInbox() {
  const { t } = useI18n();
  const search = useSearchParams();
  const router = useRouter();
  const weekly = search.get("feed") === "ai";
  const select = (ai: boolean) => {
    const params = new URLSearchParams(search);
    if (ai) params.set("feed", "ai"); else params.delete("feed");
    router.replace(`/dashboard/gmail${params.size ? `?${params}` : ""}`, { scroll: false });
  };
  return <div className={styles.inbox}>
    <nav className={styles.sources} aria-label={t("weekly.inboxNav")}>
      <span className="pi-eyebrow">{t("robin.nav.gmail")}</span>
      <button type="button" aria-pressed={!weekly} onClick={() => select(false)}>{t("weekly.email")}</button>
      <button type="button" aria-pressed={weekly} onClick={() => select(true)}>{t("weekly.title")}</button>
    </nav>
    {/* Keep both mounted so switching sources does not discard a mail filter or a reading/settings draft. */}
    <div className={styles.panel} hidden={weekly}><GmailBoard /></div>
    <div className={styles.panel} hidden={!weekly}><AiWeeklyBoard /></div>
  </div>;
}
