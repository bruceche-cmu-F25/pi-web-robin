"use client";

import { useContext, useEffect, useRef, useState } from "react";
import type { Link } from "@/extension/robin/links";
import { shelfLogo } from "@/extension/robin/shelf-logos";
import { ResourceActivity } from "./usePolledResource";

/** Both phone shortcuts and desktop links use the site's cached original icon. */
export function SavedLinkIcon({ link, size = 16 }: { link: Link; size?: number }) {
  let bundled: string | null = null;
  try { bundled = shelfLogo(new URL(link.url).host); } catch { /* No guessed brand for malformed URLs. */ }
  const cached = link.icon ? `/api/robin/links/icon/${encodeURIComponent(link.id)}?v=${encodeURIComponent(link.iconCheckedAt ?? "")}` : null;
  const [failed, setFailed] = useState<string[]>([]);
  const src = [cached, bundled].find((source): source is string => Boolean(source && !failed.includes(source)));
  if (src) return (
    // Already cached locally; an image optimisation proxy adds no value here.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" width={size} height={size} loading="lazy" decoding="async" referrerPolicy="no-referrer"
      data-link-icon="site" onError={() => setFailed(current => [...current, src])}
      className="site-mark" style={{ width: size, height: size, flexBasis: size }} />
  );
  // No invented brand or initial when the original image is unavailable.
  return <svg data-link-icon="fallback" aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ flexShrink: 0 }}>
    <circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" />
  </svg>;
}

/** Legacy links only: serial, once per address per mount; hidden panes do no work. */
export function useLinkIconBackfill(links: Link[], refresh: () => Promise<void>) {
  const active = useContext(ResourceActivity);
  const attempted = useRef(new Set<string>());
  const working = useRef(false);
  const [settled, setSettled] = useState(0);
  useEffect(() => {
    const pending = links.find(link => !link.iconCheckedAt && !attempted.current.has(`${link.id}:${link.url}`));
    if (!active || !pending || working.current) return;
    attempted.current.add(`${pending.id}:${pending.url}`);
    working.current = true;
    void fetch(`/api/robin/links/icon/${encodeURIComponent(pending.id)}`, { method: "POST" })
      .catch(() => {})
      .finally(() => {
        working.current = false;
        void refresh();
        // A failed lookup must not loop forever or block the remaining sites.
        setSettled(value => value + 1);
      });
  }, [active, links, refresh, settled]);
}
