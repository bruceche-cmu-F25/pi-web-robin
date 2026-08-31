import { createHash } from "node:crypto";
import { fetchPageMetadata } from "@/extension/robin/fetch-title";
import { readIcon, storeIcon } from "@/extension/robin/icons";
import {
  PRIOR_WORK_READINGS,
  PROGRESS_SHEET,
  PROJECT_DRIVE,
  PROJECT_REPOSITORY,
  RESEARCH_READINGS,
  STATUS_REPORT,
} from "@/extension/robin/research";

export const dynamic = "force-dynamic";

const EXTENSIONS = ["png", "jpg", "webp", "gif", "ico"] as const;
const readings = [
  PROJECT_REPOSITORY,
  PROGRESS_SHEET,
  PROJECT_DRIVE,
  STATUS_REPORT,
  ...RESEARCH_READINGS,
  ...PRIOR_WORK_READINGS,
];

function cachedIcon(cacheId: string) {
  for (const extension of EXTENSIONS) {
    const icon = readIcon(cacheId, extension);
    if (icon) return icon;
  }
  return null;
}

function iconResponse(icon: NonNullable<ReturnType<typeof cachedIcon>>) {
  return new Response(new Uint8Array(icon.body), {
    headers: {
      "Content-Type": icon.contentType,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "Cache-Control": "private, max-age=86400",
    },
  });
}

/** Fetch once through the dashboard's guarded favicon pipeline, then serve locally. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const reading = readings.find((entry) => entry.id === id);
  if (!reading) return new Response(null, { status: 404 });

  const cacheId = `research${createHash("sha256").update(reading.url).digest("hex").slice(0, 20)}`;
  const cached = cachedIcon(cacheId);
  if (cached) return iconResponse(cached);

  const metadata = await fetchPageMetadata(reading.url);
  const iconUrl = metadata.iconUrl ?? new URL("/favicon.ico", reading.url).toString();
  let extension = await storeIcon(cacheId, iconUrl);
  if (!extension) {
    // These hosts are public, hard-coded research sources—not private saved links.
    // A server-side fallback covers publishers that expose only SVG or block /favicon.ico;
    // the result is still cached locally, so the browser never contacts the icon service.
    const host = new URL(reading.url).hostname;
    extension = await storeIcon(
      cacheId,
      `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`,
    );
  }
  const icon = extension ? readIcon(cacheId, extension) : null;
  return icon ? iconResponse(icon) : new Response(null, { status: 404 });
}
