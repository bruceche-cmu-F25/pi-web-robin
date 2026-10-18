import { createHash } from "node:crypto";
import { fetchPageMetadata } from "@/extension/robin/fetch-title";
import { readIcon, storeIcon } from "@/extension/robin/icons";
import { listResearchProjects } from "@/extension/robin/research-domain";
import { linkKind } from "@/lib/research-link-kind";

export const dynamic = "force-dynamic";
const EXTENSIONS = ["png", "jpg", "webp", "gif", "ico"] as const;

/**
 * The icon of a research project's link, fetched once through the guarded favicon pipeline and served
 * from the local cache. Only URLs saved as project links are accepted, so this is not an open fetcher.
 */
export async function GET(req: Request) {
  const url = new URL(req.url).searchParams.get("url") ?? "";
  if (!listResearchProjects().projects.some((project) => project.links.some((link) => link.url === url))) return new Response(null, { status: 404 });
  const kind = linkKind(url);
  const cacheId = `rlink${createHash("sha256").update(kind.icon ?? kind.key).digest("hex").slice(0, 20)}`;
  let icon = EXTENSIONS.map((extension) => readIcon(cacheId, extension)).find(Boolean) ?? null;
  if (!icon) {
    let extension = kind.icon ? await storeIcon(cacheId, kind.icon) : null;
    if (!extension) {
      const metadata = await fetchPageMetadata(url).catch(() => ({ iconUrl: undefined as string | undefined }));
      extension = await storeIcon(cacheId, metadata.iconUrl ?? new URL("/favicon.ico", url).toString());
    }
    if (!extension) extension = await storeIcon(cacheId, `https://www.google.com/s2/favicons?domain=${encodeURIComponent(new URL(url).hostname)}&sz=64`);
    icon = extension ? readIcon(cacheId, extension) : null;
  }
  if (!icon) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(icon.body), { headers: { "Content-Type": icon.contentType, "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'", "Cache-Control": "private, max-age=86400" } });
}
