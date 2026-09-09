/**
 * Everything that happens to a posting between "a board handed it to us" and
 * "it is a row in the store".
 *
 * Two very different things discover jobs — ./job-scan.ts walks the companies
 * the user named, ./job-directory.ts walks whole ATS directories — and for a
 * while they each carried their own copy of what came next: the same title and
 * location filters, the same freshness cutoff spelled two different ways, the
 * same hydrate-prune-merge-write tail. Both copies were correct. Neither would
 * have made a sound when only one of them was updated.
 *
 * So discovery stays split, because it genuinely differs — one has twenty-six
 * sources and finishes in seconds, the other has twenty thousand boards, a
 * cursor and a nightly budget — and admission through persistence lives here,
 * once, behind one interface both sides call.
 *
 * The one behaviour that legitimately differs between them is a parameter
 * rather than a fork: see `undated` on IntakeRules.
 *
 * Server-only: reaches node:fs through ./store.ts.
 */
import {
  assertJobUrl,
  buildLocationFilter,
  buildTitleFilter,
  extractYearsRequired,
  isBlacklisted,
  jobKey,
  type Job,
  type JobProfile,
} from "./jobs.ts";
import {
  findDeadPostings,
  hydrateDescriptions,
  makeFetchContext,
  type FetchContext,
  type RawPosting,
} from "./job-providers.ts";
import { hasSubstantiveDescription } from "./job-evidence.ts";
import { newId } from "./paths.ts";
import { readJobs, updateJobs } from "./store.ts";

/** A posting plus the provider that produced it — providers do not label themselves. */
export type ScannedPosting = RawPosting & { source: string };

/**
 * How a posting with no publish date is treated.
 *
 * The only place the two discovery paths are allowed to disagree, and they do,
 * for reasons that are both right:
 *
 *   - "keep", for a named company. A board that omits dates omits them for
 *     every row — Ashby and SmartRecruiters both do — so dropping undated
 *     postings silently switches that employer off entirely.
 *   - "drop", for a directory walk. The question there is "what appeared
 *     recently", and twenty thousand boards' worth of undated backlog buries
 *     the answer on the first run.
 *
 * A parameter rather than two implementations, because collapsing it to either
 * value breaks the other caller and neither failure raises an error: one
 * quietly stops surfacing a company, the other quietly drowns.
 */
export type UndatedPolicy = "keep" | "drop";

export interface IntakeRules {
  profile: JobProfile;
  undated: UndatedPolicy;
}

/**
 * Jobs are kept this long after discovery unless you shortlisted or applied.
 * Without a bound the store grows forever and the dedup set with it; with one,
 * a posting you ignored twice stops costing anything.
 */
const RETENTION_DAYS = 60;
const AUTO_DROP_DAYS = 14;

/** YYYY-MM-DD, `days` before today, in UTC to match provider-reported dates. */
export function freshnessCutoff(sinceDays: number, now: number = Date.now()): string | null {
  return sinceDays > 0 ? new Date(now - sinceDays * 86_400_000).toISOString().slice(0, 10) : null;
}

/**
 * Compile the profile into "does this posting get in".
 *
 * A predicate rather than a list-in-list-out function because the directory
 * sweep decides one posting at a time, inside the loop that keeps its
 * per-source match counters — handing it an array to filter would mean
 * counting the survivors a second time somewhere else.
 */
export function compileAdmission(rules: IntakeRules): (posting: RawPosting) => boolean {
  const { profile } = rules;
  const matchesTitle = buildTitleFilter(profile.titles, profile.excludeTitles);
  const matchesLocation = buildLocationFilter({
    always: profile.locationAlways,
    allow: profile.locationAllow,
    block: profile.locationBlock,
  });
  const cutoff = freshnessCutoff(profile.sinceDays);

  return (posting) => {
    // Cheapest and most selective first, so a directory walk spends as little
    // as possible per posting.
    if (cutoff) {
      if (!posting.postedAt) {
        if (rules.undated === "drop") return false;
      } else if (posting.postedAt < cutoff) return false;
    }
    if (matchesTitle(posting.title) === null) return false;
    if (!matchesLocation(posting.location)) return false;
    if (isBlacklisted(posting.company, profile.blacklist)) return false;
    return true;
  };
}

/** The postings a profile admits. */
export function admitPostings(postings: ScannedPosting[], rules: IntakeRules): ScannedPosting[] {
  return postings.filter(compileAdmission(rules));
}

/** Upgrade discovery evidence without changing the user's application state. */
export function enrichJob(job: Job, posting: ScannedPosting): boolean {
  let changed = false;
  const description = posting.description;
  if (description && description !== job.description
    && (hasSubstantiveDescription(description)
      || (!hasSubstantiveDescription(job.description) && description.length > (job.description?.length ?? 0)))) {
    job.description = description;
    changed = true;
  }
  // Re-run improved extraction on legacy full descriptions too, even when
  // fetching returned the same text (e.g. an old BS/MS alternative parse).
  if (job.description) {
    const years = extractYearsRequired(job.description) ?? undefined;
    if (years !== job.yearsRequired) {
      if (years === undefined) delete job.yearsRequired;
      else job.yearsRequired = years;
      changed = true;
    }
  }
  if (changed && typeof job.score === "number") {
    job.scoreStale = true;
    job.flags = [...new Set([...(job.flags ?? []).filter((flag) => !/^asks \d+\+ yrs$/.test(flag)), "score-stale"])];
  }
  if (posting.ref && !job.ref) { job.ref = posting.ref; changed = true; }
  if (posting.postedAt && !job.postedAt) { job.postedAt = posting.postedAt; changed = true; }
  if (posting.url !== job.url && !job.alternateUrls?.includes(posting.url) && (job.alternateUrls?.length ?? 0) < 20) {
    job.alternateUrls = [...(job.alternateUrls ?? []), posting.url];
    changed = true;
  }
  return changed;
}

/**
 * Merge fresh postings into the existing store.
 *
 * Implementation, not interface: `absorb` is the only caller and the only way
 * in. Exporting it so a test could reach it directly is what let a mutant that
 * deleted retention from `absorb` pass all 973 tests — the tests proved the
 * function worked and said nothing about whether anything ran it.
 *
 * Identity comes from the ATS requisition, never a fuzzy company/title match.
 * Known rows gain better evidence and alternate links, but user state is kept.
 */
function mergePostings(
  existing: Job[],
  postings: ScannedPosting[],
  profile: JobProfile,
  now: string = new Date().toISOString(),
): { jobs: Job[]; added: number; updated: boolean } {
  const maxYears = profile.maxYears > 0 ? profile.maxYears : null;
  const seen = new Map<string, Job>();
  for (const job of existing) {
    for (const url of [job.url, ...(job.alternateUrls ?? [])]) seen.set(jobKey(url), job);
  }
  const added: Job[] = [];
  let updated = false;

  for (const posting of postings) {
    let url: string;
    try {
      url = assertJobUrl(posting.url);
    } catch {
      continue;
    }
    const key = jobKey(url);
    const known = seen.get(key);
    if (known) {
      updated = enrichJob(known, { ...posting, url }) || updated;
      continue;
    }
    const years = posting.description ? extractYearsRequired(posting.description) : null;
    // The experience ceiling, applied the moment the description is in hand.
    //
    // It used to be checked only in `digestCandidates`, one step before a phone
    // buzzes — which kept the push clean and left the board itself full of
    // roles asking for five, six and eight years. Sixty-six of them, against a
    // profile that says three. Filed as "dropped" rather than discarded so the
    // row stays auditable under that tab, stays out of the scorer's queue, and
    // cannot be rediscovered and re-scored on the next scan.
    const overExperienced = maxYears !== null && years !== null && years > maxYears;
    const job: Job = {
      id: newId(),
      url,
      company: posting.company,
      title: posting.title,
      location: posting.location,
      ...(posting.postedAt ? { postedAt: posting.postedAt } : {}),
      source: posting.source,
      ...(posting.description ? { description: posting.description } : {}),
      ...(posting.ref ? { ref: posting.ref } : {}),
      // The description is the bounded full posting, not the scorer's summary.
      ...(years === null ? {} : { yearsRequired: years }),
      ...(overExperienced ? { flags: [`asks ${years}+ yrs`] } : {}),
      discoveredAt: now,
      status: overExperienced ? "dropped" : "new",
    };
    added.push(job);
    seen.set(key, job);
  }

  return { jobs: [...existing, ...added], added: added.length, updated };
}

/** Move untouched rows out of the active list after two weeks. */
function autoDropUnactedJobs(jobs: Job[], now: number = Date.now()): number {
  const cutoff = new Date(now - AUTO_DROP_DAYS * 86_400_000).toISOString();
  let dropped = 0;
  for (const job of jobs) {
    if (job.status !== "new" || !job.discoveredAt || job.discoveredAt > cutoff) continue;
    job.status = "dropped";
    job.flags = [...new Set([...(job.flags ?? []), "inactive-14d"])];
    dropped += 1;
  }
  return dropped;
}

/** Drop stale rows you never acted on; keep everything you did. Internal. */
function pruneJobs(jobs: Job[], now: number = Date.now()): Job[] {
  const cutoff = new Date(now - RETENTION_DAYS * 86_400_000).toISOString();
  return jobs.filter((job) =>
    job.status === "shortlist" || job.status === "applied" || (job.discoveredAt ?? "") >= cutoff);
}

/**
 * Fill in descriptions, then fold the batch into the store.
 *
 * Hydration happens here and nowhere earlier, because it is the one expensive
 * step and admission is what makes it cheap: a description costs a request on
 * several boards, and paying that per surviving posting instead of per
 * discovered one is the difference between a few hundred requests and a
 * quarter of a million.
 */
export async function absorb(
  postings: ScannedPosting[],
  rules: IntakeRules,
  ctx: FetchContext,
): Promise<{ added: number }> {
  if (postings.length > 0) {
    await hydrateDescriptions(postings, ctx, {
      readUnknownBoards: rules.profile.readUnknownBoards,
    });
  }
  const added = updateJobs((jobs) => {
    const autoDropped = autoDropUnactedJobs(jobs);
    const pruned = pruneJobs(jobs);
    const merged = mergePostings(pruned, postings, rules.profile);
    const changed = autoDropped > 0 || pruned.length !== jobs.length || merged.added > 0 || merged.updated;
    if (changed) jobs.splice(0, jobs.length, ...merged.jobs);
    return { value: merged.added, changed };
  });
  return { added };
}

/**
 * Mark the postings that have closed since we found them.
 *
 * Retention drops rows that got old; this drops rows that died. Both are the
 * same job — keeping the store honest about what is still worth looking at —
 * and neither can be done by the discovery pass, which only ever sees what a
 * board still lists.
 *
 * Bounded to what a person would actually click: anything at or above the push
 * floor that is still in play, plus everything shortlisted regardless of
 * score, because a shortlist entry is a promise the user made to themselves.
 * Checking the whole store instead would be four hundred requests a night to
 * protect rows nobody will ever open.
 *
 * Runs after a scan rather than only before a push, because the jobs page is
 * browsed as well as pushed. The gap this closes was a role that scored 4.5,
 * went out in a digest, was taken down the next day, and then sat at the top
 * of the list for four days until someone clicked it and got "Job not found".
 */
export async function expireClosedPostings(
  profile: JobProfile,
  ctx: FetchContext = makeFetchContext(),
): Promise<{ checked: number; closed: number }> {
  const jobs = readJobs();
  const worth = jobs.filter((job) =>
    job.status === "shortlist"
    || (job.status === "new" && typeof job.score === "number" && job.score >= profile.minScore));
  if (worth.length === 0) return { checked: 0, closed: 0 };

  const dead = await findDeadPostings(worth.map((job) => job.url), ctx).catch(() => new Set<string>());
  if (dead.size === 0) return { checked: worth.length, closed: 0 };

  // The probes above perform network I/O. Merge their verdicts into the latest
  // store so scores, notes, statuses, and newly discovered jobs written while
  // the board was answering are not replaced by the earlier snapshot.
  const closed = updateJobs((latest) => {
    let count = 0;
    for (const job of latest) {
      if (job.status !== "dropped" && dead.has(job.url)) {
        job.status = "dropped";
        count += 1;
      }
    }
    return { value: count, changed: count > 0 };
  });
  return { checked: worth.length, closed };
}
