"use client";

import { useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { sessionDeepLink } from "@/lib/session-links";
import type { SessionReviewItem, SessionReviewsResponse } from "@/lib/session-reviews";
import { mutateResponse, type PolledResource } from "./usePolledResource";
import styles from "./ChatReviews.module.css";

export function ChatReviews({ resource }: { resource: PolledResource<SessionReviewsResponse> }) {
  const { t } = useI18n();
  const section = useRef<HTMLElement>(null);
  const inFlight = useRef(new Set<string>());
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const reviews = resource.data?.reviews ?? [];

  async function accept(review: SessionReviewItem, destination?: string) {
    if (inFlight.current.has(review.id)) return;
    const opener = document.activeElement;
    const ownsFocus = opener instanceof HTMLElement && opener.closest("[data-review-id]")?.getAttribute("data-review-id") === review.id;
    inFlight.current.add(review.id); setSaving(new Set(inFlight.current)); setError(null);
    try {
      await mutateResponse("/api/sessions/reviews", "POST", { id: review.id, entryId: review.entryId });
      // A poll may already have delivered another reply from this chat.
      resource.updateData(current => current && { reviews: current.reviews.filter(item => item.id !== review.id || item.entryId !== review.entryId) });
      if (destination) { window.location.assign(destination); return; }
      if (ownsFocus) requestAnimationFrame(() => {
        if (document.hasFocus() && document.activeElement === document.body && !section.current?.closest("[hidden]")) section.current?.focus({ preventScroll: true });
      });
    } catch {
      setError(t("daily.reviews.saveFailed"));
    } finally {
      inFlight.current.delete(review.id); setSaving(new Set(inFlight.current));
      void resource.refresh();
    }
  }
  const row = (review: SessionReviewItem) => <ReviewRow key={`${review.id}:${review.entryId}`} review={review} saving={saving.has(review.id)} onAccept={() => void accept(review)} onOpen={href => void accept(review, href)} />;
  return <section ref={section} id="dashboard-chat-reviews" className={styles.section} aria-labelledby="chat-reviews-title" aria-describedby={reviews.length ? "chat-reviews-hint" : undefined} tabIndex={-1}>
    <header><h2 id="chat-reviews-title" className="pi-section-title">{t("daily.reviews.title")}</h2>
      <span role="status" aria-atomic="true" className={styles.meta}>{resource.error ? t("daily.reviews.stale") : resource.loading ? t("robin.common.loading") : t("daily.reviews.count", { count: String(reviews.length) })}</span>
    </header>
    {reviews.length > 0 ? <>
      <p id="chat-reviews-hint" className="sr-only">{t("daily.reviews.hint")}</p>
      <ul className={styles.list}>{reviews.slice(0, 3).map(row)}</ul>
      {reviews.length > 3 && <details><summary className="ui-action">{t("daily.reviews.more", { count: String(reviews.length - 3) })}</summary><ul className={styles.list}>{reviews.slice(3).map(row)}</ul></details>}
    </> : !resource.loading && !resource.error && <p className={styles.hint}>{t("daily.reviews.empty")}</p>}
    {(error || resource.error) && <div className={styles.error} role="alert"><span>{error ?? t("daily.reviews.loadFailed")}</span><button type="button" className="ui-action" onClick={() => void resource.refresh()}>{t("daily.retry")}</button></div>}
  </section>;
}

function ReviewRow({ review, saving, onAccept, onOpen }: { review: SessionReviewItem; saving: boolean; onAccept: () => void; onOpen: (href: string) => void }) {
  const { t, locale } = useI18n();
  const href = `/${sessionDeepLink(review.id)}`;
  return <li className={styles.swipeRow} data-review-id={review.id}>
    <a href={href} className="ui-action" title={review.title} draggable={false} aria-describedby="chat-reviews-hint" aria-busy={saving} onClick={event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      onOpen(href);
    }}>
      <span className={styles.copy}><span className={styles.title}>{review.title}</span>
        <span className={styles.meta}><span className={styles.project} title={review.cwd}>{review.cwd.replace(/[\\/]+$/, "").split(/[\\/]/).pop()}</span>
          <time dateTime={new Date(review.completedAt).toISOString()}>{new Date(review.completedAt).toLocaleString(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time></span>
      </span>
      <span className={styles.readyDot} aria-hidden="true" />
    </a>
    <button type="button" className={`ui-action ${styles.notedButton}`} disabled={saving} aria-busy={saving} aria-label={t("daily.reviews.acceptTitle", { title: review.title })} onClick={onAccept}>
      {t(saving ? "daily.reviews.saving" : "daily.reviews.accept")}
    </button>
  </li>;
}
