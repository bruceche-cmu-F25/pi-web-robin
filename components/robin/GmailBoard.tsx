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
import sheet from "./Worksheet.module.css";

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
      {/* Stated in pixels: the root font size is 13px, so max-w-5xl is 832px. */}
      <main className="mx-auto flex w-full max-w-[1240px] flex-col gap-5 p-4 desktop:p-6">
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

        {/* A stored review still shows if Google has since disconnected;
            only a page with nothing to show is reduced to the connect card. */}
        {data && !data.connected && !review && (
          <section className={`pi-card ${styles.connection} ${styles.connect}`}>
            <h2>{t("robin.gmail.connectTitle")}</h2>
            <GoogleConnect status={{ connected: data.connected }} onChanged={() => void refresh()} />
            <p>{t("robin.gmail.readonlyNote")}</p>
          </section>
        )}

        {data && (data.connected || review) && (
          <div className={sheet.sheet}>
            {review && (
              <div className={sheet.margin}>
                <section aria-labelledby="mail-overview">
                  <h2 id="mail-overview" className="pi-label">{t("robin.gmail.overview")}</h2>
                  <dl className={sheet.leaders}>
                    <div>
                      <dt>{t("robin.gmail.todayCount")}</dt>
                      <span aria-hidden="true" className={sheet.leader} />
                      <dd>{review.items.length}</dd>
                    </div>
                    <div data-accent={attention > 0}>
                      <dt>{t("robin.gmail.attentionCount")}</dt>
                      <span aria-hidden="true" className={sheet.leader} />
                      <dd>{attention}</dd>
                    </div>
                    <div>
                      <dt>{t("robin.gmail.autoCreated")}</dt>
                      <span aria-hidden="true" className={sheet.leader} />
                      <dd>{t("robin.gmail.createdSummary", { todos: String(actions.todos), events: String(actions.events) })}</dd>
                    </div>
                  </dl>
                </section>

                {review.items.length > 0 && (
                  <section>
                    <label className={styles.search}>
                      <span className="pi-label">{t("robin.gmail.search")}</span>
                      <input type="search" value={query} placeholder={t("robin.gmail.searchPlaceholder")} onChange={(event) => setQuery(event.target.value)} />
                    </label>
                  </section>
                )}

                {/* An index rather than a <select>: the categories and their
                    counts are the overview, and a dropdown hides both. */}
                {review.items.length > 0 && (
                  <section aria-labelledby="mail-categories">
                    <h2 id="mail-categories" className="pi-label">{t("robin.gmail.categoryFilter")}</h2>
                    <div className={styles.index}>
                      {([
                        ["all", t("robin.gmail.all"), review.items.length],
                        ["attention", t("robin.gmail.attentionCount"), attention],
                        ...MAIL_CATEGORIES.map((category) => [
                          category,
                          t(`robin.gmail.category.${category}`),
                          review.items.filter((item) => item.category === category).length,
                        ] as const),
                      ] as const)
                        // Keep a selected category available if polling removes its last item.
                        .filter(([value, , count]) => value === "all" || value === "attention" || count > 0 || filter === value)
                        .map(([value, label, count]) => (
                          <button
                            key={value}
                            type="button"
                            aria-pressed={filter === value}
                            onClick={() => setFilter(value)}
                          >
                            <span>{label}</span>
                            <span>{count}</span>
                          </button>
                        ))}
                    </div>
                  </section>
                )}
              </div>
            )}

            <div className={sheet.list}>
              {data.connected && !review && !loading && (
                <section className={`pi-card ${styles.empty}`}>
                  <h2>{t("robin.gmail.emptyTitle")}</h2>
                  <p>{t("robin.gmail.empty")}</p>
                </section>
              )}

              {review && (review.items.length > 0 ? (
                <section className={`pi-card ${styles.inbox}`} aria-label={t("robin.gmail.messages")}>
                  <div className={styles.results}>
                    <p role="status">{t("robin.gmail.results", { count: String(visibleCount), total: String(review.items.length) })}</p>
                    {(query || filter !== "all") && <button type="button" className="ui-action" onClick={resetFilters}>{t("robin.gmail.clearFilters")}</button>}
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
                              {/* The whole row is the link, so "open in Gmail"
                                  is an arrow on the meta line, not a line of its own. */}
                              <a
                                href={`https://mail.google.com/mail/u/0/#all/${encodeURIComponent(item.threadId || item.id)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={styles.mail}
                              >
                                <div className={styles.mailMeta}>
                                  <span className={styles.sender} title={item.from}>{item.from || t("robin.gmail.unknownSender")}</span>
                                  <span className={styles.stamp}>
                                    <time dateTime={item.date}>{formatDate(item.date, locale)}</time>
                                    <span className={styles.openMail}>
                                      <span className="sr-only">{t("robin.gmail.openMail")}</span>
                                      <span aria-hidden="true">↗</span>
                                    </span>
                                  </span>
                                </div>
                                <h3>{item.subject || t("robin.gmail.noSubject")}</h3>
                                {(item.summary || item.snippet) && <p className={styles.summary}>{item.summary || item.snippet}</p>}
                                {item.action !== "none" && (
                                  <div className={styles.mailFooter}>
                                    <span className={styles.badge}>{t(`robin.gmail.action.${item.action}`)}</span>
                                  </div>
                                )}
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
              ))}
            </div>

            <div className={sheet.foot}>
              {review?.report && (
                <details className={styles.report}>
                  <summary>{t("robin.gmail.lastReport")}</summary>
                  <div className={styles.reportBody}><MarkdownBody>{review.report}</MarkdownBody></div>
                </details>
              )}
              <section className={styles.connection}>
                {!data.connected && <h2>{t("robin.gmail.connectTitle")}</h2>}
                <GoogleConnect status={{ connected: data.connected }} onChanged={() => void refresh()} />
                <p>{t("robin.gmail.readonlyNote")}</p>
              </section>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
