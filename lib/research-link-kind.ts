/**
 * Client-safe: what service a project link points at, so the workspace can label it ("Google Sheets")
 * and the icon route can fetch that service's own icon rather than a generic docs.google.com one.
 */
export interface LinkKind { key: string; label: string; icon: string | null }
const KINDS: Array<{ test: (url: URL) => boolean; kind: LinkKind }> = [
  { test: (u) => u.hostname === "github.com", kind: { key: "github", label: "GitHub", icon: "https://github.com/favicon.ico" } },
  { test: (u) => u.hostname === "docs.google.com" && u.pathname.startsWith("/spreadsheets"), kind: { key: "sheets", label: "Google Sheets", icon: "https://ssl.gstatic.com/docs/spreadsheets/favicon3.ico" } },
  { test: (u) => u.hostname === "docs.google.com" && u.pathname.startsWith("/document"), kind: { key: "docs", label: "Google Docs", icon: "https://ssl.gstatic.com/docs/documents/images/kix-favicon7.ico" } },
  { test: (u) => u.hostname === "docs.google.com" && u.pathname.startsWith("/presentation"), kind: { key: "slides", label: "Google Slides", icon: "https://ssl.gstatic.com/docs/presentations/images/favicon5.ico" } },
  { test: (u) => u.hostname === "drive.google.com", kind: { key: "drive", label: "Google Drive", icon: "https://ssl.gstatic.com/images/branding/product/1x/drive_2020q4_32dp.png" } },
  { test: (u) => u.hostname === "arxiv.org", kind: { key: "arxiv", label: "arXiv", icon: null } },
  { test: (u) => u.hostname.endsWith("notion.so") || u.hostname.endsWith("notion.site"), kind: { key: "notion", label: "Notion", icon: null } },
  { test: (u) => u.hostname === "www.overleaf.com" || u.hostname === "overleaf.com", kind: { key: "overleaf", label: "Overleaf", icon: null } },
  { test: (u) => u.hostname === "wandb.ai", kind: { key: "wandb", label: "Weights & Biases", icon: null } },
  { test: (u) => u.hostname === "huggingface.co", kind: { key: "huggingface", label: "Hugging Face", icon: null } },
];
export function linkKind(url: string): LinkKind {
  try {
    const parsed = new URL(url);
    const known = KINDS.find((entry) => entry.test(parsed));
    if (known) return known.kind;
    const host = parsed.hostname.replace(/^www\./, "");
    return { key: host, label: host, icon: null };
  } catch {
    return { key: "link", label: "Link", icon: null };
  }
}
/** A GitHub link's title is usually owner/repo; the repo name alone reads better on a chip. */
export function linkTitle(title: string, url: string): string {
  return linkKind(url).key === "github" && /^[\w.-]+\/[\w.-]+$/.test(title) ? title.split("/")[1] : title;
}
