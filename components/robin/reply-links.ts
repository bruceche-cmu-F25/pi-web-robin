export type ReplySegment =
  | { type: "text"; value: string }
  | { type: "link"; value: string; href: string };

const URL_PATTERN = /https?:\/\/[^\s<>"'`，。！？；：、（）【】《》“”‘’]+/giu;
const TRAILING_PUNCTUATION = /[.,!?;:]+$/u;

/** Split assistant prose into safe plain-text and HTTP(S) link segments. */
export function splitReplyLinks(text: string): ReplySegment[] {
  const segments: ReplySegment[] = [];
  const pushText = (value: string) => {
    if (!value) return;
    const previous = segments.at(-1);
    if (previous?.type === "text") previous.value += value;
    else segments.push({ type: "text", value });
  };
  let cursor = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index;
    const raw = match[0];
    let href = raw.replace(TRAILING_PUNCTUATION, "");
    // Strip prose/Markdown delimiters, not balanced parentheses inside a real URL.
    const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
    while (href) {
      const last = href.at(-1)!, opening = pairs[last];
      if (!opening || href.split(last).length <= href.split(opening).length) break;
      href = href.slice(0, -1).replace(TRAILING_PUNCTUATION, "");
    }
    if (!href) continue;

    if (start > cursor) pushText(text.slice(cursor, start));
    segments.push({ type: "link", value: href, href });
    if (href.length < raw.length) pushText(raw.slice(href.length));
    cursor = start + raw.length;
  }

  if (cursor < text.length) pushText(text.slice(cursor));
  return segments;
}
