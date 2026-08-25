/**
 * Markdown → Telegram HTML, and chunking that survives it.
 *
 * The model writes Markdown; Telegram renders a small HTML subset and nothing
 * else. Sent raw, a reply arrives as literal asterisks and hash marks, which is
 * how it read on the phone before this module existed.
 *
 * Pure — no I/O — so the conversions that are easy to get subtly wrong (a `**`
 * inside a code span, a chunk boundary landing between `<` and `b>`) are tested
 * directly.
 *
 * ## Why HTML and not MarkdownV2
 *
 * MarkdownV2 requires escaping sixteen characters *including inside* a link's
 * text, and one missed escape is a 400 rather than a cosmetic flaw. HTML needs
 * three characters escaped. The bridge also falls back to plain text when
 * Telegram rejects a message, which needs a way back out of whatever was
 * produced — trivial from HTML, guesswork from MarkdownV2.
 */

/** Telegram rejects messages longer than this. */
export const MAX_MESSAGE_LENGTH = 4096;

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Escape a URL for an `href` attribute, or refuse it.
 *
 * Only http(s), mailto and tg links survive. A `javascript:` href is inert
 * inside Telegram today, but a link the user taps is the wrong place to find
 * out whether that stays true.
 */
function safeHref(raw: string): string | null {
  const url = raw.trim();
  if (!/^(https?:\/\/|mailto:|tg:\/\/)/i.test(url)) return null;
  return escapeHtml(url).replace(/"/g, "&quot;");
}

/**
 * A sentinel for held-back HTML. Private-use area: no Markdown produces it and
 * no escaping creates it, so a document containing one cannot forge a slot.
 */
const MARK = "\uE000";

/**
 * Convert one line's inline Markdown.
 *
 * Code spans and links come out first and go back last: everything between
 * backticks is literal, so `**bold**` inside one must survive as four
 * asterisks, and a URL must not be chewed into entities on its way through.
 */
function inlineMarkdown(line: string): string {
  const held: string[] = [];
  const hold = (html: string): string => `${MARK}${held.push(html) - 1}${MARK}`;

  let text = line.replace(/`([^`]+)`/g, (_match, code: string) =>
    hold(`<code>${escapeHtml(code)}</code>`));

  text = text.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (match, label: string, url: string) => {
    const href = safeHref(url);
    // A link we will not render is still text the user wrote; keep it visible
    // rather than dropping it silently.
    if (!href) return match;
    return hold(`<a href="${href}">${escapeHtml(label) || href}</a>`);
  });

  // Everything left is literal text.
  text = escapeHtml(text);

  // Emphasis, longest marker first so `**` is never read as two `*`.
  text = text
    .replace(/\*\*\*(.+?)\*\*\*/g, "<b><i>$1</i></b>")
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/__(.+?)__/g, "<b>$1</b>")
    .replace(/~~(.+?)~~/g, "<s>$1</s>")
    // Single `*`/`_` only when it wraps something and is not mid-word: `a_b_c`
    // is an identifier far more often than it is emphasis.
    .replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=$|[\s.,;:!?)])/g, "$1<i>$2</i>")
    .replace(/(^|[\s(])_([^_\s][^_]*?)_(?=$|[\s.,;:!?)])/g, "$1<i>$2</i>");

  return text.replace(new RegExp(`${MARK}(\\d+)${MARK}`, "g"), (_match, index: string) =>
    held[Number(index)] ?? "");
}

/**
 * Convert a Markdown reply to the HTML subset Telegram renders.
 *
 * Block structure is flattened, not reproduced: Telegram has no headings and no
 * nested lists, so a heading becomes a bold line and every bullet becomes `•`.
 * Trying to preserve more produces a messier message, not a richer one.
 */
export function toTelegramHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let fence: string | null = null;
  let fenceLanguage: string | null = null;
  let fenced: string[] = [];

  const flushFence = () => {
    const body = escapeHtml(fenced.join("\n"));
    const attribute = fenceLanguage ? ` class="language-${fenceLanguage}"` : "";
    out.push(`<pre><code${attribute}>${body}</code></pre>`);
    fenced = [];
    fenceLanguage = null;
  };

  for (const raw of lines) {
    const fenceMatch = /^\s*(```|~~~)\s*([\w+#.-]*)\s*$/.exec(raw);
    if (fence !== null) {
      if (fenceMatch && fenceMatch[1] === fence) {
        flushFence();
        fence = null;
        continue;
      }
      fenced.push(raw);
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1] ?? "```";
      fenceLanguage = fenceMatch[2] || null;
      continue;
    }

    const line = raw.trimEnd();

    // Telegram has no <hr>, and a row of dashes already reads as one.
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      out.push("──────────");
      continue;
    }

    const heading = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      out.push(`<b>${inlineMarkdown(heading[2] ?? "")}</b>`);
      continue;
    }

    const quote = /^\s{0,3}>\s?(.*)$/.exec(line);
    if (quote) {
      out.push(`<blockquote>${inlineMarkdown(quote[1] ?? "")}</blockquote>`);
      continue;
    }

    // Bullets keep their indentation as spaces; Telegram has no nested list.
    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      out.push(`${bullet[1] ?? ""}• ${inlineMarkdown(bullet[2] ?? "")}`);
      continue;
    }

    out.push(inlineMarkdown(line));
  }

  // An unterminated fence still has to render; treat the rest as code.
  if (fence !== null) flushFence();

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Strip the HTML back out, for the plain-text retry.
 *
 * Telegram answers a malformed entity with a 400 and delivers nothing, so the
 * bridge needs a version it can always send. Losing the formatting beats losing
 * the message.
 */
export function stripTelegramHtml(html: string): string {
  return html
    .replace(/<a href="([^"]*)"[^>]*>([^<]*)<\/a>/g, (_match, href: string, label: string) =>
      label && label !== href ? `${label} (${href})` : href)
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

/** Where a cut would land inside `<…>` or `&…;`, back up to before it. */
function safeCut(text: string, limit: number): number {
  const tagStart = text.lastIndexOf("<", limit - 1);
  if (tagStart !== -1) {
    const tagEnd = text.indexOf(">", tagStart);
    if (tagEnd === -1 || tagEnd >= limit) return tagStart;
  }
  const entityStart = text.lastIndexOf("&", limit - 1);
  if (entityStart !== -1) {
    const entityEnd = text.indexOf(";", entityStart);
    if (entityEnd === -1 || entityEnd >= limit) {
      // Only back up for something that could plausibly be an entity; a bare
      // ampersand in prose must not drag the cut to the start of the line.
      if (limit - entityStart <= 10) return entityStart;
    }
  }
  return limit;
}

/**
 * Split an HTML reply into sendable messages.
 *
 * Line boundaries are preferred, and a `<pre>` block straddling a boundary is
 * closed and reopened — a chunk ending mid-block is a 400 from Telegram, not a
 * cosmetic problem. Every other tag this module emits lives on one line, so
 * nothing else can straddle.
 */
export function chunkHtml(html: string, limit = MAX_MESSAGE_LENGTH): string[] {
  if (html.length <= limit) return [html];

  const OPEN = "<pre><code>";
  const CLOSE = "</code></pre>";
  const chunks: string[] = [];

  /** Body of the chunk being built, without the reopening prefix. */
  let current = "";
  /** This chunk continues a code block, so it must start by reopening one. */
  let carried = false;
  /** Whether a code block is open at the end of the last completed line. */
  let inPre = false;

  /**
   * Close off the chunk. `endsInPre` says whether it stops inside a code block,
   * which is both what gets appended here and what the next chunk reopens.
   */
  const emit = (endsInPre: boolean) => {
    if (current) {
      chunks.push((carried ? OPEN : "") + current + (endsInPre ? CLOSE : ""));
      current = "";
    }
    carried = endsInPre;
  };

  for (const line of html.split("\n")) {
    const opens = line.includes("<pre>");
    const closes = line.includes("</pre>");
    // Splitting *within* this line happens inside a block if one is open by
    // then; what carries past the line is what `closes` decides.
    const preDuring: boolean = inPre || opens;
    const preAfter: boolean = closes ? false : preDuring;

    // Prefer a line boundary: flush a chunk that cannot take this line whole
    // before resorting to cutting the line up.
    const overhead = (carried ? OPEN.length : 0) + (preAfter ? CLOSE.length : 0);
    if (current && overhead + current.length + 1 + line.length > limit) emit(inPre);

    let rest = line;
    for (;;) {
      const separator = current ? 1 : 0;
      const prefix = carried ? OPEN.length : 0;
      const roomIfLast = limit - prefix - current.length - separator - (preAfter ? CLOSE.length : 0);
      if (rest.length <= roomIfLast) {
        current += (separator ? "\n" : "") + rest;
        break;
      }
      const room = limit - prefix - current.length - separator - (preDuring ? CLOSE.length : 0);
      if (room > 0) {
        // safeCut can back right up when a tag is enormous; take one character
        // anyway rather than looping forever on no progress.
        const cut = Math.max(safeCut(rest, room), 1);
        current += (separator ? "\n" : "") + rest.slice(0, cut);
        rest = rest.slice(cut);
      }
      emit(preDuring);
    }
    inPre = preAfter;
  }

  emit(inPre);
  return chunks;
}
