# Intermittent slowness: local investigation, 2026-10-31

## Scope and limits

Measured the existing Next 16.3.8 development server on loopback port 30141,
authenticated HTTP reads, Chrome with real data, isolated database fixtures, and
host resource usage. Browser mutation/model-start requests were blocked during
profiling. Database write benchmarks used a private SQLite online-backup copy,
removed afterwards; no production migration or bulk data repair was performed.
No service restart, production build, process termination or paid model probe.
Unrelated concurrent mindmap work was left alone.

These are local, development-mode samples, not a production SLA or a measurement
of the user's remote device. Mechanisms were reproduced; there is no timestamped
trace proving that any one mechanism caused every historical stall.

## Findings

| Layer | Observation | Interpretation |
| --- | --- | --- |
| Navigation payload | Full jobs board: 3,914,749 decoded bytes; badges now receive 29 bytes | Earlier fix removes irrelevant transfer, browser parsing, sorting and evidence checks from every workspace |
| Session catalogue | Earlier browser retest: four completed full downloads became one; roughly 9.7 MB became 2.4 MB decoded | Automatic reloads no longer compete with a slow in-flight list; explicit refresh still supersedes it |
| Jobs transport | Before: no Content-Encoding. After: 775,018 body bytes with gzip versus 3,914,749 identity | About 80% less network transfer; decoded JSON and synchronous server work are unchanged |
| Jobs storage | 5,941 rows, 41,629,250 bytes of JSON payload | The much larger stored JD/evidence collection is still read even for small responses |
| Direct domain reads, five samples each | readJobs 99–135 ms; navigation 93–173 ms; jobBoard 155–213 ms; scoringStatus 147–170 ms | Synchronous collection reads, JSON parsing, GC and evidence validation dominate |
| Cross-request interference | Light running-state pings: idle 5–20 ms; while five serial navigation reads ran, affected pings took 99–153 ms | Confirmed event-loop blocking, not a remote network explanation |
| A single-row job edit, disposable database copy | 167–185 ms in three runs | SQLite updates only changed rows, but the callback still reads/parses/compares the collection; not an indexed single-row domain operation |
| Round/OA list | Previously acquired BEGIN IMMEDIATE even when nothing changed | A different process's WAL writer could make a GET synchronously wait for a lock and fail |
| Browser, 4x CPU throttle | Jobs had a 376 ms long task and a 179 ms task; Notes/ Learn also had startup tasks around 150–220 ms; no page errors in these samples | Real startup work exists, especially with dev React, but no persistent multi-second main-thread freeze was reproduced |
| External root URLs, three samples each | OpenAI 201–481 ms / HTTP 421; Anthropic 144–303 ms / 404; Google 488–705 ms / 200 | Connectivity samples only; root status codes do not establish authenticated model endpoint health or inference latency |

A server CPU profile across repeated job operations put substantial self time in
`task-store.ts` row retrieval/parsing, GC and `job-evidence.ts:scoringContext`.
A naïve SQLite JSON status aggregation still took about 135–140 ms: moving an
unindexed full JSON scan into SQL alone did not fix the cost.

A 4x-throttled browser profile also showed dev JSX/React work, GC, date formatting,
role grouping and polling comparison work. It did not identify one dominant
application function warranting a speculative UI rewrite. Gzip's browser transfer
was independently observed as 775,318 bytes including reported response overhead,
with the original 3,914,749 decoded bytes.

Compression is a transfer trade-off, not a local CPU speed claim. A warm identity
sample completed in 201 ms; gzip samples completed in 235–276 ms locally.
On a constrained connection, reducing 3.9 MB to 775 KB is the intended gain.

## Fixes in this investigation

1. **Navigation read model** — `jobNavigationStatus()` and `?view=navigation`;
   no cached counts or pipeline writes. Full board remains available.
2. **Polling starvation** — interval ticks skip active headers/body downloads;
   explicit refresh can supersede them, with timeout and stale-cleanup fencing.
3. **Session list overlap** — automatic version polls wait for the current load;
   request cancellation, a 30-second timeout and returned-version comparison
   retain recovery and eventual refresh after concurrent changes.
4. **Round-list writer reservation** — `withTaskSnapshot()` shares a short SQLite
   read snapshot. Unchanged list calls return without reserving the writer. If
   reconciliation is required, it re-reads under the normal write transaction;
   it never publishes the optimistic snapshot or upgrades that reader to a writer.
5. **Jobs response compression** — reuse `jsonResponse`, negotiated gzip,
   `Vary: Accept-Encoding`, `no-store`; identity and small navigation responses
   remain uncompressed. `apiRoute` now accepts a standard streaming `Response`
   without changing its guard/error policy or wrapping its body.

The lock regression was first reproduced as `database is locked` with a second
connection holding a write transaction. After the fix the same test succeeds
while that writer remains active, then reconciles normally once its new todo is
committed. This removes unnecessary waiting, not all possible database contention:
a list that really must reconcile still requires a writer.

## Host observations

Earlier samples showed mediaanalysisd around 171% CPU, StorageManagementService
around 71%, and corespotlightd around 42%. A later sample instead showed the
ApplicationsStorageExtension around 55%, Atoll around 26%, WindowServer around
12%, and the mostly-idle Next process around 2%. This variation is compatible
with intermittent host contention, but it is not a causal trace of a user stall.

The later snapshot reported 16 GiB RAM, about 47% system-wide memory free by
`memory_pressure -Q`, and a roughly 1.6 GiB Next RSS: no clear memory shortage
in that snapshot. The data volume was about 91% used with 20 GiB available;
this is a capacity concern, not proof of an I/O bottleneck. Nothing was cleaned
or stopped as part of this investigation.

## Validation

Passed targeted TypeScript, ESLint and diff-whitespace checks. Automated coverage
includes JSON and SQLite round/domain behavior, planner acceptance/capture,
transaction rollback, migration/recovery, lease/state behavior, snapshot isolation
across another connection's commit, read-only enforcement, connection cleanup,
stream-response guards, compression negotiation, resource polling and session loads.
The two new reproductions failed before their fixes and passed afterwards.

Browser regressions passed against the existing server with writes mocked:

```sh
PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local e2e/robin-navigation.mjs
PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local e2e/background-polling.mjs
PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local e2e/session-list-loading.mjs
```

Storage/transport checks:

```sh
node --experimental-strip-types --test extension/robin/task-storage.test.mjs extension/robin/task-upgrade.test.mjs extension/robin/runtime-state-storage.test.mjs extension/robin/rounds.test.mjs lib/api-route.test.mjs lib/json-response.test.mjs app/api/robin/jobs/routes.test.mjs
ROBIN_TEST_TASK_BACKEND=json node --experimental-strip-types --test extension/robin/rounds.test.mjs app/api/robin/jobs/routes.test.mjs
node --experimental-strip-types --test extension/robin/domain-writes.test.mjs extension/robin/planner-domain.test.mjs
ROBIN_TEST_TASK_BACKEND=json node --experimental-strip-types --test extension/robin/domain-writes.test.mjs extension/robin/planner-domain.test.mjs
```

## Remaining priorities

1. **Stop loading the entire jobs collection for small reads.** Add domain-owned
   indexed projections for navigation/status and bounded board queries; fetch
   full JD/evidence only where required. Preserve profile-dependent evidence
   validation, user statuses and grouping semantics. A schema change needs an
   explicit versioned migration and stopped-writer procedure, not an online ALTER
   or a cache that silently misses updates from Telegram/other processes.
2. **Make targeted job writes actually targeted.** Where a domain operation knows
   its IDs, avoid reading/comparing all jobs while holding the one writer. Keep
   cross-record merge, ownership, rollback and stale-write guarantees intact.
3. **Capture the remaining slow action on the actual device.** Separate connection,
   server wait, transfer and main-thread work. Loopback cannot measure Wi-Fi,
   tunnels, reverse proxies or handset CPU.
4. **Measure an intended model turn, not a synthetic paid request.** Record timing
   for dispatch, first upstream event/token and completion; distinguish provider
   wait from local session/tool work without logging credentials or message content.
5. **Recheck host contention during a reported stall.** Background CPU and disk
   capacity deserve observation; process termination or cleanup needs separate
   approval and is not a substitute for correcting request-path blocking.

## Follow-up: primary-key operations and narrow navigation aggregation

Implemented without a database/schema migration or a cache. ID-scoped reads and
writes now select only existing requested rows through SQLite's primary key.
Targeted updates/deletes preserve positions, never insert unselected IDs, and
re-read under the original transaction/ownership boundaries. JSON and mixed-v1
paths keep their legacy file locks and fail-closed selector checks.

Adopted for job detail reads/hydration commits, note/status edits, deletion, bulk
status changes, notification claims, application readback and single-record
application updates. Scoring/backlog, intake, application reservation and the
submission grant retain full-collection access where their policy requires it;
no duplicate protection, approval check or daily budget was weakened.

Navigation now groups a `MATERIALIZED` projection containing only status strings.
This distinction matters: a direct JSON-expression GROUP BY measured 94–137 ms
on a snapshot (and a cold live query took 416 ms), while materializing just the
small values took about 24 ms. The direct query can sort/copy complete payloads
into a SQLite temporary B-tree. This explains why the earlier naïve SQL aggregate
was not an improvement. Selected reads likewise sort row references by position
in JS, rather than spilling selected payloads into a SQL sort; a 5,000-ID read
fell from about 197–207 ms to 88–102 ms during this follow-up.

Six paired samples on a private SQLite online-backup copy of the same 5,941 jobs;
the copy was deleted afterwards and the original database was never edited:

| Operation | Previous full-collection path | New path |
| --- | --- | --- |
| Navigation counts | 95–110 ms | 23–25 ms |
| Known-ID lookup | 93–102 ms | 0.60–1.02 ms |
| One job note edit | 160–179 ms | 1.01–1.48 ms |

The selected query plan reports `SEARCH jobs USING INDEX sqlite_autoindex_jobs_1
(id=?)`, not a full jobs-table scan. A real authenticated HTTP retest gave six
warm navigation responses of 29–31 ms, still 29 bytes, versus the earlier roughly
119 ms sample. During five serial navigation reads, light running-state pings
were 8–47 ms in this sample, versus the earlier affected 99–153 ms. These are
local development samples, not a percentile guarantee.

Regression tests first failed for selected ordering and unrelated deserialization,
then passed. Coverage includes SQL/JSON equivalence, empty/missing/duplicate and
large ID selections, special string-field values, preserved unknown fields,
selected deletion/order, synchronous callback enforcement, rollback, nested writes,
mixed-v1 behavior, and fail-closed selector mismatch. Domain-level checks reject
accidental deserialization of an unrelated job during known-ID operations.

**Still not eliminated:** full board and scoring reads, unindexed status scanning,
large collection-wide mutations, and synchronous waits for genuine write conflicts.
This follow-up reduces frequent avoidable work; it does not claim that all
request-path blocking or upstream model/network latency has been solved.

## Follow-up: metadata-first board and scoring reads

A later snapshot held 5,932 jobs: 4,795 dropped, 152 applied, 985 new. Full payloads
contained about 36.6 million JD characters. Reading all of those descriptions
for every board/scoring-status poll was unnecessary.

Added a read-only two-phase view: project away description/review/application,
then hydrate all new/shortlisted rows by primary key in the same SQLite snapshot.
Historical metadata stays intact, including Applied URLs for pending-job dedupe,
ordering fields, stale-score flags, notes and unknown fields. Active jobs retain
full evidence; profile/context checks are unchanged. JSON/mixed-v1 reads parse
once instead of loading the entire file twice. These views are never persisted.
The board, scoring status/counts/IDs, and job list/pending tools share this path.

Also moved status/date/title/location/blacklist rejection ahead of JD/profile
hashing inside `pendingJobs`. Shortlists still bypass discovery filters, but
never evidence validation. Applied dedupe and queue ordering are unchanged.
Scoring writes still calculate their backlog from the full in-transaction array;
intake, application reservations/submission gates and digest duplicate protection
were not switched to partial records.

Six paired runs on a private online-backup copy with its matching profile, checking
complete board/status equality against the previous full-read/evidence-first
implementation each time (the copy was then removed):

| Domain operation | Previous | New |
| --- | --- | --- |
| Complete job board | 150–175 ms | 111–116 ms |
| Scoring status | 148–166 ms | 84–94 ms |

The complete board JSON stayed 3,907,515 bytes on this snapshot: this change
reduces server work, not the returned list or its rendered fields. Five warm
live HTTP reads measured 182–186 ms for the compressed board (including body
consumption/decompression) and 93–96 ms for scoring status.

Regression coverage verifies full-record parity after CV/filter changes, valid
and stale review behavior, full pending JDs, inactive stale flags, Applied URL
deduplication, no historical-evidence deserialization in SQLite, unchanged stored
records, and JSON/mixed-v1 behavior. A second connection commits a changed status
and JD between projection/hydration in a fixture: the view must still return one
consistent snapshot. A getter-based exclusion test failed before the predicate
reorder and now proves excluded JDs are not inspected while shortlists are.

Remaining limits: metadata still scans all rows, active evidence is still read
and validated synchronously, the complete browser list is still large, and genuine
write conflicts/upstream model/network delays remain separate work.

## Follow-up: hourly session maintenance was blocking unrelated requests

A fresh cross-page investigation found another synchronous request-path loop in
`lib/session-history-retention.ts`. The full `/api/sessions` response awaited
an hourly sweep that synchronously statted/read/parsed every eligible historical
JSONL file. `Promise.resolve().then(...)` merely deferred it to a microtask; it
never allowed other requests to run between files. Recent log slow samples had
4.5–5.0 s in **application-code**, not compilation, so these cannot simply be
explained away as development compilation. This identifies a blocking mechanism,
not proof that it caused every historical slow request.

### Baseline and change

- Current catalogue: 2,736 sessions; 2,533 eligible files, 340 MiB, largest about
  10 MiB. A separate-process **read-only** scan of those original files took
  **3,188 ms**, with a largest per-file read/parse of **41 ms**. It reported zero
  files needing any changes. No original file was rewritten by this probe.
- The list now schedules maintenance without awaiting completion. A changed
  sweep invalidates the list cache once; ordinary version polling observes it.
- The sweep yields to I/O before starting and between files after a soft 4 ms
  budget. Liveness is checked after yielding; checking/rewrite of an individual
  file stays synchronous. This is not a hard per-file/GC latency guarantee.
- A fresh stat fingerprint (device/inode/size/mtime/ctime) skips payload reads
  only while the file is unchanged **and** no future entry expiry is due.
  Post-rewrite fingerprints are stored, and absent paths are evicted. Future
  payload expiry, external edits/replacement and existing safety guards remain
  covered; the retention policy itself is unchanged.

### Paired measurements, not inferred gains

Baseline ref: `a8104560bca6e7338a6af56d12ecc2c57a70d281`. A private directory
(mode 0700, copied files 0600, removed afterward) held the same 2,533-file / 340 MiB
snapshot for both implementations. Four paired runs used the **actual exported
session GET handlers** behind a disposable loopback Node HTTP adapter, with
identity bodies and a warm catalogue. This isolates maintenance without launching
another Next dev process or touching real history. These are **fixture HTTP
measurements, not live Next timings or pure function benchmarks**. Each response
was completely consumed/parsed and compared for full payload equality (excluding
the cache-version counter).

| Same snapshot, four runs | Previous | New: first scan | New: unchanged files |
| --- | --- | --- | --- |
| List HTTP response incl. body/JSON | 807–822 ms | 37–41 ms | 21–24 ms |
| Largest 5 ms heartbeat interval | 802–817 ms | 27–28 ms in three runs; **236 ms** in one | 13–14 ms |

The cold sweep still took roughly 0.8–1.1 s to finish in this fixture; the response
no longer waits for that work. The heartbeat includes the adapter/client's work
and is not a browser metric. The 236 ms outlier is retained in the results; single
file work/GC/scheduling can still cause a noticeable pause. The original-file
3.19 s scan and copied-file timings have different filesystem/cache conditions
and must not be presented as one before/after pair.

Probe and raw run log during this investigation:
`/tmp/robin-retention-probe.mjs`, `/tmp/robin-retention-bench.log`.

### Running application and regression checks

The existing Next process remained on port 30141, with no restart/build. Its
compiled route and helper chunks contain the new detached scheduling/yield
implementation. Authenticated requests were made after HMR, and five warm reads
per endpoint (first sample discarded) gave:

| Live Next endpoint | HTTP incl. body consumption | Decoded bytes |
| --- | --- | --- |
| `/api/sessions` | 25–28 ms | 2,427,101 |
| `/api/agent/running` | 3–5 ms | 192 |
| `/api/robin/jobs?view=navigation` | 29–33 ms | 29 |
| `/api/robin/jobs` | 180–215 ms | 3,907,515 |
| `/api/robin/events` | 7–21 ms | 194,187 |
| `/api/robin/planner` | 10 ms | 22,697 |
| `/api/robin/notes` | 4–5 ms | 14,920 |

All returned 200. These live warm checks prove the loaded application remains
functional, **not** a paired measurement of a forced live hourly sweep. We did
not reset the running process's maintenance clock or force real history cleanup;
the triggered-sweep comparison and all write/expiry tests used private fixtures.

- Added regression cases failed against the original scheduling/cache behavior
  before the fix. Tests now cover first/inter-file I/O yielding, sessions becoming
  live while queued, once-per-sweep notification, time-based expiry, same-size /
  same-mtime replacement, post-write fingerprints, cache eviction and existing
  transient/recent/live/missing-file guards. An actual-route test holds a sweep
  pending and verifies that the list still responds.
- **125 tests passed** across retention, runtime routes, session readers/external
  writes/pagination, membership, incremental scanner, view cache and sidebar.
  TypeScript, targeted ESLint and `git diff --check` passed.
- Existing-server Chrome checks passed: `e2e/session-list-loading.mjs`,
  `e2e/robin-navigation.mjs`, `e2e/background-polling.mjs`. Application mutations
  and model-start requests were mocked. Navigation remained soft, hidden polling
  paused/recovered, and slow catalogue loads did not accumulate duplicate polls.

### Still unverified or unfinished

The sampled chat allowed scrolling/typing without a persistent multi-second
browser freeze, but startup profiling still showed audio initialization,
auto-scroll/layout, development React work and GC costs. No speculative audio or
scroll change was made. The jobs board still transfers about 3.9 MB decoded.
Actual user-device network/tunnel latency, upstream model first-token time, and
host contention at the moment of a reported stall remain uncorrelated. This fix
removes one measured global blocking path; it is not a claim that every source
of slowness has been eliminated.

## Follow-up: cross-workspace audit and repeated data work

The next pass traversed 25 entry URLs in authenticated disposable Chrome contexts:
chat, dashboard, Jobs, Gmail, Events, learning home/FSO/GPT-2/roadmap/watch, coding,
notes, products/validation, research, Obsidian, recordings, CRM/batch outreach,
settings, Mac tools, and legacy podcast/outreach/weekly aliases. Non-GET API traffic
was blocked after login; no prompts, research, sends, application submissions or
business edits were used as performance probes. The coding iframe's external
metadata POST was also blocked, so this does **not** validate that embedded site's
full behavior. Profiles record resource sizes/counts, long tasks, DOM/heap totals
and page errors, not message/contact content.

### Changes retained after verification

1. **Coalesce overlapping automatic reads across Robin panels.** The dashboard
   completed four downloads of its identical todo response at startup. The shared
   resource hook now shares only the active transport/body by full URL. Each
   subscriber owns its mutable parsed data, timeout and sequence/write fence;
   settled responses are immediately removed from the sharing map. Aborting one
   subscriber cannot cancel another. One-microtask last-reader cancellation permits
   React development effect replay to reuse the request. Explicit refresh and
   visibility return still start fresh, and a confirmed write prevents later
   automatic readers joining a pre-write flight. Live browser checks now complete
   **one** todo download; the old Strict Mode throwaway reads are also reduced
   across workspaces. This is not a TTL cache and does not conceal later writes.
   Async actions finishing after a URL change now refresh the current URL; their
   old receipts cannot replace another scope's data.
2. **Share identical forced chat detail reads.** The old single-flight map excluded
   `force`, so mount replay downloaded the same history and live state twice.
   Flights now distinguish session ID, force and state requirements, coalescing
   exact matches without removing the disk freshness check. The browser fixture
   failed with two pending detail requests before the change and passes with one
   detail plus one state request. The live selected chat likewise went from two
   of each to one. Its payload changes as this investigation grows, so only the
   request multiplicity—not a paired byte/latency claim—is compared here.
3. **Load Jobs by selected status, not the entire history every 30 seconds.**
   The optional `status` GET parameter returns complete summaries for that scope;
   default GET remains the original full board. Small global card-ID membership
   and match/notification inputs preserve role counts, local-day lede, duplicate
   sources, pending delete/undo and cross-stage navigation. All/history remain
   available. A response's scope gates rendering and scroll restoration while a
   different tab loads. Evidence validation remains fresh for selected active
   jobs; queue/full reads still hydrate all active jobs. No stored rows change.
4. **Application readback does not parse posting text/scoring reviews.** It uses
   the existing snapshot view, keeping all application evidence and attempt,
   receipt, dismissal and legacy counts. Candidate selection, reservation,
   duplicate locks, authorization and submission gates are unchanged/full-record.
5. **CRM GET compresses its full readback.** Reused `jsonResponse` with negotiated
   gzip, `Vary: Accept-Encoding`, `no-store` and identity/disabled-gzip support.
   No contacts, drafts, evidence, outbox/research state or write APIs were changed.

### Measurements and their scope

| Operation | Before | After | Evidence scope |
| --- | --- | --- | --- |
| Default Jobs decoded response | 3,907,519 B | 946,783 B | Same current board vs New scope, 984 of 5,932 rows |
| Default Jobs gzip body | 773,846 B | 202,572 B | Five paired authenticated live HTTP samples |
| Jobs HTTP + body/decompression/JSON | 185–221 ms | 138–175 ms | Same five pairs; row/card parity asserted |
| Application board function | 94.58–96.61 ms | 39.26–44.00 ms | Six paired private SQLite online-backup samples; 58 records, complete output parity |
| CRM body on the wire | 5,115,270 B | 876,616 B | Five real GET samples per encoding before/after; decoded SHA-256 identical |
| CRM loopback HTTP with gzip requested | 31–56 ms (identity served) | 88–94 ms | Compression costs CPU locally; do not claim loopback speedup |
| CRM browser fetch at 10 Mbps / 40 ms latency | 4,212–4,279 ms | 793–888 ms | Four paired identity/gzip fetches against the live endpoint, identical decoded hashes |

The controlled 10 Mbps link is a CDP simulation, **not** a measurement of the
user's actual Wi-Fi/tunnel. Default Jobs no longer sends unrelated historic
reasons/rows, but it is scope loading rather than server pagination: All or a very
large individual stage can still produce a large payload. CRM still decodes
5.1 MB; compression does not remove parse/render memory costs.

Raw local probe artifacts: `/tmp/robin-surface-before.jsonl`,
`/tmp/robin-surface-after.jsonl`, `/tmp/robin-surface-additional.jsonl`,
`/tmp/robin-job-scope-wire.log`, `/tmp/robin-application-bench.log`,
`/tmp/robin-crm-before.jsonl`, `/tmp/robin-crm-after.jsonl`,
`/tmp/robin-crm-network.jsonl`. Domain write tests/benchmarks used disposable
private directories, removed afterward. The broad after-pass overlapped browser
regressions, so its individual timings are **not** paired speedup evidence; the
Jobs HTTP samples were rerun afterward in isolation. Counts/sizes and explicit
paired probes above are the retained quantitative claims.

### Regression/landing checks

The existing Next process loaded the changed paths via HMR; live Chrome observed
the scoped Jobs response, CRM gzip bytes, single todo body and single chat detail /
state reads. No restart, production build, migration, process termination or forced
history cleanup was performed. The application readback was verified both through
its live endpoint and the snapshot benchmark; writes remained on fixtures only.

- Unit/domain/adapter checks: resource overlap, replay, cancellation, shared slow
  bodies, deadlines, stale-response fencing, receipt failure/retry, URL changes
  during writes; chat lifecycle; JSON/stream negotiation; jobs full/scoped evidence
  parity; card membership with hidden IDs; storage snapshots/selection; application
  authorization/deduplication/submission invariants. Final combined run: 152 passed;
  JSON backend follow-up: 48 passed.
- Chrome regressions pass: `session-list-loading`, `jobs-board` (both languages,
  desktop/mobile, actions/undo/search/Applied/pagination), `board-navigation`
  (now genuinely scoped, including delayed scope/history/scroll changes),
  `background-polling`, and `robin-navigation`.
- TypeScript, targeted ESLint and whitespace checks pass. Unrelated concurrent
  notes/mindmap/dashboard changes were left intact.

### Findings not disguised as fixes

Legacy `/podcasts`, `/outreach`, and `/dashboard/ai-weekly` redirect entry points
can raise a browser-only `Performance.measure` negative-timestamp error. A fresh
six-navigation reproduction saw it on all three podcast visits and two of three
outreach visits. Stacks point to Next's bundled React Server Components
`flushComponentPerformance`: its rejected-component path clamps the start but
passes an unclamped children end time. These pages use `redirect()`; their actual
canonical destinations (`/dashboard/gmail?feed=podcasts`, `/outreach/research`)
rendered without that error. No global error suppression, performance monkeypatch,
node_modules edit or unverified dependency upgrade was applied. Legacy redirect
instrumentation remains an upstream/dev-runtime issue, not a claimed app fix.

Host contention is still real but uncorrelated: one sample had Spotlight around
189% CPU; a later sample had two Storage Management processes around 46–47% each.
The data volume had about 17 GiB free / 92% used. Across this investigation,
including broad route compilation and concurrent development, the long-running
development process's reported RSS ranged from roughly 2.4 GiB into the 7 GiB
range. A later `top` reported about 4,961 MiB memory and 1,708 MiB compressed for
that process, with about 2 GiB system unused. Read-only `vmmap -summary` reported
a 5.0 GiB footprint and an 11.5 GiB lifetime peak; the peak's time/cause is unknown.
These metrics are not interchangeable, and the observation alone does not
establish a JS leak or attribute growth solely to the traversal. No current
swap-in/out activity was shown in the `top` sample. Further heap /
development-versus-isolated-production diagnosis is needed before choosing a
runtime/configuration fix. Blind cache deletion or restarting away the symptom is
not performance verification.

Chat startup still has sampled 100–200+ ms long tasks; no sustained typing/scroll
freeze was reproduced. Real device/network and model first-token latency remain
unmeasured. This pass substantially reduces repeated work and transfer, but does
not justify claiming that every possible source of slowness is solved.

## Follow-up: CRM provenance, a reproduced native-buffer leak, and card payloads

### Which CRM, and why 5 MB?

The measured endpoint is `/api/robin/jarvis`, used by the current Cold Reach UI
at `/outreach/research`. The domain reads the cumulative `jarvis-discovery.json`;
a new UI did not create a separate new database. A fresh response contained 816
contacts: 24 assessed under v2, 312 under v3, 297 under v4, 101 under v5, and 82
under v6. Of the v6 records, 74 passed the **current runtime predicate**. These
are research assessments/qualifications, not outreach approval or consent.

All 816 full records were downloaded even while the default list showed the 74
current candidates. Per-field serialized contributions (excluding surrounding
commas): generated `socialTemplateDrafts` 904,918 B; `newsBurden` 621,064 B; saved
email `body` 619,964 B; approved `outreachPlans` 266,049 B; `opener` 249,184 B;
`needHypothesis` 200,315 B; `watchList` 172,750 B; `socialOutreach` 160,974 B.
The response is mostly actual records plus repeated generated preview text, not
an accidentally loaded backup file. No contacts or files were deleted.

### Confirmed leak: Node 26.3.1 Blob streams

A temporary authenticated audit adapter collected **numeric** V8/process/cache
metrics and invoked full GC through an in-process inspector session. No inspector
TCP port, heap snapshot containing private values, paid probe, service restart,
cache clearing or business mutation was used. GC requests took roughly 0.54–0.64 s;
this was bounded diagnostic work, **not** a proposed periodic-GC fix. The adapter
was removed afterward.

Five rounds of sixteen serial reads of CRM, All Jobs, application board and
scoring status reproduced ~34.4 MiB retained-buffer growth per round, **after GC**.
The JS heap, contexts, file/session cache counts and handles did not show the
same payload-proportional growth. This pointed to response buffers, not simply
lots of JS sessions. An independent 4 MiB synthetic body isolated the problem:

| Disposable process, 30 repeated consumptions + GC | Retained ArrayBuffers | Observation |
| --- | --- | --- |
| `Blob.stream()` → `CompressionStream` → consumed Response | 138,296,788 B | grew with every request; RSS also grew |
| String Response body → same compression | 146,559 B | essentially flat after warm-up |
| `Blob.stream()` without compression | 138,231,252 B | also reproduced; compression is not the cause |
| Native FormData containing Blob | 138,231,252 B | multipart encoder also streams Blob |
| Blob `.arrayBuffer()` directly | 80,099 B | no linear retained-buffer growth in this test |

The shared `jsonResponse` now supplies `CompressionStream` with a string
Response's body instead of Blob. This affects every existing consumer, not a
patch only on CRM. Enabling jobs/CRM gzip earlier had amplified this pre-existing
helper/runtime problem; the earlier transfer wins were not proof of memory safety.
The new regression first failed with **8,454,320 retained bytes** after sixteen
512 KiB responses, then passed after the source-stream replacement. UTF-8 JSON,
encoding quality negotiation, `Vary`, `no-store` and other response headers round-trip.

The same live PID, without restarting or clearing caches, was then measured with
the same 80-read sequence:

| After-GC endpoints | Before fix | After fix |
| --- | --- | --- |
| ArrayBuffers, warm → final round | 939.67 → 1,111.73 MiB | 1,115.12 → 1,117.74 MiB |
| Growth | **172.06 MiB**, linear per round | **2.62 MiB**, no per-round linear pattern |
| Native / detached V8 contexts | 110 / 0 | 110 / 0 |
| SessionManager cache / active wrappers | 12 / 3 | 12 / 3 |

Other activity continued in the development process, so the small after-change
variation is not presented as zero allocation. Source review also confirmed the
SessionManager cache's 12-entry/256 MiB file-size budget, the browser view cache's
8-entry/32 MiB budget, wrapper shutdown cleanup and the one-entry model runtime.
These counts/budgets are not exact retained-heap measurements. The ~2.1–2.2 GiB
JS heap and the remaining native/runtime memory were not fully attributed; this
**does not rule out every other leak**, especially during different or much longer
workloads. Already leaked native buffers did not disappear with HMR/GC. A later
controlled restart can reclaim that old accumulation, but none was performed.

The source scan found two other server Blob upload sites. Cloud transcription
and Notion attachment sending now use `multipartBody` with existing bounded
in-memory bytes, preserving field order, FormData CRLF/disposition escaping,
UTF-8 filenames, binary contents and MIME handling. It uses no dependency or
filesystem staging. Notion retains direct Undici transport; the patched global
fetch, confirmation, authorization and send rules are unchanged. Synthetic
30-upload consumption retained **81,027 B**, versus 138,231,252 B for native
Blob multipart. RSS can remain high from allocator reservations even when these
buffers are released—another reason not to classify leaks by RSS alone.

Unit tests compare encoded bytes with native FormData (normalizing only the
random boundary), including quotation/CRLF injection cases and binary/Unicode
files. Mocked Notion uploads and transcription preserve exact fields and files;
recording and Telegram regressions pass. No real Notion or transcription upload
was sent. Long-lived CLI/Telegram processes still need their normal reload/restart
to adopt changed source; those services were not restarted for this audit.

Artifacts: `/tmp/robin-memory-probe.log`, `/tmp/robin-memory-after.log`,
`/tmp/robin-stream-memory.log`, `/tmp/robin-blob-followup.log`,
`/tmp/robin-upload-memory-after.log`. The permanent isolated reproductions are
`lib/json-response.test.mjs` and `extension/robin/multipart.test.mjs`.

### Smaller read payloads, without deleting history or weakening evidence

CRM's opt-in `?view=compact` omits only generated template previews, marking them
`templateDraftsDeferred`. Shared pure interpolation produces identical previews
lazily in the browser, memoized per lead only when read. Saved/approved/sent drafts
and every old/new contact remain untouched. This reduces decoded JSON by 17.7%;
wire savings are smaller because repeated template text already compresses well.
Default/tool/export responses remain full and backwards-compatible.

Job card mode (`view=cards`) drops only retrieval/scoring internals—`ref`,
`alternateUrls`, `yearsRequired`, `scoredAt`, `scoredBy`, `scoreContext`—**after**
full evidence checks. Notes, reasons, stale flags, URLs, dates and grouped-action
IDs remain. The full read/detail/tool responses and stored records keep all of
these fields. Both the Jobs board and Home preview opt in; Home asks for New.

| Same-data paired live reads | Before decoded / gzip bytes | After decoded / gzip bytes |
| --- | --- | --- |
| CRM | 5,115,270 / 876,615 | 4,209,566 / 840,564 |
| Jobs · New | 946,783 / 202,572 | 789,024 / 176,199 |
| Jobs · All | 3,907,533 / 773,855 | 3,047,804 / 643,212 |

Five pairs per view asserted exact semantic parity (CRM previews reconstructed;
Job internals removed from expected output). All Jobs read/body/decode took
194–201 → 187–192 ms. CRM ranged 96–152 → 87–170 ms, and New included a 440 ms
after-change outlier versus 156–176 ms before; **no consistent latency improvement
is claimed for those two**, despite real payload savings. Other activity/HMR was
not isolated enough to attribute those outliers. This is not server pagination:
large scopes still transfer many rows, and CRM still downloads most historical
fields. Splitting list summaries from on-demand details/history remains a possible
next improvement, requiring preservation of global counts, search and review.

Live Chrome then observed the compact responses (4,209,566 and 789,024 decoded
bytes), without page errors. `e2e/crm-read-payload.mjs` compares current/historical
list access, global counts and exact customized preview text at 1440/390px with
all business writes blocked. Existing Jobs tests passed in English/Chinese,
including sources, actions, undo, Applied log and pagination; scoped board-history
scroll tests also passed. No real CRM/job mutations or outreach occurred.

Validation: 138 domain/adapter/response checks, 41 JSON-backend checks, 38 related
session/retention/response checks and 53 multipart/Notion/recording/Telegram checks
passed (these suites overlap; not a unique-test total). TypeScript and targeted
ESLint passed at the final check; an intermediate concurrent voice-workspace type
error had resolved without editing that unrelated work. Raw results are in
`/tmp/robin-payload-tests.log`, `/tmp/robin-payload-json-tests.log`,
`/tmp/robin-memory-regressions.log`, `/tmp/robin-upload-memory-tests.log`,
`/tmp/robin-payload-after.log` and `/tmp/robin-payload-live-browser.jsonl`.
