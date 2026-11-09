# Unified Brief: acquisition, reading and gated delivery

The rebuild is specified in [PRODUCT](../specs/unified-brief/PRODUCT.md) and
[TECH](../specs/unified-brief/TECH.md). **Stored/Gmail/live acquisition, zero-tool editing, the shared reader,
and the gated scheduled-delivery implementation are present.** Automation is OFF by default.
An explicitly approved live sample was published on 2026-11-01 (see acceptance record below).
The production store was absent and initialized at v4, not migrated. Automatic delivery remains off;
no phone notification was sent by the acceptance run.
Public coverage defaults to two publisher feeds, not comprehensive world news or independent fact-checking. Optional public-only search is implemented but not enabled.

## Two explicit CLI input modes

- `shadow`: the original M1 path. Reuse existing mail reviews, local calendar,
  open deadlines and today's stored weekly reading slot. No upstream refresh.
- `acquire`: opt into read-only Gmail acquisition for the primary Google account.
  The other three sources still use the M1 adapters. This is still a deterministic
  **shadow** edition, not a ranked, model-written daily brief.

Both CLI modes use the same durable run claim, bounded execution, frozen source results,
validation, version publication and completion. Neither calls an LLM, changes a task
or event, marks a message read, sends anything, enables a scheduler, or replaces production.
The shared Google token helper may refresh its existing OAuth access-token cache when
an operator explicitly runs `acquire`; acquisition does not change the grant or scopes.

Fresh mail is an **untriaged observation**, not automatically an action item. Reading
its text grants no authority. Stored reviews remain `stored-review`; reused weekly
passages retain their old dates/check times. Connected Google events remain explicitly
missing from the CLI/local-only snapshot; the explicit `live` editor input refreshes Google events. Observation time is not event time.

## Explicit editorial preview and reader

Open `/dashboard/gmail?feed=brief`. GET is private/no-store and read-only: no initialization,
source refresh, model call, read/handled marker or send. A pinned `edition=<uuid>` loads exactly
that immutable edition; a missing version does not fall back to another. The unpinned reader
and Home card select the latest **edited** edition, never an unranked CLI shadow result.
Home's first three editorial items, full text and notification preview all use the same edition.
Links retain `session`/`cwd`; notification URLs pin the edition. Reading or generating a manual preview never sends.

After an operator initializes/upgrades storage, the collapsed generation form offers:
- stored records (the default, no upstream refresh);
- opt-in primary Gmail incremental acquisition, with calendar/tasks/public material still stored;
- `live`: refresh primary Gmail, Google events and fixed public publisher feeds; tasks remain local records.

A separate consent checkbox authorizes sending bounded private summaries/body excerpts,
tasks, calendar records and public excerpts to the configured model. POST requires a stable request
ID and `allowPrivateModel: true`. The request's `editor-stored-v1`/`editor-gmail-v1`/`editor-live-v1` policy cannot
change on retry. The browser stores only its request ID/input mode per tab; reload resets consent.
Starting a new request explicitly clears consent and may spend again. No Pi tool or scheduler
invokes this route. Existing mail automation can still make its own legacy task/event writes.

The editor uses an isolated **one-shot, exact zero-tool** turn; its completion notifications are
silenced before prompting. Ordinary chats remain unchanged; old digests change only through the explicit handoff. Inputs
and replies follow existing private Pi session storage; a no-op remembered pointer is not a
promise of transcript deletion. The run allows one durable editorial-turn reservation, committed
before dispatch. Failure/timeout with no saved result is uncertain: the same ID will NOT pay again.
A new request is required. A validated saved result survives publication failure and is reused.
Once reserved, every source result—including unavailable-source gaps—is frozen. Uncertain retries
do not reacquire sources; a missing frozen result fails closed rather than rebuilding a different input.

The model sees at most eight candidates per source, round-robin sampled within a 50,000-character
message. It can return at most eight items, four source IDs each, and a 32,000-character accepted
reply. Every cited source needs an exact supplied passage; IDs cannot be duplicated or invented,
and one item cannot mix public/private references. Sections come from source identity, not model
claims. The editor has a 90-second turn timeout within the 120-second overall run. These are turn,
input, validation and wall-clock bounds—not a hard provider token/currency cap or a claim about
SDK/provider-internal retries. Empty candidate sets skip the model, report missing material and
retain the previous edition rather than fabricating an all-clear.

The reader separates what/why/unexecuted suggestion, preserves historical publication dates,
shows omitted candidate counts and source gaps, and labels model judgment as unverified.
Passage matching does NOT prove the generated prose is true, relevant or faithful. Production
editorial quality and stronger semantic gates still require evaluation. Finishing a generation
never changes navigation or replaces a pinned version: use the saved-version receipt. Successful
generation closes its form and restores focus only when focus was inside that form. Inactive
source tabs stop automatic polling; explicit completion refreshes remain read-only.

The full reader is a single opaque reading sheet (760px maximum): date/version and headline first,
then numbered personal priorities and public developments. Following the legacy Telegram agenda's
“know what the day holds” framing, the editor favors concrete subjects, supplied times and a single
useful next step over process prose. The existing first personal item (or first public item when there
are no personal items) is highlighted as “Start here”, not assigned a new urgency or reordered by the UI.
Source labels use saved identities: warm tasks, blue calendar, violet mail, teal public material, with
text labels as well as color. Recorded deadlines remain literal snapshot values, not live overdue claims.
The Home preview shares these labels/order; suggestions have a separate inset and caveats remain visible.
Stored weekly-only material says Background reading. Source quotations expand inline. Coverage details, notification content, generation settings
and delivery receipts follow the articles; they do not displace the first priority on a normal phone
viewport. The later lightweight reading pass moves source/date labels beneath each short headline, uses a quiet striped lead instead of an inset card, keeps suggestions inline, and lays the full mail list out as compact divided rows. On phones the reading sheet fills the width without a nested card border; evidence and operational details remain disclosures. Shared type tokens, 44px controls, 16px-or-larger prose, wrapping and native disclosures
are checked at 320/390/1440px, in glass/dark and simulated larger text. No new animation or dependency.

The Telegram-inspired reading pass was checked with synthetic editions at 320/375/390/812/1440px
(including landscape), Glass/Dark/Dark glass, and 200% root text. The browser regression verifies
one reading lead, four source colors with text labels, visible literal deadlines, sampled text contrast
of at least 4.5:1, matching Home order, public-only/empty editions and the existing consent/navigation
boundaries. TypeScript, targeted lint and 13 editor/i18n tests passed. No production regeneration or
notification was requested; the revised editor wording applies to future compositions, not saved prose.

Coverage disclosures project localized explanations from saved status/evidence kinds and record counts,
not by matching or translating backend diagnostic prose. Acquired records and records supplied to the
model are counted separately. Raw diagnostics require a second, keyboard-accessible “Technical details”
disclosure. Observation/save times use the reader device's zone (shown explicitly); literal event,
publication and deadline dates are unchanged. Coverage is explicitly a saved snapshot, not a running
sync: opening it cannot drain the mailbox queue, refresh sources or rewrite an edition.

This coverage-only follow-up passed 16 reader/editor/i18n tests, TypeScript, targeted lint and the
synthetic reader browser suite. Read-only checks of the existing production edition at 320/402px
confirmed localized timestamps, hidden raw diagnostics, unchanged edition JSON and no API mutations.
Automation remained off with no delivery receipts; registered subscriptions are not proof of phone
receipt. No fresh model call, source acquisition or notification was made.

## Operator commands

```sh
npm run robin:brief -- status
# New installations only: creates the Brief database, reads no sources.
npm run robin:brief -- init
# For an existing v1/v2/v3 Brief database; first STOP every Brief writer.
npm run robin:brief -- upgrade --writers-stopped
# No external acquisition:
npm run robin:brief -- shadow manual-stored-01
# Explicit read-only Gmail acquisition; use a NEW ID for each new bounded slice:
npm run robin:brief -- acquire manual-mail-01
# Private content; do not publish its output:
npm run robin:brief -- inspect manual-mail-01
# Read-only bounded delivery receipts; no initialization:
npm run robin:brief -- delivery-status
# After checking an uncertain receipt; this NEVER resends:
npm run robin:brief -- resolve <slot> accepted
npm run robin:brief -- resolve <slot> cancelled
```

These are operator instructions, not automatic startup actions. Development tests use temporary
`ROBIN_DATA_DIR` directories and mocked network responses. The original implementation used no real
inbox, initialization or migration; the later user-approved live acceptance is recorded below.

`status`/`delivery-status` without storage create nothing. `init` never upgrades an old schema. A v1/v2/v3 store
requires the explicit offline upgrade, which verifies/fsyncs a `VACUUM INTO` backup before
one schema transaction. The acknowledgement flag does not stop processes. Invalid/newer
stores and active leases fail closed; a concurrent change during backup is refused.
The backup path is returned to the operator. Repeating an already completed upgrade is a no-op.

An identical request ID returns the same edition or resumes the failed operation with its
saved date, inputs and **remaining** request budget. It cannot switch `stored-v1`/`gmail-v1`
policies (nor any editorial policy). A completed partial edition is immutable: use a NEW request ID to continue its
provider queue and create a new revision. Retrying a completed ID does not refresh anything.

Receipts/status omit message bodies. `inspect` includes saved source text, request reservations
and content-free checkpoint steps; keep it local, not in public logs or screenshots.

## Gmail acquisition and evidence

1. A fixed policy excludes spam, trash, sent mail, drafts and promotions. Bootstrap starts
   at the selected day at UTC midnight minus seven days; the current view uses that same
   lower bound for its selected day. This is a recent-mail scope, not a complete inbox archive.
   Received dates come from Gmail `internalDate`, not a guessed deadline in the subject.
2. Read the authenticated mailbox profile **before** listing messages. Account identity plus
   policy version keys the cursor/cache. A changed account cannot borrow the previous account's
   cursor. Disconnect/account change is checked around network responses, including a grant
   replacement whose legacy token file has no email address; the guard returns only a boolean.
3. Bootstrap pages use a frozen lower bound. The pre-list history ID catches arrivals/label
   changes during that scan. Subsequent runs use `users.history.list`, including label changes
   and deletions. Only a fully drained final history page advances the high-water mark; the
   profile's newer ID is never substituted for unfinished work.
4. Save page membership before fetching bodies. Each observation/tombstone, remaining queue
   and checkpoint step commit together under the run's owner fence. A page can span several
   bounded runs without refetching already saved bodies. A resumed final page catches up to
   the new invocation's observed mailbox head before reporting completion.
5. Expired history (404) starts a new recent-mail bootstrap generation. Old evidence/editions
   remain intact, but unseen records from the old generation do not appear as current data.
   An expired page token restarts at the original watermark (or a new bootstrap), never at a
   guessed latest ID. Malformed/unsupported or oversized history pages retain the cursor and
   report a gap. A reset can recover only the declared recent scope, not all historical changes.
6. Each request ID has **32 durable reservations**, including one conservative reservation per
   token lookup (even if cached). Gmail data responses are capped at **2 MiB** each; redirects
   are refused. Calls time out after 10 seconds; the run retains its 120-second deadline and
   60-second lease/15-second heartbeat. The shared OAuth refresh keeps its existing transport
   timeout, not a new data-body reader. Acquisition itself uses no model tokens and has no
   rate-limit/server-error retry loops; cursor/page recovery and metadata fallback consume the same budget.
7. A provider page is limited to 2,000 distinct IDs, a saved body prefix to 20,000 characters,
   and the shadow mail input to 100 recent records. Truncation is reported. A full response over
   the byte cap can fall back to a separately budgeted metadata-only request; that record is
   explicitly missing its body, not falsely marked fully read. This avoids one huge newsletter
   blocking later messages. Other provider failures retain pending work, not a successful empty
   inbox; when no source is usable, the previous edition remains current.
8. Evidence versions preserve the normalized best-effort text, metadata, observation time,
   source/message identity and content digest. Latest-record pointers and deletion tombstones
   are separate from immutable evidence. Publication checks digest, reference, title/link,
   summary passage and exact saved quote. This proves provenance, **not truth, relevance or
   full-body completeness**. No instructions in messages are executed or sent to public research.

Reference semantics: [Gmail sync guide](https://developers.google.com/workspace/gmail/api/guides/sync),
[history pagination/expiry](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list),
[mailbox profile](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/getProfile).
Changing the exclusion/body policy requires a new policy identity rather than silently reusing its cursor.

## Live calendar and public acquisition

`editor-live-v1` collects calendar → public → mail → local tasks, so a large mailbox cannot spend
all 32 reservations before other network sources run. The input order/profile is immutable policy.

- Google: local events plus fresh selected-calendar events; at most four calendars, two pages each,
  100 events/page, 2 MiB/response and 10-second calls. Existing token lookup and shared reservation
  budget apply. Disconnection/grant replacement drops remote observations. Failed/unfinished pages
  explicitly lower coverage. Reads never create, change or mark events. No new calendar sync cursor.
- Public: fixed `https://openai.com/news/rss.xml` and `https://hacks.mozilla.org/feed/` only, through
  the existing DNS-pinned SSRF-safe fetcher. No private query, cookies, authorization or research model.
  No redirects; 10 seconds and 1 MiB/feed. Restricted RSS 2.0, no DTD/entities; at most 40 inspected
  entries, 64 KiB/entry, four admitted articles/feed and 1,800 description characters. Missing/future
  dates, foreign-host links and omissions are not invented away. Seven-day date window, up to
  acquisition time; normalized publication dates are UTC, even when UTC is already tomorrow locally.
- Public excerpts and publisher metadata are immutable, digest-checked evidence. Publication checks
  title, URL, original date and exact normalized passage. These are publisher claims, not full-article
  reads or independent fact verification. Quiet/unavailable feeds do not mean nothing happened.
  Live mode does not substitute old weekly material when feeds fail. Stored mode still labels history.
- A read-only public connectivity/parser check returned 200 for both feeds (about 817/283 KiB), with
  four admitted OpenAI entries and no in-window Mozilla entries. No private account, model or Brief
  database was involved. This verifies those URLs/parser at that moment, not ongoing service quality.

## Twice-daily full mail (user-approved follow-up)

`ROBIN_BRIEF_MODE=mail` selects the mail-only lane: 08:00 and 18:00 server-local boundaries,
with `ROBIN_BRIEF_TIMEZONE=America/Los_Angeles` checked against the actual process zone and an
explicit `ROBIN_BRIEF_START_AT` ISO first boundary. The existing enable/private-model/replacement
and start-date gates remain required. In this mode only the old mail digest is replaced; the daily
agenda, event reminders, jobs and weekly remain independent.

`brief-mail-review.ts` enumerates the whole fixed interval, includes read/archived/promotional/social
mail, and excludes spam/trash/sent/drafts. It stores complete extracted bodies in lossless fragments,
then reviews all fragments in bounded zero-tool batches. Only filenames/counts of attachments are
retained for display; attachment content is not decoded and no attachment endpoint is fetched.
External/unavailable/encrypted bodies, oversized responses and uncertain/invalid model results are
explicit failures, never counted as reviewed. Missing messages have unknown dates, not invented arrival times.

The same Brief v4 database owns interval manifests, immutable evidence, per-fragment paid reservations,
validated results and delivery receipts. Planned continuations are `waiting` runs, not false failures.
Each bridge invocation drains up to five bounded passes; existing 30-second scheduling resumes the rest.
Every supplied fragment must have its own quoted result; eight highlighted items in the reader do not
limit review. The full mail list, reviewed/failed counts, interval and attachment notices remain visible.
No extra summary-model call is needed. Empty intervals publish a zero-mail report without a model call.

Delivery slots append `:mail:08:00` / `:mail:18:00`; old daily identities and editions are untouched.
Every new interval looks back at least **48 hours** from its scheduled boundary, including read mail
and messages received after the previous morning's run. Coverage advances only with a persisted
push-service acceptance; missed reports extend the interval further back, never shorten that lookback.
Overlapping intervals reuse cached fragment results to avoid paying twice. Already-started intervals
and published editions retain their frozen bounds. Legacy manual/Telegram mail checks also default
to `newer_than:2d` (including saved legacy `newer_than:1d` defaults); custom searches remain unchanged. Transport uncertainty still stops
resending the same edition. Morning delivery expires at 18:00; evening at midnight. Slot times start
processing, so a large mailbox can arrive later than the boundary. This is not a hard real-time guarantee.
First morning and evening runs also look back 48 hours. Delivery boundaries stay at local 08:00/18:00
across DST; the lookback is 48 elapsed hours rather than a midnight-only calendar filter. Gmail is a point-in-time listing, not a guarantee against
messages retroactively imported after enumeration.

Safety ceilings remain explicit failures, not silent sampling: 2 MiB per provider response, 30 seconds
of hydration per pass, one <=90-second model turn per pass, 32 million body characters per interval,
10,000 report rows and a durable 20,000-request guard. Larger runs are not published as complete.
Private Pi transcripts persist under the existing retention policy. See [mail behavior](../specs/unified-brief/MAIL-DELIVERY.md).

### Authorized mail activation — 2026-11-01

After the user confirmed attachment notices only, the installation was enabled for **2026-11-02
08:00 America/Los_Angeles** (`2026-11-02T16:00:00Z`), then 08:00/18:00 daily. A private verified
SQLite snapshot and configuration backup were made under `.mail-schedule-backup-*`; no migration
or old-edition rewrite was needed. The exact existing launchd bridge was stopped/restored once;
the healthy web process remained running and reloaded the environment. Both now expose matching
mail-only configuration. An authenticated early tick was refused before any acquisition or model call.

Checks: 240 regression tests, 24 JSON-backend compatibility tests, TypeScript, targeted lint, the full
synthetic Brief browser suite and the all-mail reader browser suite. Real read-only Gmail profile access
and five stored push subscriptions were verified; an older valid grant with no cached email address is
handled by profile verification before pending dispatch (not on settled polls). Production retained one
old edition and zero outbox rows at activation. No test notification or new production model turn was
sent in this cutover. Actual full-mail editorial quality and physical-phone receipt await the first run;
service acceptance must not be reported as proof that the phone displayed it.

## Combined morning brief (activated 2026-11-03; first new morning 2026-11-04)

`ROBIN_BRIEF_MORNING_DAILY=1` must be set on both the Web service and its supervised bridge before the existing mail-mode morning slot changes. Without it the approved mail-only morning and independent agenda are unchanged. After an operator checks both processes have matching flags and starts on a safe future morning, the 08:00 mail edition includes live selected Google calendar events, open deadlines through the next two days, and current excerpts from the two fixed OpenAI/Mozilla feeds; complete mail review and attachment-name notices remain in a collapsed list. The morning notification/reader lead with reviewed action mail and open tasks, then arrangements and publisher stories. Failed mail reviews stay in the complete mail list and a separate gap count; they never occupy action slots or inflate the action headline. The 18:00 report still reviews its full 48-hour window but highlights only messages arriving since 08:00 (including new action-required or incomplete mail). Earlier action mail remains in the collapsed full review, not repeated in the evening highlights. The reader links both immutable 08:00 and 18:00 editions for the selected day; the phone preview uses short separate highlight lines instead of joining the headline and lead into a paragraph. The old agenda is suppressed when the combined gate is on; previously published morning receipts cannot be rewritten. If a legacy agenda or mail slot was already delivered that day, the combined morning is blocked rather than duplicated. Delivery uncertainty and missing-source coverage retain their prior semantics. Without the separate search gate no additional model turn is spent on news selection; fixed feeds provide only AI/software-engineering material, not verified job-market news or a comprehensive current-affairs service. The `mailReport` includes full-window counts even when evening highlights exclude older FYI mail. The Home strip renders only today's edition, links reviewed mail summaries directly to their originals, and leaves duplicate calendar/tasks and editorial counts to their existing places.

The implementation initially left this gate off. On 2026-11-03 at about 11:00 PST, after today's 08:00 mail receipt was already accepted, the user authorized the combined morning. The exact supervised bridge was stopped, a verified SQLite `VACUUM INTO` snapshot and private configuration backup were saved outside the repository under `~/.pi/robin/backups/`, and `ROBIN_BRIEF_MORNING_DAILY=1` was added to the shared `.env.local`. The healthy Web server reloaded it (confirmed through authenticated read-only GET), and exactly one bridge was restarted. Both process configurations evaluate to matching mail-mode combined schedules; the original 2026-11-02 start boundary was kept so today's remaining 18:00 report is not inadvertently paused. Today's accepted 08:00 outbox receipt remains intact and cannot be regenerated. The next eligible combined morning is **2026-11-04 08:00 America/Los_Angeles**. The existing evening full review continues; with the combined gate it highlights mail since 08:00. Five subscriptions, the push channel and a valid Google connection were checked read-only. No immediate new model call, acquisition or test notification was triggered. The first new edition, delivery receipt and actual handset display/link still need observation; push-service acceptance alone does not prove handset display.

### Optional public search in the 08:00 combined edition (still not activated)

On **Pi Web only**, `ROBIN_BRIEF_PUBLIC_SEARCH=1` adds a bounded public-search collection step to the world source when `ROBIN_BRIEF_MORNING_DAILY=1` is already active. Nothing changes in the 18:00 mail review, manual generation, job discovery or application authorization. The bridge still needs the combined-morning flag matched with Web; the search flag matters where acquisition actually runs. `ROBIN_BRIEF_PUBLIC_SEARCH` remains unset in the running service: the first combined morning uses the existing fixed publisher feeds, not the optional search. No real public search was performed by this change.

The isolated one-shot researcher receives only the edition day and three fixed, generic AI / software-engineering / tech hiring-market queries. It receives **no** mailbox, CV, job profile, applicant answers or dashboard records. Only `web_search` and `get_search_content` are exposed; no authenticated fetch tool is available. The prompt allows one search call (three varied queries) and at most three bounded search-result content reads, with a 35-second turn deadline. This call-count instruction is checked after the turn, **not** a hard upstream search-call/token cap; an over-budget reply is discarded. The Brief editor still has zero tools. One durable Brief request reservation precedes research and up to six separately budgeted original-page reads follow. Each source fetch is SSRF-safe, HTTPS-only, no redirects, 8-second timeout and 512 KiB maximum; a model reply is capped at six candidates, at most two per topic. No fetch follows a social-post URL: X and other social posts are leads only, and are discarded unless the researcher produces a different original source.

An admitted article must have an original-page title, exact substantive passage (60–1,200 characters), visible year-bearing date within 1,000 text characters of the title, and consistent ISO publication day within the past seven days; only the actual fetched visible HTML/text is checked, not the search provider's synthesis. The exact date quote is stored alongside immutable digest-checked evidence and validated again when the edition publishes. This verifies **passage/date presence**, not factual truth, article-to-date semantic linkage, article accuracy, employer hiring openness or independent corroboration. Publisher claims stay attributed as such and search results never authorize a todo or application. Three optional public rows are selected for the short morning edition with at most one lead per topic when available; full source links and coverage remain in the reading sheet. Failed or rejected searches degrade the world coverage to partial/unavailable with fixed RSS surviving where possible; no missing topic is reported as an all-clear. The day's frozen source input is not silently regenerated on retry.

## Gated schedule, delivery and cutover

The **existing supervised bridge** owns one additional nonoverlapping lane; no Pi Web timer is added.
`POST /api/robin/brief/tick` checks the deployment gate, current local day, phone channel, subscriptions
and original agenda/mail ledgers before spending. It uses a stable `daily-brief:<day>:<timezone-hash>`
request. The manual compose API refuses this prefix and cannot request delivery. GET on the tick
endpoint reads configuration/receipts and the latest automatic run's day/stage only; it exposes no
source text/provider errors and never migrates old storage. Failed/interrupted generation is shown
separately from delivery so an old readable edition cannot masquerade as a successful run.

To configure automation, both Web and bridge need the same explicit environment:

```dotenv
ROBIN_BRIEF_ENABLED=1
ROBIN_BRIEF_ALLOW_PRIVATE_MODEL=1
ROBIN_BRIEF_REPLACE_LEGACY=1
ROBIN_BRIEF_START=YYYY-MM-DD
ROBIN_BRIEF_TIME=08:00
```

Replace `YYYY-MM-DD` with the agreed first live day. Time is **server local wall-clock time**, default
08:00. This requires the existing notification channel to be phone push. It is not enabled by visiting
the reader, registering a phone, initializing storage or accepting the manual-preview checkbox.
Only agenda and mail summary lanes are replaced; jobs, event reminders, interactive Telegram replies
and the independently configured AI weekly pipeline remain unchanged.

1. Keep automation disabled. Stop/drain **every Brief writer and the old bridge**; back up and explicitly
   initialize/upgrade to v4. The acknowledgement flag does not stop services. Do not run parallel old/new bridges.
2. With automation still disabled, explicitly consent to one manual live preview and inspect actual
   editorial relevance, original dates, gaps, source links and the matching Home card. Real provider
   token/currency behavior is still an acceptance gate, not certified by mocked tests.
3. Register/check the intended installed HTTPS phone subscription. Agree the first live date/time;
   configure both processes, restart one bridge, and leave old ledgers intact. A future first day avoids
   an in-flight mid-day handoff. No real test notification is sent without permission.
4. At/after the first due time, verify the edition, receipt and actual phone display/deep link. If the
   process wakes late, only the current day's slot is eligible. Repeated DST hours share one slot;
   a skipped wall-clock hour becomes due after the gap. Generation crossing midnight never sends yesterday.
5. Stop automation if quality or delivery fails. Retain editions/receipts; an owned day still fences
   legacy agenda/mail after disable, preventing rollback catch-up. Resolve uncertainty explicitly.

Edition + run completion + outbox intent commit in one transaction. Retries never regenerate an owned
slot. A delivery lease lasts 120 seconds; transport waiting is bounded to 60 seconds. A crash, timeout,
unknown response, or abandoned owner becomes `uncertain`, not an automatic resend. A late owner cannot
settle its replacement. At least one push-service acceptance settles the slot; this does not prove
phone display/read or acceptance on every device. Only definite nonacceptance retries (five minutes,
maximum three attempts). Delivery expires six hours after generation starts or at local midnight,
whichever is sooner; transport TTL is at most one hour and never beyond that window.

Legacy receipts are rechecked before generation, after it and before dispatch. A late old receipt
cancels a pending new intent. Old ledgers are read, never erased/relabelled. Network-send/ledger-write
crash windows and simultaneously running old/new processes are NOT an exactly-once protocol: the
stop/drain/one-bridge cutover is required. Accepted, cancelled, failed, expired and uncertain slots
remain owned; disabling the new producer does not replay them through the old one. Manual `accepted`
settlement has no provider acceptance count and is labelled separately; neither resolution sends.

## Persistence and recovery

- New domain only: `$ROBIN_DATA_DIR/brief.sqlite` (default `~/.pi/robin/brief.sqlite`), schema v4.
  This does not migrate the task database or its operational-file allow-list, mail reviews,
  weekly records or delivery ledgers. Initial creation uses a private staging directory and `0600` file.
- V2 adds the input policy, source cursors/queues, immutable evidence, latest-record pointers
  and cumulative request reservations. V3 adds `brief_edits`: input hash, pre-dispatch reservation
  and validated raw output. V4 adds `brief_outbox`: unique day/timezone intent, fixed edition, expiry,
  owner/lease, attempts, next attempt and acceptance state. Older runs, evidence, cursors and editions
  survive the explicit upgrade. The edition's historical `mode: shadow` field is compatibility metadata,
  not delivery state; consult the outbox/configuration.
- SQLite WAL + synchronous FULL, foreign keys and short transactions. No network awaits under
  a writer lock. Every cursor/evidence/budget write checks the live owner; stale workers cannot
  publish, advance progress or fail their replacement. Storage/integrity failures stop the run.
- Per-run source results and upstream cursors are different: the former freezes an edition's
  input; the latter continues acquisition across new runs. Partial progress can survive a failed
  edition. Account-specific caches never become public query input.
- Edition insertion, revision allocation, run completion and optional scheduled outbox intent share
  one transaction. Manual previews never insert an outbox row. No automatic retention/deletion:
  private evidence accumulates locally; a retention policy is still needed before production adoption.
- SQLite WAL/SHM sidecars may exist after inspection. `robin:storage` export does **not** back
  up this database. Back it up separately with SQLite backup/`VACUUM INTO`, not a live main-file copy.
  Do not downgrade a v4 file in place; use compatible code or preserve it and restore a verified
  offline older backup, understanding that later Brief-only data will not be in that old backup.
- Rollback stops new invocations/sends while retaining the new database and day ownership. Do not
  delete receipts to force the old scheduler to catch up; restoring old code after a live handoff
  requires an explicit no-replay plan. No live deployment cutover was performed in this implementation.

## Remaining slices

- **M2b expansion:** fixed feeds plus optional bounded public search now exist; enable only after a live editorial acceptance check. Search result coverage and matched page passages are not comprehensive current affairs or independent fact verification.
- **M3/M4 follow-up:** evaluate real editorial quality, stronger claim/date/relevance checks,
  provider token limits and comparison with old production. The shared preview reader is implemented;
  live model behavior and production acceptance are not certified by mocked tests.
- **M5 live acceptance:** outbox, consent/uncertainty, bridge handoff and receipt UI are implemented;
  first initialization and one live editorial sample are complete. Agreed first-live date, broader
  editorial checks, phone display/link validation and actual activation remain operator steps.
- **M6:** opt-in project knowledge and restricted browser lanes.

A future action spanning Brief and Todo needs idempotency in the target domain: separate SQLite
files do not provide a cross-database transaction. Legacy mail automation remains authoritative until the explicit handoff.

## Checks

```sh
node --experimental-strip-types --test extension/robin/brief*.test.mjs scripts/robin-brief.test.mjs \
  extension/robin/calendar-domain.test.mjs extension/robin/google-accounts.test.mjs \
  extension/robin/google-calendar.test.mjs extension/robin/mail.test.mjs extension/robin/ai-weekly-domain.test.mjs \
  lib/brief-runner.test.mjs lib/robin-assistant.test.mjs app/api/robin/brief/route.test.mjs \
  app/api/robin/brief/tick/route.test.mjs scripts/telegram/*.test.mjs lib/i18n/registry.test.mjs
ROBIN_TEST_TASK_BACKEND=json node --experimental-strip-types --test extension/robin/calendar-domain.test.mjs
node_modules/.bin/tsc --noEmit
node --env-file-if-exists=.env.local e2e/unified-brief.mjs
```

Tests cover cross-process claims, immutable versions, source isolation, bootstrap/history
pagination, oversized queues spanning runs, cursor expiry, deletion, account switching and
revocation, byte/call caps, cancellation/late owners, evidence tampering, checkpoint rollback,
all-unavailable fallback, offline upgrade/rollback and mocked CLI acquisition. Editorial tests add
bounded sampling, forged/cross-lane references, reserved/uncertain spend, publication rollback,
late cancellation, read-only HTTP, explicit consent and completion-notification isolation. The
browser suite uses synthetic APIs at 320/390/1440px in glass/dark themes, checks consent/reload,
same-ID retry, navigation races, shared Home/reader versions and narrow English source tabs.
Delivery tests add atomic rollback, no regeneration, hung/late/abandoned sends, finite retries,
legacy handoff before and after composition, DST/midnight, read-only derived receipts and route gates.
Public/calendar tests use mocked HTTP; the separate public-only URL/parser probe is described above.
These do not certify real-account Gmail/Google, live editorial quality, push display or native iPhone
behavior. The automated tests use no real model, mailbox, initialization, migration, activation or
send; the separate user-approved manual acceptance below is not presented as an automated test.

The final delivery/source/reading sweep passed **290 regression tests**, **22 JSON-backend
calendar/delivery tests**, TypeScript, targeted lint, targeted diff checks and both synthetic
Brief/Home browser suites. Screenshots (including large text and English 320px) were inspected.
These supersede the preceding 115-test preview sweep, not its unperformed live acceptance gates.
## Approved live acceptance — 2026-11-01

- User explicitly approved storage preparation and one real-data sample, **without phone sending**.
  The production Brief store did not exist. The supervised bridge was stopped briefly, v4 was created
  atomically with mode 0600 and integrity checked, and that same bridge service was restored. The Web
  process (hosting this session) stayed running; absent storage and the disabled schedule meant there
  was no pre-existing Brief run to migrate or drain.
- One manual `live` request read 3 calendar records, 7 local deadlines, 20 mail observations and 4
  publisher excerpts. Mail bootstrap hit its durable budget with 10 messages still queued. Both
  public feeds were read, but public coverage and model sampling remain explicitly incomplete.
- The real model returned one completed zero-tool response. It exposed a prompt/parser mismatch:
  the prompt allowed no extra interpretation, while the parser rejected an empty `why`. A failing
  synthetic regression reproduced it. Empty strings are now allowed only for optional interpretation;
  missing/non-string/oversized fields and empty facts are still rejected. The reader omits empty labels.
- No second model call was made. After a private, integrity-checked SQLite backup, the operator bound
  the completed Pi response to the exact frozen input hash, verified zero tool calls and all source
  evidence/passages, and saved that already-generated validated output under its existing reservation.
  The recovery was logged in `brief_steps`; retrying the same request published from the cache. This
  was a one-off checked recovery, not an automatic transcript-import or budget-reset capability.
- Published edition: `b9d216c5-9673-4bd4-bedd-9ed67a2fab22`, 2026-11-01 revision 1, eight editorial
  items; twelve available records were outside the model input. No source text or private task titles
  are copied into this operator record. No task/event writes or delivery intent were requested.
- Real authenticated browser reads checked 320/390/1440px, eight articles, no blank interpretation
  labels, and the matching **mobile** Home card/version link; screenshots were inspected. The first
  Home check incorrectly remained at desktop width, where that mobile surface is not mounted; it was
  rerun at 390px without a product change. Page checks blocked unexpected mutations and observed none.
  Native phone push/display remains untested. The outbox is empty and the schedule remains disabled.
- Follow-up regression: 69 affected domain/runner/route tests, TypeScript, targeted lint and the synthetic
  reader browser suite passed. Actual partial mailbox coverage must not be described as a full inbox review.

The unchanged `e2e/ai-weekly.mjs` currently has stale height limits (34px desktop/46px phone):
the current pill is 46px/54px, identical with the new Brief tab and overflow removed. An isolated
browser diagnostic confirmed those baseline heights and passed its remaining interactions;
the original suite and its assertions were not changed or reported as passing.
