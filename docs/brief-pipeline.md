# Unified Brief: shadow pipeline

The rebuild is specified in [PRODUCT](../specs/unified-brief/PRODUCT.md) and
[TECH](../specs/unified-brief/TECH.md). **M1 and M2a (Gmail acquisition) are implemented.**
Public research, Google event refresh and editorial generation are NOT yet implemented.

## Two explicit input modes

- `shadow`: the original M1 path. Reuse existing mail reviews, local calendar,
  open deadlines and today's stored weekly reading slot. No upstream refresh.
- `acquire`: opt into read-only Gmail acquisition for the primary Google account.
  The other three sources still use the M1 adapters. This is still a deterministic
  **shadow** edition, not a ranked, model-written daily brief.

Both modes use the same durable run claim, bounded execution, frozen source results,
validation, version publication and completion. Neither calls an LLM, changes a task
or event, marks a message read, sends anything, enables a scheduler, or switches the UI.
The shared Google token helper may refresh its existing OAuth access-token cache when
an operator explicitly runs `acquire`; acquisition does not change the grant or scopes.

Fresh mail is an **untriaged observation**, not automatically an action item. Reading
its text grants no authority. Stored reviews remain `stored-review`; reused weekly
passages retain their old dates/check times. Connected Google events remain explicitly
missing from the local-only calendar snapshot. Observation time is not event time.

## Operator commands

```sh
npm run robin:brief -- status
# New installations only: creates the Brief database, reads no sources.
npm run robin:brief -- init
# For an existing M1/v1 Brief database only; first STOP every Brief writer.
npm run robin:brief -- upgrade --writers-stopped
# No external acquisition:
npm run robin:brief -- shadow manual-stored-01
# Explicit read-only Gmail acquisition; use a NEW ID for each new bounded slice:
npm run robin:brief -- acquire manual-mail-01
# Private content; do not publish its output:
npm run robin:brief -- inspect manual-mail-01
```

These are operator instructions, **not commands executed against the user's data during
implementation**. Development tests use temporary `ROBIN_DATA_DIR` directories and mocked
network responses. No real inbox, database initialization or migration was run.

`status` without storage creates nothing. `init` never upgrades an old schema. A v1 store
requires the explicit offline upgrade, which verifies/fsyncs a `VACUUM INTO` backup before
one schema transaction. The acknowledgement flag does not stop processes. Invalid/newer
stores and active leases fail closed; a concurrent change during backup is refused.
The backup path is returned to the operator. Repeating an already completed upgrade is a no-op.

An identical request ID returns the same edition or resumes the failed operation with its
saved date, inputs and **remaining** request budget. It cannot switch `stored-v1`/`gmail-v1`
policies. A completed partial edition is immutable: use a NEW request ID to continue its
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
   timeout, not a new data-body reader. There are no model tokens or rate-limit/server-error retry
   loops; cursor/page recovery and metadata fallback consume the same request budget.
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

## Persistence and recovery

- New domain only: `$ROBIN_DATA_DIR/brief.sqlite` (default `~/.pi/robin/brief.sqlite`), schema v2.
  This does not migrate the task database or its operational-file allow-list, mail reviews,
  weekly records or delivery ledgers. Initial creation uses a private staging directory and `0600` file.
- V2 adds the input policy, source cursors/queues, immutable evidence, latest-record pointers
  and cumulative request reservations. M1 runs and editions survive the explicit upgrade.
- SQLite WAL + synchronous FULL, foreign keys and short transactions. No network awaits under
  a writer lock. Every cursor/evidence/budget write checks the live owner; stale workers cannot
  publish, advance progress or fail their replacement. Storage/integrity failures stop the run.
- Per-run source results and upstream cursors are different: the former freezes an edition's
  input; the latter continues acquisition across new runs. Partial progress can survive a failed
  edition. Account-specific caches never become public query input.
- Edition insertion, revision allocation and run completion remain one transaction. There is
  no outbox or delivery row yet, and no automatic retention/deletion. Private evidence accumulates
  locally; a retention policy is still needed before production adoption.
- SQLite WAL/SHM sidecars may exist after inspection. `robin:storage` export does **not** back
  up this database. Back it up separately with SQLite backup/`VACUUM INTO`, not a live main-file copy.
  Do not downgrade a v2 file in place; use compatible code or preserve it and restore a verified
  offline v1 backup, understanding that later Brief-only data will not be in that old backup.
- Rollback of the feature means stopping new shadow invocations. Existing production remains
  untouched. Keep the new database if its observations/history are wanted.

## Remaining slices

- **M2b:** bounded fresh Google snapshots and dated public-source acquisition/verification,
  independently scoped from private inputs. No unrestricted knowledge ingestion.
- **M3:** zero-tool editorial composition with strictly validated evidence references and
  relevance/coverage rules. Compare with old production; do not rename raw mail as a finished brief.
- **M4:** one edition for Day preview and the full Incoming/News reader.
- **M5:** transactional outbox, consent/uncertain-receipt handling, and an explicit old-scheduler
  handoff that preserves delivery history. No duplicate senders.
- **M6:** opt-in project knowledge and restricted browser lanes.

A future action spanning Brief and Todo needs idempotency in the target domain: separate SQLite
files do not provide a cross-database transaction. Existing mail automation remains unchanged.

## Checks

```sh
node --experimental-strip-types --test extension/robin/brief*.test.mjs scripts/robin-brief.test.mjs \
  extension/robin/calendar-domain.test.mjs extension/robin/google-accounts.test.mjs \
  extension/robin/google-calendar.test.mjs extension/robin/mail.test.mjs extension/robin/ai-weekly-domain.test.mjs
ROBIN_TEST_TASK_BACKEND=json node --experimental-strip-types --test extension/robin/calendar-domain.test.mjs
node_modules/.bin/tsc --noEmit
```

Tests cover cross-process claims, immutable versions, source isolation, bootstrap/history
pagination, oversized queues spanning runs, cursor expiry, deletion, account switching and
revocation, byte/call caps, cancellation/late owners, evidence tampering, checkpoint rollback,
all-unavailable fallback, offline upgrade/rollback and mocked CLI acquisition. They do not
certify live Gmail behavior, editorial quality, public research, delivery or mobile presentation.
