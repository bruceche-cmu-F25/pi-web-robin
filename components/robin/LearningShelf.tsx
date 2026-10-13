"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import Image from "next/image";
import { LEARNING_SHELF, shelfPreviewFile, type ShelfLink } from "@/extension/robin/learning-shelf";
import { shelfLogo } from "@/extension/robin/shelf-logos";
import { iconFallback } from "@/extension/robin/links";
import { EVENT_COLOR_KEYS } from "@/extension/robin/eventColors";

/**
 * The reading list, in the groups it was collected in.
 *
 * Full-width chapters make the purpose of each group and every destination
 * visible at once. Nothing here is marked read; it is a shelf, not a syllabus.
 * Each chapter's rule takes one of the calendar hues for quick recognition,
 * never to encode progress or priority.
 */
export function LearningShelf() {
  const { t } = useI18n();

  return (
    <section className="flex flex-col gap-5" aria-labelledby="learn-shelf-title">
      <header className="mb-1 flex flex-col gap-2">
        <h2 id="learn-shelf-title" className="text-2xl italic" style={{ color: "var(--text)" }}>
          {t("learn.shelf.title")}
        </h2>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>{t("learn.shelf.intro")}</p>
      </header>
      {LEARNING_SHELF.map((group, groupIndex) => {
        const hue = EVENT_COLOR_KEYS[groupIndex % EVENT_COLOR_KEYS.length];
        const videoListed = group.links.some((entry) => entry.url === group.preview?.url);
        return (
          <section key={group.id} className="pi-card flex flex-col gap-5 p-5 desktop:p-7" aria-labelledby={`shelf-${group.id}`}>
            <header className="border-l-4 pl-4" style={{ borderColor: `var(--todo-${hue})` }}>
              <h3 id={`shelf-${group.id}`} className="text-2xl italic" style={{ color: "var(--text)" }}>
                {t(`learn.shelf.${group.id}`)}
              </h3>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
                {t(`learn.shelf.${group.id}.purpose`)}
              </p>
            </header>
            <ul className="grid min-w-0 gap-4 desktop:grid-cols-2 min-[1100px]:grid-cols-3">
              {group.preview && !videoListed && (
                <ShelfRow
                  entry={{ url: group.preview.url, title: t(`learn.shelf.${group.id}.preview`) }}
                  image={group.preview.image}
                  note={t(`learn.shelf.${group.id}.previewNote`)}
                  video
                />
              )}
              {group.links.map((entry, index) => {
                const video = entry.url === group.preview?.url;
                return (
                  <ShelfRow
                    key={`${entry.url}-${index}`}
                    entry={entry}
                    image={video ? group.preview!.image : `/robin/previews/${shelfPreviewFile(group.id, entry.url)}`}
                    note={video ? t(`learn.shelf.${group.id}.previewNote`) : undefined}
                    title={video ? t(`learn.shelf.${group.id}.preview`) : undefined}
                    video={video}
                  />
                );
              })}
            </ul>
          </section>
        );
      })}
    </section>
  );
}

function ShelfRow({ entry, image, title, note, video = false }: {
  entry: ShelfLink;
  image: string;
  title?: string;
  note?: string;
  video?: boolean;
}) {
  return (
    <li className="flex min-w-0">
      <a
        href={entry.url}
        target="_blank"
        rel="noopener noreferrer"
        className="ui-action ui-action--card flex w-full min-w-0 flex-col overflow-hidden"
        style={{ textDecoration: "none", color: "var(--text)" }}
        title={entry.hint ?? entry.url}
      >
        <ShelfPreview entry={entry} image={image} video={video} />
        <span className="flex w-full flex-1 flex-col gap-2 px-4 py-3">
          <span className="flex items-start gap-2">
            <SiteMark url={entry.url} />
            <span className="min-w-0 flex-1 text-base leading-snug">{title ?? entry.title}</span>
            <span aria-hidden="true" className="shrink-0" style={{ color: "var(--accent)" }}>↗</span>
          </span>
          {note && <span className="text-sm" style={{ color: "var(--text-muted)" }}>{note}</span>}
          <span className="pi-eyebrow mt-auto text-xs" style={{ color: "var(--text-muted)" }}>{hostOf(entry.url)}</span>
        </span>
      </a>
    </li>
  );
}

function ShelfPreview({ entry, image, video }: { entry: ShelfLink; image: string; video: boolean }) {
  const { t } = useI18n();
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  // The dev watcher creates a missing still after the card first appears.
  // Retry a few times so it replaces the site-info fallback without a reload.
  useEffect(() => {
    if (!failed || retry >= 4) return;
    const timer = setTimeout(() => {
      setFailed(false);
      setRetry((count) => count + 1);
    }, 4000 * (retry + 1));
    return () => clearTimeout(timer);
  }, [failed, retry]);

  return (
    <span className="relative block w-full overflow-hidden" style={{ background: "var(--bg-deep)", aspectRatio: "16 / 9" }}>
      {!ready && (
        <span className="absolute inset-0 flex flex-col justify-end gap-2 p-5" style={{ color: "var(--text)" }}>
          <span className="text-lg">{hostOf(entry.url)}</span>
          <span className="pi-eyebrow text-xs" style={{ color: "var(--text-muted)" }}>{t("learn.shelf.sitePreview")}</span>
        </span>
      )}
      <Image
        src={retry ? `${image}?retry=${retry}` : image}
        alt=""
        width={560}
        height={315}
        sizes="(max-width: 640px) 100vw, (max-width: 1100px) 50vw, 33vw"
        className="absolute inset-0 block h-full w-full object-cover"
        style={{ opacity: ready ? 1 : 0 }}
        onLoad={() => setReady(true)}
        onError={() => { setReady(false); setFailed(true); }}
        unoptimized
      />
      {video && <span aria-hidden="true" className="absolute bottom-3 right-3 border px-3 py-2 text-lg" style={{ background: "var(--bg-panel)", borderColor: "var(--border)", color: "var(--text)" }}>▶</span>}
    </span>
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
