"use client";

import { useMemo, useRef, useState } from "react";
import { MarkdownBody } from "@/components/MarkdownBody";
import { useI18n } from "@/hooks/useI18n";
import {
  countReviewActions,
  MAIL_CATEGORIES,
  type MailCategory,
  type MailReview,
} from "@/extension/robin/mail";
import { GoogleConnect } from "./GoogleConnect";
import { usePolledResource } from "./usePolledResource";
import styles from "./GmailBoard.module.css";

interface GmailResponse {
  connected: boolean;
  today: string;
  review: MailReview | null;
}

function formatDate(iso: string, locale: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** A categorised review, not a second inbox. All mail actions stay in Gmail. */
export function GmailBoard() {
  const { t, locale } = useI18n();
  const { data, error, loading, refresh } = usePolledResource<GmailResponse>("/api/robin/gmail", 30_000);
  const [checking, setChecking] = useState(false);
  const checkInFlight = useRef(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "attention" | MailCategory>("all");
  const review = data?.review ?? null;

  const byCategory = useMemo(() => {
    const buckets = new Map<MailCategory, MailReview["items"]>();
    const needle = query.trim().toLocaleLowerCase(locale);
    for (const item of review?.items ?? []) {
      if (filter === "attention" && item.category === "other") continue;
      if (filter !== "all" && filter !== "attention" && item.category !== filter) continue;
      if (needle && ![item.subject, item.from, item.summary, item.snippet].some((value) => value.toLocaleLowerCase(locale).includes(needle))) continue;
      const list = buckets.get(item.category) ?? [];
      list.push(item);
      buckets.set(item.category, list);
    }
    return buckets;
  }, [review, query, filter, locale]);

  const attention = (review?.items ?? []).filter((item) => item.category !== "other").length;
  const visibleCount = Array.from(byCategory.values()).reduce((count, items) => count + items.length, 0);
  const actions = review ? countReviewActions(review) : { todos: 0, events: 0 };
  const resetFilters = () => { setQuery(""); setFilter("all"); };

  const check = async () => {
    if (checkInFlight.current) return;
    checkInFlight.current = true;
    setChecking(true);
    setActionError(null);
    try {
      const response = await fetch("/api/robin/gmail/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: locale.startsWith("zh") ? "zh" : "en" }),
      });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? `Request failed (${response.status})`);
      await refresh();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      checkInFlight.current = false;
      setChecking(false);
    }
  };

  return (
    <div className={`robin-page robin-dashboard flex-1 overflow-y-auto ${styles.page}`}>
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-4 desktop:p-6">
        <header className={styles.header}>
          <div>
            <p className="pi-eyebrow">{t("robin.gmail.subtitle")}</p>
            <h1 className={styles.title}>{t("robin.gmail.title")}</h1>
            {review && <p className={styles.meta}>{t("robin.gmail.updated")} <time dateTime={review.reviewedAt}>{formatDate(review.reviewedAt, locale)}</time></p>}
          </div>
          <button
            type="button"
            onClick={() => void check()}
            disabled={checking || !data?.connected}
            className="ui-action pi-chrome-label pi-bracket text-xs disabled:opacity-40"
            data-state="accent"
          >
            {checking ? t("robin.gmail.checking") : t("robin.gmail.check")}
          </button>
        </header>

        {(actionError || error) && (
          <div role="alert" className={styles.error}>
            <p>{actionError ?? error}</p>
            {error && <button type="button" className="ui-action pi-bracket" onClick={() => void refresh()}>{t("robin.gmail.retry")}</button>}
          </div>
        )}
        {loading && <p role="status" className={styles.empty}>{t("robin.gmail.loading")}</p>}
        {checking && <p role="status" className={styles.notice}>{t("robin.gmail.checkingHint")}</p>}

        {data?.connected && !review && !loading && (
          <section className={`pi-card ${styles.empty}`}>
            <h2>{t("robin.gmail.emptyTitle")}</h2>
            <p>{t("robin.gmail.empty")}</p>
          </section>
        )}

        {review && (
          <>
            <section className={`pi-card ${styles.overview}`} aria-label={t("robin.gmail.overview")}>
              <div>
                <span className="pi-eyebrow">{t("robin.gmail.todayCount")}</span>
                <strong>{review.items.length}</strong>
              </div>
              <div data-attention={attention > 0}>
                <span className="pi-eyebrow">{t("robin.gmail.attentionCount")}</span>
                <strong className={attention > 0 ? styles.accent : undefined}>{attention}</strong>
              </div>
              <div>
                <span className="pi-eyebrow">{t("robin.gmail.autoCreated")}</span>
                <p className="text-sm">{t("robin.gmail.createdSummary", { todos: String(actions.todos), events: String(actions.events) })}</p>
              </div>
            </section>

            {review.report && (
              <details className={`pi-card ${styles.report}`}>
                <summary>{t("robin.gmail.lastReport")}</summary>
                <div className={styles.reportBody}><MarkdownBody>{review.report}</MarkdownBody></div>
              </details>
            )}

            {review.items.length > 0 ? (
              <section className={`pi-card ${styles.inbox}`} aria-label={t("robin.gmail.messages")}>
                <div className={styles.toolbar}>
                  <div className={styles.fields}>
                    <label>
                      <span className="pi-eyebrow">{t("robin.gmail.search")}</span>
                      <input type="search" value={query} placeholder={t("robin.gmail.searchPlaceholder")} onChange={(event) => setQuery(event.target.value)} />
                    </label>
                    <label>
                      <span className="pi-eyebrow">{t("robin.gmail.categoryFilter")}</span>
                      <select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}>
                        <option value="all">{t("robin.gmail.all")}</option>
                        <option value="attention">{t("robin.gmail.attentionCount")} · {attention}</option>
                        {MAIL_CATEGORIES.map((category) => {
                          const count = review.items.filter((item) => item.category === category).length;
                          // Keep a selected category available if polling removes its last item.
                          return count || filter === category ? <option key={category} value={category}>{t(`robin.gmail.category.${category}`)} · {count}</option> : null;
                        })}
                      </select>
                    </label>
                  </div>
                  <div className={styles.results}>
                    <p role="status">{t("robin.gmail.results", { count: String(visibleCount), total: String(review.items.length) })}</p>
                    {(query || filter !== "all") && <button type="button" className="ui-action" onClick={resetFilters}>{t("robin.gmail.clearFilters")}</button>}
                  </div>
                </div>

                {visibleCount === 0 && <div className={styles.empty}><h2>{t("robin.gmail.noMatches")}</h2><p>{t("robin.gmail.noMatchesHint")}</p></div>}
                {MAIL_CATEGORIES.map((category) => {
                  const items = byCategory.get(category);
                  if (!items?.length) return null;
                  return (
                    <section key={category} aria-labelledby={`mail-category-${category}`}>
                      <h2 id={`mail-category-${category}`} className={styles.category} data-category={category}>
                        {t(`robin.gmail.category.${category}`)} <span>{items.length}</span>
                      </h2>
                      <ul>
                        {items.map((item) => (
                          <li key={item.id}>
                            <a
                              href={`https://mail.google.com/mail/u/0/#all/${encodeURIComponent(item.threadId || item.id)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={styles.mail}
                            >
                              <div className={styles.mailMeta}>
                                <span className={styles.sender} title={item.from}>{item.from || t("robin.gmail.unknownSender")}</span>
                                <time dateTime={item.date}>{formatDate(item.date, locale)}</time>
                              </div>
                              <h3>{item.subject || t("robin.gmail.noSubject")}</h3>
                              {(item.summary || item.snippet) && <p className={styles.summary}>{item.summary || item.snippet}</p>}
                              <div className={styles.mailFooter}>
                                {item.action !== "none" && <span className={styles.badge}>{t(`robin.gmail.action.${item.action}`)}</span>}
                                <span className={styles.openMail}>{t("robin.gmail.openMail")} <span aria-hidden="true">↗</span></span>
                              </div>
                            </a>
                          </li>
                        ))}
                      </ul>
                    </section>
                  );
                })}
              </section>
            ) : (
              <section className={`pi-card ${styles.empty}`}><h2>{t("robin.gmail.noMail")}</h2><p>{t("robin.gmail.noMailHint")}</p></section>
            )}
          </>
        )}

        {data && (
          <section className={`pi-card ${styles.connection}`}>
            {!data.connected && <h2>{t("robin.gmail.connectTitle")}</h2>}
            <GoogleConnect status={{ connected: data.connected }} onChanged={() => void refresh()} />
            <p>{t("robin.gmail.readonlyNote")}</p>
          </section>
        )}
      </main>
    </div>
  );
}
