/**
 * Where a todo points when nobody has set a link on it.
 *
 * Most todos already say where they live — a course number means Canvas, a
 * mention of email means the inbox, and some titles carry the address outright.
 * Reading that out of the title costs nothing and covers todos written long
 * before links existed, so the panel infers rather than backfilling a `url`
 * onto every stored todo.
 *
 * An explicit `url` always wins: inference is a default, never an override.
 *
 * Pure logic only — no node builtins. The dashboard imports this into client
 * components, where a `node:fs` anywhere in the graph fails the browser bundle.
 */
import { normalizeUrl } from "./links.ts";

/** Canvas has no course-number → course-id route, so this lands on the list. */
export const CANVAS_COURSES_URL = "https://canvas.cmu.edu/courses";
export const GMAIL_INBOX_URL = "https://mail.google.com/mail/u/0/#inbox";

/** Stops at CJK punctuation, which is not part of the address but sits against it. */
const URL_IN_TITLE = /https?:\/\/[^\s"'<>）)】\]，。、；]+/;
const EMAIL_IN_TITLE = /[\w.!#$%&'*+/=?^`{|}~-]+@[\w-]+(?:\.[\w-]+)+/;
/**
 * A CMU course number: five digits, sometimes hyphenated (14-848) and sometimes
 * carrying a section (14757-SV). The guards on both ends keep it from biting a
 * phone number, a date, or a longer digit run.
 */
const COURSE_NUMBER = /(?<![\d-])\d{2}-?\d{3}(?!\d)/;
const EMAIL_WORDS = /邮件|邮箱|回信|发信|e-?mail|\bmail\b|\binbox\b/i;

/** The link a title implies, or undefined when it implies nothing. */
export function inferTodoUrl(title: string): string | undefined {
  const inTitle = URL_IN_TITLE.exec(title);
  if (inTitle) {
    try {
      return normalizeUrl(inTitle[0]);
    } catch {
      // A malformed address in the title just means the later rules decide.
    }
  }

  const address = EMAIL_IN_TITLE.exec(title);
  if (address) return `mailto:${address[0]}`;
  if (COURSE_NUMBER.test(title)) return CANVAS_COURSES_URL;
  if (EMAIL_WORDS.test(title)) return GMAIL_INBOX_URL;
  return undefined;
}

/** Where a todo opens: what was set on it, otherwise what its title implies. */
export function todoUrl(todo: { title: string; url?: string }): string | undefined {
  return todo.url ?? inferTodoUrl(todo.title);
}
