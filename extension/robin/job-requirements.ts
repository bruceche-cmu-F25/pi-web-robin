/**
 * Reading a job posting's text: what it says, before anything decides about it.
 *
 * Pure string work with no store, no Job type, and no policy — which is why it
 * sits here rather than in `jobs.ts`. `job-evidence.ts` needs these parsers and
 * `jobs.ts` needs `job-evidence.ts`, so leaving them together made the two
 * modules import each other in a cycle.
 */

/** Store the posting, not the display summary. Oversize text stays visibly incomplete. */
export function cleanPostingDescription(raw: string): string {
  const text = raw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (entity, code: string) => {
      const point = code[0]?.toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    })
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&(?:apos|rsquo|lsquo);/g, "'").replace(/&quot;/g, '"')
    .replace(/&[nm]dash;/g, "–")
    .replace(/\s+/g, " ").trim();
  // ponytail: bounded local archive, not a document store. The ellipsis keeps
  // the high-score gate closed if an exceptional posting exceeds this bound.
  return text.length > 100_000 ? `${text.slice(0, 100_000)}…` : text;
}

/* ────────────────── years of experience ────────────────── */

/**
 * Phrases that make a number nearby mean "experience wanted" rather than
 * anything else a job ad counts in years.
 */
const EXPERIENCE_CONTEXT =
  /experience|expertise|background|industry|professional|working|worked|build|building|develop|engineering|software|track record|hands[- ]on|relevant|similar role|in the field/i;

/**
 * Phrases that make the same number mean something else entirely.
 *
 * "Founded in the last 3 years", "doubled revenue over the past 5 years",
 * "in 2 years you will own the platform" — all common in the company
 * boilerplate that sits directly above the requirements, and all good for a
 * confident, wrong number.
 */
const NOT_A_REQUIREMENT = /\b(?:last|past|next|ago|within|since|over the|founded|history|first)\s*$/i;

/**
 * A nested sub-requirement, which is a slice of the bar rather than the bar.
 *
 * "8+ years of engineering experience, including 2+ years managing" states one
 * requirement, not two, and the 2 is the part that is already inside the 8.
 *
 * A bare "with" used to count as nesting too, and it cost far more than the
 * rule earns: "a strong engineer with 5+ years of experience" is the commonest
 * way a posting states its bar at all, and reading it as nested threw the
 * requirement away — 18 of 530 stored postings said five, six or eight years
 * and came out with no figure. The nesting sense of "with" only appears after
 * a comma ("8+ years of backend experience, with 3+ years in Go"), and there
 * the inner figure is smaller than the one containing it by construction,
 * which the maximum below already discards.
 */
const NESTED = /\b(?:includ\w+|of which)\s*$/i;

/** Wishlist framing. A number here is not something the candidate must clear. */
const OPTIONAL = /\b(?:preferred|a plus|bonus|nice[- ]to[- ]have|ideally|desirable|advantageous|would be great)\b/i;

/**
 * A heading that reopens the hard requirements after a wishlist section.
 *
 * Without it, a posting laid out as "Preferred qualifications … Requirements:
 * 3+ years" loses its real bar to the heading two paragraphs above it.
 */
const REQUIRED_AGAIN = /\b(?:required|requirements|must have|minimum qualification|basic qualification)\b/i;

/** Index just past the last match of `pattern`, or 0 when there is none. */
function lastMatchEnd(text: string, pattern: RegExp): number {
  const scan = new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`);
  let end = 0;
  for (let match = scan.exec(text); match; match = scan.exec(text)) end = match.index + match[0].length;
  return end;
}

/** Text up to the first clause break — where a trailing "preferred" stops applying. */
function firstClause(text: string): string {
  return text.split(/[;.\n•]|\s[-–]\s/)[0]?.slice(0, 60) ?? "";
}

/**
 * The years of experience a posting actually requires, or null.
 *
 * The MAXIMUM of the required figures, not the minimum — a candidate has to
 * clear every bar the posting sets, so a role wanting "5 years of engineering"
 * and "2 years in payments" wants five, and reporting two would wave through
 * exactly the applications this number exists to stop. Preferred-qualification
 * figures are excluded for the mirror-image reason: "3+ required, 7+
 * preferred" wants three.
 *
 * Ranges read as their lower bound ("2-4 years" → 2), because that is the
 * number the employer will actually screen on.
 *
 * Deliberately conservative: it returns null rather than a shaky number,
 * because null hands the judgement back to the scorer while a wrong number
 * silently gates a job out. Every match must sit next to a word from
 * EXPERIENCE_CONTEXT and must survive all three exclusions.
 */
export function extractYearsRequired(description: string): number | null {
  if (!description) return null;
  description = cleanPostingDescription(description);
  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  description = description.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten)(?=\s*(?:\+|plus)?\s*(?:years?|yrs?)\b)/gi,
    (word) => String(words.indexOf(word.toLowerCase())));
  // Two degrees alone do not imply experience alternatives (BS or MS, then 5 years).
  if (hasDegreeExperienceAlternatives(description)) return null;
  const pattern = /(\d{1,2})\s*(?:\+|plus)?\s*(?:-|–|—|to)?\s*(\d{1,2})?\s*\+?\s*(?:years?|yrs?)\b/gi;
  let found: number | null = null;

  for (let match = pattern.exec(description); match; match = pattern.exec(description)) {
    const before = description.slice(Math.max(0, match.index - 24), match.index);
    if (NOT_A_REQUIREMENT.test(before) || NESTED.test(before)) continue;

    // A window either side: "5+ years of professional experience" puts the
    // keyword after, "experience: 5+ years" puts it before.
    const after = description.slice(match.index + match[0].length, match.index + match[0].length + 90);
    if (!EXPERIENCE_CONTEXT.test(`${before} ${after}`)) continue;
    // A trailing "preferred" only governs its own clause: in "2+ years
    // required; 5+ years preferred" it must disqualify the 5 and leave the 2.
    if (OPTIONAL.test(firstClause(after))) continue;
    // Look further back for a section heading — "Preferred qualifications:" can
    // sit a clause or two above the bullet it governs. The nearest heading is
    // the one that governs, so anything before a later "Requirements:" is
    // superseded and must not disqualify what follows it.
    const prefix = description.slice(0, match.index);
    const preferredHeading = lastMatchEnd(prefix, /\b(?:preferred|bonus|nice[- ]to[- ]have|desired)(?:\s+(?:qualifications|requirements|skills|experience)\b|\s*:)/i);
    const requiredHeading = lastMatchEnd(prefix, /\b(?:requirements|(?:minimum|basic|required) qualifications|must have)\b\s*:?/i);
    if (preferredHeading > requiredHeading) continue;
    const behind = prefix.slice(Math.max(requiredHeading, prefix.length - 140));
    const governing = behind.slice(lastMatchEnd(behind, REQUIRED_AGAIN));
    if (OPTIONAL.test(governing)) continue;

    const low = Number(match[1]);
    // Preserve an explicit zero/range lower bound; unknown is a different fact.
    if (!Number.isFinite(low) || low < 0 || low > 20) continue;
    if (found === null || low > found) found = low;
  }

  return found;
}

/** Degree-linked year counts require branch-specific eligibility, not the maximum. */
export function hasDegreeExperienceAlternatives(description: string): boolean {
  if (!/\bor\b|\balternatively\b/i.test(description)) return false;
  const branches = description.match(/\b(?:bachelor(?:['’]s)?|master(?:['’]s)?|ph\.?d|b\.?s\.?|m\.?s\.?)\b[^.;\n]{0,200}?\b(?:\d{1,2}|zero|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:\+|plus)?\s*(?:years?|yrs?)\b/gi) ?? [];
  return branches.length >= 2;
}
