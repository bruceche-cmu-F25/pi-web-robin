"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { learningShelf } from "@/extension/robin/study";
import { shelfLogo } from "@/extension/robin/shelf-logos";
import { iconFallback } from "@/extension/robin/links";
import { EVENT_COLOR_KEYS } from "@/extension/robin/eventColors";

/**
 * The reading list, in the groups it was collected in.
 *
 * Every row is a curriculum item, so the shelf and the roadmap can never
 * disagree about where a link points — but the arrangement is the original
 * one, because the two answer different questions. The rail answers "where
 * does this sit"; this answers "where was that thing", which is what you want
 * when you already know what you are looking for.
 *
 * Nothing here is marked read. It is a shelf: what is on it, and where it
 * points.
 *
 * Each heading takes one of the calendar's six hues, so the groups can be told
 * apart before they are read — on a page of identical grey cards, "the green
 * one" is how you find Python engineering twice as fast the second time. The
 * hue is by position rather than by a hash of the group id: this is a short,
 * hand-ordered list, so rotating the palette keeps neighbours distinct, which
 * hashing does not (three of the seven ids hash to the same slate). Reordering
 * the shelf reshuffles the colours, and that is fine — the colour is
 * recognition, not meaning, which is also why it stops at the label.
 */
export function LearningShelf() {
  const { t } = useI18n();
  const groups = useMemo(() => learningShelf(), []);

  return (
    <section
      style={{ columns: "300px", columnGap: "1rem" }}
      aria-label={t("learn.shelf.title")}
    >
      {groups.map((group, groupIndex) => {
        // --todo-* for the type, --event-* for the rule: the event hues are
        // washes tuned to sit behind a chip, and the todo set is the same six
        // families held at the contrast that reads as text.
        const hue = EVENT_COLOR_KEYS[groupIndex % EVENT_COLOR_KEYS.length];
        return (
          <section
            key={group.id}
            className="pi-card mb-4 flex w-full break-inside-avoid flex-col gap-2 p-4"
          >
            <h2
              className="pi-label"
              style={{ fontSize: 11, color: `var(--todo-${hue})`, borderLeftColor: `var(--event-${hue})` }}
            >
              {t(`learn.shelf.${group.id}`)}
            </h2>
            <ul className="flex flex-col">
              {group.entries.map((entry, index) => {
                return (
                  // Keyed by position as well as id: a resource can earn a place
                  // twice on the shelf, once whole and once at a section anchor.
                  <li key={`${entry.item.id}-${index}`}>
                    <a
                      href={entry.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ui-action flex items-baseline gap-2 py-1"
                      style={{ textDecoration: "none", color: "var(--text)" }}
                      title={entry.item.hint ?? entry.url}
                    >
                      <SiteMark url={entry.url} />
                      {/* Wraps rather than truncates. These titles are long and
                          the columns are narrow, and a shelf whose labels end in
                          an ellipsis is one you have to hover to read. */}
                      <span className="min-w-0 flex-1" style={{ fontSize: 12.5, lineHeight: 1.35 }}>
                        {entry.item.title}
                      </span>
                      {/* The host, the way the list was written: it is how you
                          recognise a link you have opened a hundred times. */}
                      <span
                        className="pi-eyebrow shrink-0"
                        style={{ fontSize: 9, color: "var(--text-dim)" }}
                      >
                        {hostOf(entry.url)}
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </section>
  );
}

/**
 * The site's own icon, or a letter tile when it has none.
 *
 * Follows the saved-links panel, down to the fallback tile — two lists of
 * links in the same app should not have two ideas of what a link looks like.
 * What differs is where the bytes come from: a saved link is
 * whatever the user pasted, so its icon is fetched and cached per link at
 * runtime, while the shelf is fixed reference data, so its icons are fetched
 * once by scripts/refresh-shelf-logos.mjs and committed. Either way the
 * browser only ever asks this origin — a favicon pulled from the site itself
 * would announce, every time the Learning Hub opens, exactly what is on the
 * shelf, and a favicon proxy makes that one company's business instead of
 * twenty-three.
 */
function SiteMark({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  // The manifest is keyed by the real host, `www.` and all, because that is
  // what was asked for the icon. Only the label beside it drops the prefix.
  const src = shelfLogo(fullHostOf(url));

  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        width={16}
        height={16}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className="site-mark"
      />
    );
  }

  const { letter, hue } = iconFallback({ title: hostOf(url), url });
  return (
    <span
      aria-hidden
      className="site-mark flex items-center justify-center text-[10px]"
      style={{ background: `hsl(${hue} 22% 42%)`, color: "var(--pi-moonstone)" }}
    >
      {letter}
    </span>
  );
}

/**
 * The host, as the site spells it.
 *
 * Never throws — the URLs are ours, but this is chrome and chrome should not
 * be able to blank a page.
 */
function fullHostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

/**
 * Bare host, for the trailing label.
 *
 * `www.` comes off: it is four characters of no information in a column that
 * is already competing with the title for room.
 */
function hostOf(url: string): string {
  return fullHostOf(url).replace(/^www\./, "");
}
