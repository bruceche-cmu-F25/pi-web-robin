# Robin SQLite storage: explicit cutover and versioned upgrades

Robin's selected SQLite database is `~/.pi/robin/tasks.sqlite`, or the same file
under `ROBIN_DATA_DIR`. Historical `task-*` module/command names and the database
filename are retained so phase-1 installations upgrade in place.

| Schema | SQLite collections | Still JSON |
| --- | --- | --- |
| No selector (`0`) | None | All existing data |
| `1` | Todos, OA/interview rounds | Other collections |
| `2` | The six collections: todos, rounds, local events, links, jobs, tech events | Operational state and other domains |
| `3` (current) | All v2 data plus the 11 registered operational documents below | Everything not listed |

V3 adds one `runtime_state` row per **existing** operational JSON object:

- `background-runs.json`: named background owners and heartbeats.
- `job-scan.json`, `job-scoring.json`, `job-sweep.json`: progress, leases and cursors.
- `tech-event-scan.json`, `round-scan.json`: checkpoints.
- `telegram-state.json`, `job-digest-state.json`, `gmail-digest-state.json`,
  `reminder-state.json`: delivery history, including legacy single-run shapes.
- `mail-review.json`: the review and locally handled email flags.

The allow-list and state shape checks live in `runtime-state-schema.ts`. Missing
objects stay absent; migration does not create `{}`, expire leases, reset cursors,
trim delivery history or send notifications. Extra fields and original shapes survive.
Adding another filename later requires a schema migration, not just a registry edit.

Practice, course progress, notes, products, profiles, assistant session registries,
CRM/outreach, caches and credentials remain on their current storage. Attachments
stay files; Pi SDK session JSONL stays unchanged. Google calendar remains read-only
and its fetched events are never imported into the local calendar table.

`task-storage.json` explicitly selects a schema/backend. There is no import on GET,
no automatic startup migration, and no dual writing. V1 installations can keep
running with v1 task/round SQLite plus the remaining JSON until an offline upgrade.
V2 also remains supported; `check` now calls it `mixed` because its operational
state has not moved yet. This does not move any existing SQLite collection back to JSON.
A missing, corrupt, unsupported or mismatched selected database **fails closed**;
never revive old JSON merely to make an error disappear.

## Implementation and limits

- Node's built-in `node:sqlite`, using the existing Node >=22.19 requirement; no
  ORM or native dependency. Some Node versions print an experimental warning.
  The domain, HTTP and Pi tool interfaces remain unchanged.
- `task-schema.ts` owns the versioned collection catalogue, legacy filenames and
  core field constraints. Each document is one row with a unique ID and stable
  position. Unknown fields, timestamps, scores/evidence, flags and user notes are
  preserved verbatim. `tech_events` maps to the legacy `tech-events.json` filename.
- Only changed rows are written. Domain callbacks still read a collection; this
  adds transactions and removes whole-file rewrites, not indexed versions of
  every search/filter query. Position indexes serve ordered reads. Operational
  documents are read/upserted individually by primary key; nested writes to another
  document cannot be overwritten by a stale whole-state snapshot.
- WAL, `synchronous=FULL`, a 5-second busy timeout and `BEGIN IMMEDIATE` before
  write-side reads. Nested calls share a connection/savepoints across HMR and jiti
  copies. Connections close after each outer operation. SQLite still has one
  writer, and synchronous operations/busy waits still block the Node event loop.
  No awaits/network inside transactions. Use local disk, not NFS/cloud-sync storage.
- Closing/reopening a round and its todo is one SQLite transaction. Missing todos
  are historical links, not cascading foreign keys; I/O/SQL errors roll back both.
  Todo-to-round reconciliation keeps its list-time behavior, now within a snapshot.
  Existing optimistic task revisions and batch-plan stale checks remain intact.
- Tech event flags, expiry and scan merging read/mutate under the same transaction
  (or legacy file lock). The scan's ownership fence wraps the final merge rather
  than writing a stale precomputed list. Host data can refresh without overwriting
  a concurrent flag edit. In v3 its list and checkpoint commit/roll back together.
- V3 ownership checks and their synchronous domain writes share the SQLite
  transaction. Claims, heartbeats, release, mail completion and ledger marks are
  read/merge/write operations, not unlocked read-then-replace operations. Before v3,
  JSON ownership locks remain outside SQLite writer transactions to retain lock order.
- Delivery history is not a network outbox: `pending` -> remote send -> `mark` is
  still not an exactly-once send protocol. Migration preserves deduplication history
  but does not eliminate the crash window between sending and recording a mark.
  No network request is held inside a database transaction.
- A transaction only covers SQLite participants. Before upgrading, do not assume
  JSON state or domain writes roll back with SQLite writes. A scan with multiple
  async fetch/commit stages is not one giant transaction, even after v3.

## Read-only preflight

From the repo root:

```bash
npm run robin:storage -- check
# With an override (use it consistently for every process/command):
ROBIN_DATA_DIR=/absolute/path/to/robin npm run robin:storage -- check
```

Output includes `schemaVersion`, `backend` (`json`, `mixed`, `sqlite`), counts for
the six collections plus `runtime_state` (number of stored documents, not sends),
`missingStateFiles`, linked rounds, and historical orphaned round IDs. It never
normalizes dates, removes records or relinks orphans. Malformed JSON, duplicate
IDs and incompatible shapes block import. Do not replace bad sources with `[]` or `{}`.
Only not-yet-migrated JSON is read; old task/state JSON cannot override SQLite data.

## Offline cutover / upgrade

1. Finish agent turns and stop **all** writers: Web, Pi processes with Robin loaded,
   Telegram, scheduled runners, older deployments, and supervisors restarting them.
   Use an external terminal, not the live chat hosted by a process you must stop.
2. Run the same command for a fresh import or a v1/v2 → v3 upgrade:

   ```bash
   npm run robin:storage -- migrate --writers-stopped
   npm run robin:storage -- check
   ```

   The flag acknowledges that you stopped writers; it **does not stop them**.
3. Confirm `schemaVersion: 3`, `backend: "sqlite"` and expected counts, then restart
   every writer with the current code. Already-loaded old extensions must not keep
   running. Check the dashboard; `/robin-status` reports the selected database.
   Preserved fresh leases can briefly delay a replacement owner until their normal
   timeout; migration intentionally does not clear owners or force a scan.

### Fresh import

The migrator locks pending legacy files, validates all collections, backs up exact
source texts to private `backups/tasks-pre-sqlite-*`, and records hashes/counts in
its manifest. Missing sources are recorded as missing, not confused with read errors.

All six collections and present operational documents are imported into a private
staging database in one transaction.
Complete document equality, source stability and database integrity are checked.
The self-contained database is promoted, WAL is enabled, and the flushed selector
is atomically published. Original JSON is left untouched, but is no longer current.

### Upgrading existing SQLite installations

From v2, only the registered operational JSON objects are imported. All six
collections stay in SQLite without rewriting/reimporting them. From v1, the four
v2 collections and the operational documents are imported together, directly to v3.
The backup includes a verified, fsynced `VACUUM INTO` snapshot of the **current
database (including WAL)**, its old selector, exact pending JSON texts and a manifest
that records both hashes and absent files.

New tables, rows, schema version and migration metadata commit together in one
transaction. Errors before COMMIT roll back all of them; the previous schema remains
usable. Publication of the external selector happens afterwards. An interrupted
publication causes a version mismatch, so even state reads/writes refuse to use
old JSON. After stopping writers, rerun `migrate`: matching committed in-database
metadata lets it finish publication without reading/reimporting stale JSON.
An older interrupted v1 → v2 commit is recovered first, then upgraded to v3. It does
not guess at unknown/newer schemas or an absent selector.

### Interrupted operations

A migration lock is not automatically stolen. If `task-migration.lock` survives a
crash, first verify no migrator/writer is running, then remove that lock directory.
If a database exists **without** a selector, inspect/archive it before retrying;
it is never blindly overwritten. If publication reports an error, use `check` to
inspect the selected version; a supported pending upgrade is recovered as above.

Database/selector/backup files are `0600`; new staging/backup directories are private.
POSIX directory entries are fsynced. Node cannot fsync directory handles on Windows.

## Backup and rollback

Export a current, portable snapshot of the six collections **and operational state**:

```bash
npm run robin:storage -- export /absolute/path/to/new-robin-snapshot
```

The destination must not exist. It contains `todos.json`, `rounds.json`, `events.json`,
`links.json`, `jobs.json`, `tech-events.json`, each present operational object under
its original filename, and a completion manifest. `missingStateFiles` lists omitted
objects; absence is different from an empty document. With v3, all these records
are read in one transaction including committed WAL contents. With v1/v2/mixed or
all-JSON storage, stop writers first for cross-file consistency. An interrupted export
without a complete manifest is not a valid backup.

**Do not copy only `tasks.sqlite` while WAL writers are active.** Use this export
or a SQLite online backup. Other Robin JSON/configuration, credentials and attachments
need separate backups; this is not an application-wide backup command.

To return to JSON while retaining post-cutover edits:

1. Stop all writers and export to a new directory; verify its manifest/counts.
2. Preserve the export and existing backups. Archive `task-storage.json`,
   `tasks.sqlite`, and any `tasks.sqlite-wal` / `tasks.sqlite-shm` together in a private
   directory outside the data directory; do not delete them.
3. Also archive the old six collection JSON files and all 11 registered state
   filenames listed above. Then copy **all exported collection and state files**
   into the data directory. Files listed in `missingStateFiles` must remain absent;
   leaving an obsolete JSON copy there would revive a deleted/absent state.
   No selector means this version uses JSON again. Do not restore only todos/rounds,
   and do not touch unrelated domains or credentials.
4. Run `check`, verify counts/content, then restart. The same migration command can
   later import that current JSON again.

Restoring only a pre-migration backup discards subsequent changes. An older binary
cannot read a newer schema: use the current export path or explicitly restore a
verified older database with its matching selector, understanding the resulting loss
of later edits. Never reset delivery history as a shortcut to rollback.

## Regression checks

Domain, tool and HTTP storage contracts use SQLite fixtures by default; set
`ROBIN_TEST_TASK_BACKEND=json` to check the transitional JSON paths. The deliberately
legacy calendar file-lock test stays JSON. `task-storage.test.mjs` and
`task-upgrade.test.mjs` cover lossless import/export, v1 preservation, verified backups,
transaction/DDL rollback, interrupted-selector recovery, multiprocess contention,
abrupt process exit and fail-closed behavior. `runtime-state-storage.test.mjs` adds
v2 → v3 and intermediate recovery, legacy-ledger preservation, sparse exports,
cross-domain/fence rollback, checkpoint failures, concurrent marks/mail/leases and
semantic state corruption. All fixtures use temporary directories.
