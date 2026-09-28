"use client";

import { useMemo, useRef, useState } from "react";
import { MarkdownBody } from "@/components/MarkdownBody";
import { useI18n } from "@/hooks/useI18n";
import { addDays, dueBucket, localDate, parseLocalDate } from "@/extension/robin/dates";
import {
  countReviewActions,
  groupByTriage,
  type MailReview,
  type MailReviewItem,
} from "@/extension/robin/mail";
import { GoogleConnect } from "./GoogleConnect";
import { mutate, usePolledResource } from "./usePolledResource";
import styles from "./GmailBoard.module.css";
import sheet from "./Worksheet.module.css";

interface GmailResponse {
  connected: boolean;
  today: string;
  review: MailReview | null;
  lastReviewedAt: string | null;
}

type Translate = ReturnType<typeof useI18n>["t"];

/** "Today 08:30", "Yesterday 22:14", then a plain date: most of a review is from the last day. */
function formatWhen(iso: string, locale: string, today: string, t: Translate): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const time = date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const day = localDate(date);
  if (day === today) return t("robin.gmail.todayAt", { time });
  if (day === addDays(today, -1)) return t("robin.gmail.yesterdayAt", { time });
  return date.toLocaleString(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** "Overdue · Sep 22", "Today", "Sep 30 · 6 days": the deadline is what decides the order you read in. */
function dueLabel(due: string, today: string, locale: string, t: Translate): { text: string; urgent: boolean } {
  const bucket = dueBucket(due, today);
  const date = parseLocalDate(due).toLocaleDateString(locale, { month: "short", day: "numeric" });
  if (bucket === "overdue") return { text: t("robin.gmail.due.overdue", { date }), urgent: true };
  if (bucket === "today") return { text: t("robin.gmail.due.today"), urgent: true };
  if (bucket === "tomorrow") return { text: t("robin.gmail.due.tomorrow"), urgent: true };
  const days = Math.round((parseLocalDate(due).getTime() - parseLocalDate(today).getTime()) / 86_400_000);
  return { text: t("robin.gmail.due.inDays", { date, days: String(days) }), urgent: days <= 3 };
}

function gmailHref(item: MailReviewItem): string {
  return `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(item.threadId || item.id)}`;
}

/** A categorised review, not a second inbox. All mail actions stay in Gmail. */
export function GmailBoard() {
  const { t, locale } = useI18n();
  const { data, error, loading, refresh } = usePolledResource<GmailResponse>("/api/robin/gmail", 30_000);
  const [checking, setChecking] = useState(false);
  const checkInFlight = useRef(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [fyiOpen, setFyiOpen] = useState(false);
  // Done/undo shows at once; the next poll confirms it or the error puts it back.
  const [pending, setPending] = useState<ReadonlyMap<string, boolean>>(new Map());
  const stored = data?.review ?? null;
  const today = data?.today || localDate();
  const needle = query.trim().toLocaleLowerCase(locale);

  const review = useMemo((): MailReview | null => {
    if (!stored || pending.size === 0) return stored;
    return {
      ...stored,
      items: stored.items.map((item) => (pending.has(item.id) ? { ...item, done: pending.get(item.id) } : item)),
    };
  }, [stored, pending]);
  const all = useMemo(() => groupByTriage(review?.items ?? []), [review]);
  const groups = useMemo(() => {
    if (!needle) return all;
    const matches = (item: MailReviewItem) => [item.subject, item.from, item.summary, item.snippet, item.next ?? ""]
      .some((value) => value.toLocaleLowerCase(locale).includes(needle));
    return { act: all.act.filter(matches), tracked: all.tracked.filter(matches), fyi: all.fyi.filter(matches) };
  }, [all, needle, locale]);

  const visibleCount = groups.act.length + groups.tracked.length + groups.fyi.length;
  const actions = review ? countReviewActions(review) : { todos: 0, events: 0 };
  const handled = review?.items.filter((item) => item.done).length ?? 0;
  const headline = review?.headline
    || (all.act.length > 0
      ? t("robin.gmail.fallbackHeadline", { count: String(all.act.length) })
      : t("robin.gmail.allClear"));

  // A tracked deadline is somebody else's job to shout about — the todo's.
  const due = (item: MailReviewItem, quiet = false) => {
    if (!item.due) return null;
    const label = dueLabel(item.due, today, locale, t);
    return <span className={styles.due} data-urgent={label.urgent && !quiet}>{label.text}</span>;
  };
  const created = (item: MailReviewItem) => item.action !== "none"
    && <span className={styles.created}>✓ {t(`robin.gmail.action.${item.action}`)}</span>;
  // Shown on hover only: the whole card or row already opens the email.
  const opener = <span className={styles.opener} aria-hidden="true">↗</span>;
  const openHint = <span className="sr-only"> — {t("robin.gmail.openMail")}</span>;

  const setDone = async (id: string, done: boolean) => {
    setPending((current) => new Map(current).set(id, done));
    setActionError(null);
    try {
      await mutate("/api/robin/gmail", "PATCH", { id, done });
      await refresh();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPending((current) => {
        const next = new Map(current);
        next.delete(id);
        return next;
      });
    }
  };

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
            {review && <p className={styles.meta}>{t("robin.gmail.updated")} <time dateTime={review.reviewedAt}>{formatWhen(review.reviewedAt, locale, today, t)}</time></p>}
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
                    <div data-accent={all.act.length > 0}>
                      <dt>{all.act.length > 0 ? <a href="#mail-act">{t("robin.gmail.triage.act")}</a> : t("robin.gmail.triage.act")}</dt>
                      <span aria-hidden="true" className={sheet.leader} />
                      <dd>{all.act.length}</dd>
                    </div>
                    <div>
                      <dt><a href="#mail-tracked">{t("robin.gmail.triage.tracked")}</a></dt>
                      <span aria-hidden="true" className={sheet.leader} />
                      <dd>{all.tracked.length}</dd>
                    </div>
                    <div>
                      <dt><a href="#mail-fyi">{t("robin.gmail.triage.fyi")}</a></dt>
                      <span aria-hidden="true" className={sheet.leader} />
                      <dd>{all.fyi.length}</dd>
                    </div>
                    {review.skipped ? (
                      <div>
                        <dt>{t("robin.gmail.skipped")}</dt>
                        <span aria-hidden="true" className={sheet.leader} />
                        <dd>{review.skipped}</dd>
                      </div>
                    ) : null}
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
              </div>
            )}

            <div className={`${sheet.list} ${styles.list}`}>
              {data.connected && !review && !loading && (
                <section className={`pi-card ${styles.empty}`}>
                  <h2>{t("robin.gmail.emptyTitle")}</h2>
                  <p>{t("robin.gmail.empty")}</p>
                  {data.lastReviewedAt && (
                    <p className={styles.lastSeen}>
                      {t("robin.gmail.lastChecked", { when: formatWhen(data.lastReviewedAt, locale, today, t) })}
                    </p>
                  )}
                </section>
              )}

              {review && (review.items.length > 0 ? (
                <>
                  {/* The brief is the page's lede, not one more card: what the whole
                      review comes to, set on the paper before any single email. */}
                  <section className={styles.brief} aria-labelledby="mail-brief" data-clear={all.act.length === 0}>
                    <h2 id="mail-brief" className="pi-eyebrow">{t("robin.gmail.brief")}</h2>
                    <p className={styles.headline}>{headline}</p>
                    {handled > 0 && (
                      <p className={styles.progress}>
                        {t("robin.gmail.progress", { done: String(handled), left: String(all.act.length) })}
                      </p>
                    )}
                  </section>

                  {needle && (
                    <div className={styles.results}>
                      <p role="status">{t("robin.gmail.results", { count: String(visibleCount), total: String(review.items.length) })}</p>
                      <button type="button" className="ui-action" onClick={() => setQuery("")}>{t("robin.gmail.clearFilters")}</button>
                    </div>
                  )}
                  {needle && visibleCount === 0 && (
                    <div className={`pi-card ${styles.empty}`}><h2>{t("robin.gmail.noMatches")}</h2><p>{t("robin.gmail.noMatchesHint")}</p></div>
                  )}

                  {/* Hidden when empty: the brief already says so, in green. */}
                  {groups.act.length > 0 && (
                    <section id="mail-act" className={styles.group} aria-labelledby="mail-act-heading">
                      <h2 id="mail-act-heading" className={styles.groupTitle} data-triage="act">
                        {t("robin.gmail.triage.act")} <span>{groups.act.length}</span>
                      </h2>
                      <ul className={styles.cards}>
                        {groups.act.map((item) => {
                          const title = item.next || item.subject || t("robin.gmail.noSubject");
                          return (
                            <li key={item.id}>
                              {/* An article with a stretched link, not a link: the
                                  done button cannot live inside an <a>. */}
                              <article className={`pi-card ${styles.card}`} data-category={item.category}>
                                <div className={styles.cardTop}>
                                  <h3>
                                    <a href={gmailHref(item)} target="_blank" rel="noopener noreferrer" className={styles.stretch}>
                                      {title}{opener}{openHint}
                                    </a>
                                  </h3>
                                  {due(item)}
                                </div>
                                {(item.summary || item.snippet) && <p className={styles.summary}>{item.summary || item.snippet}</p>}
                                <div className={styles.cardFoot}>
                                  <div className={styles.mailMeta}>
                                    <span className={styles.tag} data-category={item.category}>{t(`robin.gmail.category.${item.category}`)}</span>
                                    <span className={styles.sender} title={`${item.from} — ${item.subject}`}>{senderName(item.from) || t("robin.gmail.unknownSender")}</span>
                                    <time dateTime={item.date}>{formatWhen(item.date, locale, today, t)}</time>
                                    {created(item)}
                                  </div>
                                  <div className={styles.cardActions}>
                                    <button
                                      type="button"
                                      className={`ui-action pi-bracket ${styles.doneButton}`}
                                      aria-label={t("robin.gmail.markDoneLabel", { title })}
                                      onClick={() => void setDone(item.id, true)}
                                    >
                                      {t("robin.gmail.markDone")}
                                    </button>
                                  </div>
                                </div>
                              </article>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  )}

                  {groups.tracked.length > 0 && (
                    <section id="mail-tracked" className={styles.group} aria-labelledby="mail-tracked-heading">
                      <h2 id="mail-tracked-heading" className={styles.groupTitle} data-triage="tracked">
                        {t("robin.gmail.triage.tracked")} <span>{groups.tracked.length}</span>
                        <em>{t("robin.gmail.trackedHint")}</em>
                      </h2>
                      <ul className={styles.rows}>
                        {groups.tracked.map((item) => {
                          const title = item.next || item.subject || t("robin.gmail.noSubject");
                          return (
                            <li key={item.id}>
                              <div className={styles.row} data-done={item.done === true}>
                                <a href={gmailHref(item)} target="_blank" rel="noopener noreferrer" className={`${styles.rowText} ${styles.stretch}`}>
                                  <strong>{title}{opener}</strong>
                                  <span>{item.summary || item.snippet}</span>
                                  {openHint}
                                </a>
                                <span className={styles.rowMeta}>
                                  {due(item, true)}
                                  {item.done ? (
                                    <>
                                      <span className={styles.created}>✓ {t("robin.gmail.doneBadge")}</span>
                                      <button
                                        type="button"
                                        className={`ui-action ${styles.undoButton}`}
                                        aria-label={t("robin.gmail.undoDoneLabel", { title })}
                                        onClick={() => void setDone(item.id, false)}
                                      >
                                        {t("robin.gmail.undoDone")}
                                      </button>
                                    </>
                                  ) : created(item)}
                                </span>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  )}

                  {groups.fyi.length > 0 && (
                    // FYI starts folded: reading it is optional by definition. A search opens it.
                    <details
                      id="mail-fyi"
                      className={styles.group}
                      open={fyiOpen || Boolean(needle)}
                      onToggle={(event) => setFyiOpen(event.currentTarget.open)}
                    >
                      <summary className={styles.groupTitle} data-triage="fyi">
                        {t("robin.gmail.triage.fyi")} <span>{groups.fyi.length}</span>
                        <em>{t("robin.gmail.fyiHint")}</em>
                      </summary>
                      <ul className={styles.rows}>
                        {groups.fyi.map((item) => (
                          <li key={item.id}>
                            <a href={gmailHref(item)} target="_blank" rel="noopener noreferrer" className={styles.row}>
                              <span className={styles.rowText}>
                                <span className={styles.fyiLine}>
                                  <b title={item.from}>{senderName(item.from) || t("robin.gmail.unknownSender")}</b>
                                  {item.summary || item.subject || item.snippet}
                                  {opener}
                                </span>
                                {openHint}
                              </span>
                            </a>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </>
              ) : (
                <section className={`pi-card ${styles.empty}`}><h2>{t("robin.gmail.noMail")}</h2><p>{review.headline || t("robin.gmail.noMailHint")}</p></section>
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

/** "Cartesia Hiring Team <no-reply@…>" → "Cartesia Hiring Team": the address is noise on a one-line row. */
function senderName(from: string): string {
  const name = from.replace(/<[^>]*>/, "").replace(/"/g, "").trim();
  return name || from;
}
