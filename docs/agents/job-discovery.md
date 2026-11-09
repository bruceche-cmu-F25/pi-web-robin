# Job discovery and intake

Files: `extension/robin/job-providers.ts`, `job-intake.ts`, `job-requirements.ts`, `jobs.ts`, `job-scan.ts`, `job-directory.ts`, `job-domain.ts`, `job-evidence.ts`, `job-tools.ts`, `job-rubric.ts`, `app/api/robin/jobs/score/route.ts`, `lib/job-scoring-runner.ts`, `scripts/telegram/bridge.ts`, `scripts/telegram/push-notifications.ts`.

- Discovery traverses sources; intake owns admission → hydration → admission again → merge. A detail endpoint may replace an unknown location or estimated posting date. Never treat the initial list filter as final admission.
- Workday tenants can omit both `locationsText` and `postedOn`. Missing dates are not proof of old postings and must not stop pagination. Explicit `30+ Days Ago` supplies only a lower age bound: stop only if even that bound is outside the requested window. Retain the existing page budget.
- Workday details carry `jobPostingInfo.location` and `additionalLocations`. Carry these through the hydration dispatcher, including full-description rows missing geography. Fill missing stored geography without overwriting pipeline status, notes, application evidence, or existing location labels from another source.
- `go.vansh.nyc` wraps newgradlist's ATS URLs. Resolve this known wrapper after cheap admission, with bounded redirects and credential-free HTTPS/known-ATS host checks on every hop; identity resolution does not bypass `readUnknownBoards`. Only a recognised posting URL establishes identity; a redirect to a careers home does not. Retain the short URL as an alias, dedupe by the resolved requisition, and index newly learned aliases within the same merge batch. Short codes are case-sensitive.
- Greenhouse's own board list supplies a board slug, numeric requisition and title even when `absolute_url` is a branded careers page. It can attach the corresponding `job-boards.greenhouse.io` apply alias without treating the branded URL as an allowed browser target; a conflicting `gh_jid` is not promoted. A non-native aggregator's HTTPS `?gh_jid=` link needs exactly one enabled, user-configured Greenhouse board with the same employer name AND a successful, bounded, no-redirect official per-job response matching both id and normalized title. Only then add the direct ATS alias, retaining the original link and all user state. No configured board, 404, ambiguous employer, mismatched title/id or website login returns unknown: leave the Jobs card for manual review. Do not add a host to `applicationUrl` or change the score merely because a link looks plausible. Built In's tested ApplyRedirect currently leads to `applyRequired=true` rather than an ATS requisition and is not evidence.
- Resolving a legacy short link also rebinds evidence: discard its old JD/ref (case-folded short codes previously cross-contaminated employers), fetch the canonical requisition, promote that URL and keep the short alias. An explicit empty fetched description invalidates suspect cached text/years if fetching fails; an ordinary undefined fetch miss does not erase useful evidence. Metadata changes mark scores stale, never reset status/notes/application/notification evidence. `getJobDetails` / `job_pending(id, refresh: true)` offers one explicit refresh for other suspect or mismatched JDs; failed refresh must not silently reuse suspect text.
- A substantive typed JSON-LD JobPosting takes precedence over longer HTML/embedded prose: a related-jobs carousel is not evidence for this requisition. Ordinary full-JD reads reuse cached text; refresh only when suspect.
- SmartRecruiters identity is employer + numeric posting id, not the optional title slug. Distinct ids remain distinct even if titles match.
- A numeric age limit (`18 years of age`) and future company prose (`ten years from now`) are not experience requirements even when the next sentence mentions engineering. False-positive experience extraction can auto-drop a genuine entry-level role before scoring.
- Fixing discovery does not authorize rewriting historical user statuses or merging away rows that may carry notes/application evidence. Audit historical damage separately; obtain explicit approval before restoring/dropping user pipeline entries.

## New-grad pilot and scan loss accounting

`won-newgrad` reads three small public markdown tables (software, AI/ML, PM), not the 17 MB whole-project JSON; `ml-newgrad` reads the bounded public Tar-ive JSON. Both require HTTPS raw.githubusercontent.com without redirects and pass direct employer links into ordinary admission, ATS hydration, requisition identity deduplication and unchanged user-state preservation. Won keeps first-seen separate from the employer's `postedAt` and uses it only as a fallback freshness gate; this is **not** an employer open verdict or a publish date. ML's `active`/`is_usa` flags are also discovery hints, not verification. Avoid Jobright's restricted endpoints and automatic application submission.

A scan reports, per source, raw count, first rejection by date/title/location/blacklist, first-stage matches, after-detail admission, identity duplicates, newly stored, missing full JD, and **newly stored with a positive employer ATS verdict**. A bounded seven-day run history starts only after instrumentation; totals are events across scans, not a unique-open-job count. `added` includes unverified postings and is not an application/recommendation count. The new community feeds are push-gated again at digest time: a supported employer ATS must positively return `live`; unsupported URL, timeout or unknown is withheld without changing its pipeline status. The existing legacy dead-or-unknown policy is unchanged. Only `new` insertions under the experience cap are checked for `verifiedNew` during scanning; no backend probe guarantees start-date/work authorization fit.

`US Remote` is a conjunctive location token: remote AND a US designation in the location string. `Bay Area` covers common metro cities by name and the other incorporated cities across nine Bay Area counties when labeled `CA`/`California` (e.g. `Richmond, CA`, not `Richmond, VA`). Bare `Remote` and blank geography are unknown to the **US-remote discovery preset**, not nationwide US remote. The separate application policy explicitly allows unqualified bare `Remote` (unless its location restricts work to a region outside the Bay Area); blank geography still does not qualify. Cheap pre-hydration admission temporarily permits blank geography so Workday/iCIMS detail can fill it; the same strict filter applies after detail. The existing profile's broad `Remote`/`United States`/`USA` allowances **are not silently migrated**: a location preference rewrite invalidates existing scoring evidence and can trigger hundreds of paid re-scores. Pilot the new sources in an isolated data directory, estimate the queue delta, then obtain approval for activation of the policy/sources before changing live profile settings or running a production scan.

## Scoring and delivery

- Professional experience comes only from the confirmed profile/CV. The configured numeric stretch is not permission to claim `met`: allow experience `unknown` only when `experienceProblem` says `stretch-experience` and an exact JD quote extracts the same requirement. Cap at 3.9. Unknown education/start/location/authorization and actual blockers remain excluded from **verified recommendations/Push**. The application-only exploratory lane at 3.5 is separate: unknown JD qualifications may be submitted with the user's explicit approval, but known blockers and unverifiable required form answers may not.
- A tool-level rejection of missing, stale or unsupported review evidence must explicitly tell the scorer to reread and repair once; a provisional technical failure is not evidence the candidate is unqualified. Do not endlessly auto-requeue rejected reviews.
- `lib/job-scoring-runner.ts` owns `startJobScoring()`: acceptance/refusal, the local fast path, durable claim/heartbeat, detached rounds, one-time out-of-scope-pin fallback, no-progress detection, eight-round cap and terminal cleanup. The HTTP route is only a guarded JSON adapter; GET still reads `scoringStatus()` from the Job domain. Keep paid turns in the host, not the extension. `job-scoring-runtime.ts` is separate session/tool-contract preflight, not this execution lifecycle.
- The durable scoring lease's AbortSignal must reach `runAssistantTurn`. Failures outside the paid-call catch (queue/storage/progress) must publish a terminal error while still owned, rather than leave `running` until lease expiry. Ownership checks still fence every publication.
- The bridge reads scoring errors, retries an expired lease at most once, and never loops on provider/model failures. With no recommendations, incomplete scans/scoring or a remaining backlog produce a `jobs-status` notification; only a genuinely completed empty check stays silent on Web Push. Keep the latest-preferences check and send-before-claim behavior. Restart the supervised bridge to load code; a Next HMR refresh alone does not update it. A preview proves digest assembly, not handset delivery.

## Duplicate display and supply visibility

Intake still treats different ATS requisition ids as different records; merging on company/title or identical JD can erase real openings and user application evidence. The shared `groupJobCopies()` groups same-stage cards by company/title **or** resolved posting identity (including stored direct-posting aliases), so alternate titles for one requisition do not inflate counts. It does not trust `go.vansh.nyc` short-link aliases, which historical rows sometimes attached to the wrong employer. `job_list` uses the same grouping and annotates the number of same-stage copies; IDs/statuses remain separate. Intake indexes primary posting URLs before aliases and refuses to match or attach an alias already owned by another employer; old records and statuses are not rewritten. Dashboard preview remains five high-scoring roles, but when other jobs exist it stays visible and names the below-recommendation supply instead of vanishing. Its Scan button uses `mutateResponse(..., "POST", {})` like the Jobs page: a bodyless POST fails the shared JSON guard with 415 and never runs discovery. A seven-day freshness window and 3.75 recommendation floor are user profile policy, not a scan-error indicator.

## Daily opportunity brief

`components/robin/JobOpportunityBrief.tsx` leads `/dashboard/jobs` with a read-only five-action preview from today's categorised mail review, the open OA/interview docket and open job-related todos. `job-brief.ts` omits finished rounds, past interviews, recommendation/receipt FYI mail and the todo already linked to an OA; a mailto recruiter todo is not repeated beside its reviewed reply. It labels an overdue OA as needing verification, not an active test. Existing source links lead to original mail, the rounds section or the task record. Opening Jobs never starts a paid inbox check or writes job state; today's absent review explicitly says the inbox was not checked. The Gmail page is the explicit refresh action. The reusable skill lives at `~/.pi/agent/skills/job-opportunity-brief/SKILL.md` and specifies the deeper cross-account mail review (including coverage limits).

## List navigation state

The Jobs page shows OAs/interviews in its left context column (compact docket in the 288px margin), next to Auto-apply and Discoveries in the right work column. On narrow screens the context and results stack without horizontal overflow. Three same-page jump links still reach these sections; this is presentation order only, not a new status filter, scan or application action. The personal answer editor remains in the application card's collapsed settings, not the daily job list.

`JobsBoard.tsx` reads `status`, `q`, `sort`, `shown` and `below` from `useSearchParams` through `board-navigation.ts`; URL state never changes job records or scan preferences. Search and Show more replace history; status/order/disclosure changes push it. Changing status resets the expanded count and below-floor disclosure, but keeps the search. Invalid values fall back to safe defaults, and unrelated query context is preserved. Applied remains its existing dated log.

`useBoardNavigation.ts` is shared with Events. It keeps up to 40 last scroll offsets per canonical list URL in this tab's session storage, waits for data before restoring, and can finish restoration when async content becomes tall enough. Explicit filter changes retain the current viewport instead of restoring an older visit. User wheel/touch/pointer/scroll-key interaction cancels pending restoration. Storage failures degrade to ordinary scrolling; this is not cross-device state, a server write, or a separate snapshot for every identical-URL history entry. `e2e/board-navigation.mjs` exercises reload/back/forward, expanded rows, slow reads, changed result heights and restricted storage with all APIs mocked.

## Confirmed browser writes

`EventsBoard` adopts the full event returned by a successful flag PATCH through
`usePolledResource.updateData` before refreshing. `JobLinks` likewise adopts each
saved-link receipt, including individual successes in a partially failed seed
batch. A failed refresh retains these confirmed results, and earlier reads cannot
roll them back. Follow-up reads do not hold write controls locked; JobLinks guards
duplicate submissions synchronously and retains input on failure. These use the
existing resource interface, not a second client store.
`components/robin/BoardReceipts.test.mjs` runs the actual components and resource
module against controlled write/read failures and out-of-order responses.

## Navigation payload

`RobinMargin` requests `/api/robin/jobs?view=navigation`: `jobNavigationStatus()`
returns only `{ shortlist, hasNew }`, using the same status rules as the former
client-side count. Do not call `jobBoard()` just to paint badges: a measured
5,941-row board was 3.9 MB decoded, fetched on every workspace, and performed
sorting/evidence validation unnecessarily. Counts are read fresh, with no cache
or pipeline writes; the full Jobs/Home board endpoint is unchanged. SQLite now
materializes only status strings before grouping, avoiding transfer/JS parsing
of every stored JD/evidence payload. This still scans SQLite JSON; it does not
introduce a status index or cache. Direct `GROUP BY json_extract(payload, ...)`
can spill whole payloads into a temporary B-tree and was slower: keep the narrow
`MATERIALIZED` projection in `countTaskRecordsByField`.

Known-ID reads, detail hydration commits, note/status edits, deletion, bulk status
changes and notification claims pass their IDs through `readJobs`/`updateJobs`.
SQLite uses its existing primary key and preserves each row's position; JSON
retains its full-file locking behavior. Do not narrow scoring/intake operations
that need the rest of the collection for backlog or merge/retention checks.

`jobSummaries` and `pendingJobQueue` share a read-only evaluation view. It first
projects away `description`, `review` and `application`, then hydrates all `new`
and `shortlist` rows by ID within the same SQLite snapshot. Historical metadata,
including Applied URLs, stays in the input for stable ordering and pending-job
deduplication; inactive stale-score flags also remain visible. Active rows retain
full JD/review evidence and are checked against the freshly read profile as before.
JSON/mixed-v1 reads parse the file only once. The HTTP board, scoring status/counts
and tools use these domain readers; never use partial historical view rows for
scoring writes, intake, application reservations or persistence.

`pendingJobs` applies cheap status/date/title/location/blacklist exclusions before
JD/profile hashing and evidence validation. Shortlists still bypass discovery
filters, not evidence checks. The applied-URL set, ordering and deduplication are
unchanged. View/full-record parity tests cover changed CVs, valid and stale reviews,
shortlists, Applied duplicates and unchanged stored evidence.

The full GET uses the existing `jsonResponse(req, ...)` transport helper: large
boards negotiate streaming gzip with `Vary: Accept-Encoding` and `no-store`;
identity/disabled gzip and the tiny navigation response stay uncompressed. A
measured 3.9 MB board transfers about 775 KB with gzip. This does not shrink its
decoded JSON or remove synchronous collection/evidence work. `apiRoute` accepts
standard Web `Response`s as well as `NextResponse`, preserving the stream and
headers rather than wrapping them again.

## Scoped browser board reads

`JobsBoard` requests `/api/robin/jobs?status=<stage|all>&view=cards`. The Home preview
requests the same card view with `status=new`. Card mode removes only `ref`,
`alternateUrls`, `yearsRequired`, `scoredAt`, `scoredBy` and `scoreContext` **after**
`jobSummary` validates evidence; these internal fields remain in storage and the
default/tool/detail responses. Scores, stale flags, notes, dates, source links,
group membership and all actions remain unchanged. Measured further reductions:
New 946,783 → 789,024 decoded bytes; All 3,907,533 → 3,047,804 bytes. This is a
transport projection, not server pagination or a removal of history.

No status still returns
the original full board for existing consumers/tools. A selected stage carries
only its complete summary rows plus global card membership (`status`, row IDs)
and the lede's small match/notification inputs. Card membership, not raw status
counts, preserves role deduplication and pending delete/undo counts even when the
viewer switches stages during the undo window. All copies within the selected
stage remain present for search and grouped actions; Applied remains a dated log.
The lede is still computed in the viewer's local timezone and ignores hidden IDs.
No history/status/notes are rewritten; All and other stages remain accessible.

The evaluation view hydrates full evidence only for active rows in the requested
scope; queues/default reads still hydrate every active row. Never use these
partial views for writes or application submission gates. A response echoes its
scope so the client cannot restore scroll against the previous stage's rows.
URL changes still fence old responses. Explicit refresh reads the hook's current
URL even when an older async action finishes after navigation; an old receipt
cannot be applied to a different resource. Tests compare scoped rows, global
membership and overview against full-record evaluation, including changed CVs,
duplicates, hidden IDs and unchanged storage. The Jobs and board-navigation browser
fixtures now return genuinely scoped data, including delayed history navigation.

On 5,932 jobs, New carried 984 rows: 3,907,519 → 946,783 decoded bytes and
773,846 → 202,572 gzip bytes. Five paired live HTTP samples were 185–221 →
138–175 ms including body/decompression/JSON. This is scope loading, not server
pagination: a very large selected stage or All can still be large.

## Browser progress cadence

The Scan and Score buttons use `mutateResponse` with an empty JSON object, like
other guarded writes. Bodyless `fetch(..., { method: "POST" })` is not compatible
with the shared `apiRoute` JSON guard and receives 415 before starting work. Keep
the guard; do not relax it to accommodate the client. `e2e/frontend-reliability.mjs`
checks both real button handlers against mocked endpoints without scanning or
spending model tokens.

`JobsBoard` sweep/scoring reads use `usePolledResource`'s data-derived interval:
4 seconds while the respective response reports `running`, 60 seconds at rest.
The first read, visibility return and explicit action-completion refresh remain
immediate; hidden documents do not run interval polls. Derive the numeric interval
inside the shared hook, not an effect dependency on inline selector identity.
No job scan/scoring is started by this client cadence change.

`usePolledResource` interval ticks skip an in-flight request, including its body.
Otherwise responses slower than the cadence are cancelled indefinitely and their
30-second deadline is continually reset. Explicit refreshes, visibility return,
and post-write invalidation still supersede stale reads. Completion releases only
its own controller; timed-out/aborted transports cannot prevent the next tick from
retrying or release a newer read. `usePolledResource.test.mjs` covers slow headers,
stalled bodies, deadline preservation and late cleanup.

Automatic `usePolledResource` reads of the same URL share only an in-flight
transport through body completion. Settled data is never cached across consumers;
each hook parses/owns its own data and retains its sequence/deadline/write fences.
One subscriber leaving cannot abort another's request. Last-subscriber abort waits
one microtask so React's development effect replay can reacquire the same flight;
a real unmount still cancels it. Explicit refresh/visibility return start fresh.
Confirmed writes detach the old shared flight from future automatic readers.
The dashboard's repeated todo downloads fell from four completed bodies to one;
this is transport coalescing, not a longer stale-data interval.

Regression checks:

```sh
node --experimental-strip-types --test extension/robin/job-*.test.mjs extension/robin/jobs.test.mjs
ROBIN_TEST_TASK_BACKEND=json node --experimental-strip-types --test extension/robin/job-*.test.mjs extension/robin/jobs.test.mjs
node --experimental-strip-types --test lib/job-scoring-runner.test.mjs lib/job-scoring-runtime.test.mjs app/api/robin/jobs/score/route.test.mjs app/api/robin/jobs/routes.test.mjs
```

Runner tests control assistant turns and lease/storage failures through its existing
imports, without paying for a model or changing personal data. Route tests cover
HTTP guards and unchanged receipt shapes; the jobs route integration and domain
checks retain real storage/lease coverage.

See `docs/jobs-crawl-audit-2026-10-25.md` for the observed data and limits, not a guarantee that current upstream boards have the same schema.
