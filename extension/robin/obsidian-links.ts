/** Shared, deliberately small Obsidian link subset; no plugin execution or HTML evaluation. */
export interface VaultLink { target: string; label: string; start: number; end: number; wiki: boolean }

export function vaultLinks(markdown: string): VaultLink[] {
  // Mask code and comments without changing offsets. Links there are examples, not relationships.
  const masked = markdown.replace(/^( {0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\2[^\n]*(?:\n|$)/gm, (s) => " ".repeat(s.length))
    .replace(/<!--[^]*?-->/g, (s) => " ".repeat(s.length))
    .replace(/(`+)[^]*?\1/g, (s) => " ".repeat(s.length));
  const links: VaultLink[] = [];
  const pattern = /!?\[\[([^\]\n]+)\]\]|!?\[([^\]\n]*)\]\((<[^>\n]+>|[^\s)]+)(?:\s+"[^"\n]*")?\)/g;
  for (const match of masked.matchAll(pattern)) {
    const wiki = match[1] !== undefined;
    const [target, alias] = wiki ? match[1].split("|") : [match[3].replace(/^<|>$/g, ""), match[2]];
    if (!target || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) continue;
    links.push({ target, label: alias || target, start: match.index!, end: match.index! + match[0].length, wiki });
  }
  return links;
}

function normalizedPath(value: string): string | null {
  const parts: string[] = [];
  for (const part of value.split("/")) {
    if (part === "." || !part) continue;
    if (part === "..") { if (!parts.length) return null; parts.pop(); }
    else parts.push(part);
  }
  return parts.join("/");
}

/** Resolve exact/relative paths first. A duplicate short title is unresolved, never guessed. */
export function vaultLinkResolver(paths: readonly string[]) {
  const exact = new Set(paths);
  const shortNames = new Map<string, string | null>();
  for (const path of paths) {
    const name = path.split("/").at(-1)!;
    shortNames.set(name, shortNames.has(name) ? null : path);
  }
  return (source: string, target: string, wiki = true): string | null => {
    let decoded: string;
    try { decoded = decodeURIComponent(target.split("#")[0].split("?")[0]); } catch { return null; }
    if (!decoded) return target.startsWith("#") ? source : null;
    if (/^[a-z][a-z\d+.-]*:|^\/\/|[\\\p{Cc}]/iu.test(decoded)) return null;
    const withExtension = /\.md$/i.test(decoded) ? decoded : `${decoded}.md`;
    const folder = source.slice(0, source.lastIndexOf("/") + 1);
    const relative = normalizedPath(`${folder}${withExtension}`);
    const absolute = normalizedPath(withExtension);
    const candidates = wiki && !decoded.startsWith(".") ? [absolute, relative] : [relative, absolute];
    for (const candidate of candidates) if (candidate && exact.has(candidate)) return candidate;
    if (decoded.includes("/")) return null;
    return shortNames.get(withExtension) ?? null;
  };
}

/** Turn supported wikilinks into reader-local Markdown links; leave code untouched. */
export function vaultPreview(markdown: string): string {
  let result = markdown;
  for (const link of vaultLinks(markdown).filter((link) => link.wiki).reverse()) {
    const label = link.label.replace(/[\[\]\\]/g, "\\$&");
    result = result.slice(0, link.start) + `[${label}](?wiki=${encodeURIComponent(link.target)})` + result.slice(link.end);
  }
  return result;
}
