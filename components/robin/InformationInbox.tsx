"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "@/hooks/useI18n";
import { GmailBoard } from "./GmailBoard";
import { AiWeeklyBoard } from "./AiWeeklyBoard";
import { PodcastDirectory } from "./PodcastDirectory";
import { BriefBoard } from "./BriefBoard";
import styles from "./InformationInbox.module.css";

/** One incoming-information destination; each source keeps its own state and actions. */
export function InformationInbox() {
  const { t } = useI18n();
  const search = useSearchParams();
  const router = useRouter();
  const feed = search.get("feed");
  const source = feed === "ai" || feed === "podcasts" || feed === "brief" ? feed : "email";
  const [visited, setVisited] = useState(() => new Set([source]));
  useEffect(() => {
    setVisited((current) => current.has(source) ? current : new Set(current).add(source));
  }, [source]);
  const select = (next: string) => {
    const params = new URLSearchParams(search);
    if (next === "email") params.delete("feed"); else params.set("feed", next);
    router.push(`/dashboard/gmail${params.size ? `?${params}` : ""}`, { scroll: false });
  };
  return <div className={styles.inbox}>
    <nav className={`robin-workspace-tabs ${styles.sources}`} aria-label={t("weekly.inboxNav")}>
      <span className="pi-eyebrow">{t("robin.nav.gmail")}</span>
      {([
        ["email", t("weekly.email")], ["brief", t("brief.title")], ["ai", t("weekly.title")], ["podcasts", t("robin.nav.podcasts")],
      ] as const).map(([key, label]) => <button key={key} type="button" aria-pressed={source === key}
        aria-controls={`incoming-${key}`} onClick={() => select(key)}>{label}</button>)}
    </nav>
    {/* Mount on first visit; then preserve filters, drafts and scroll without background polling. */}
    <div id="incoming-email" className={styles.panel} hidden={source !== "email"}>
      {(source === "email" || visited.has("email")) && <GmailBoard active={source === "email"} />}
    </div>
    <div id="incoming-brief" className={styles.panel} hidden={source !== "brief"}>
      {(source === "brief" || visited.has("brief")) && <BriefBoard active={source === "brief"} />}
    </div>
    <div id="incoming-ai" className={styles.panel} hidden={source !== "ai"}>
      {(source === "ai" || visited.has("ai")) && <AiWeeklyBoard active={source === "ai"} />}
    </div>
    <div id="incoming-podcasts" className={styles.panel} hidden={source !== "podcasts"}>
      {(source === "podcasts" || visited.has("podcasts")) && <PodcastDirectory active={source === "podcasts"} />}
    </div>
  </div>;
}
