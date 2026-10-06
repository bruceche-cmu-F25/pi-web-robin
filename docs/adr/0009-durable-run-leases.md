# 0009 — External background runners use durable leases

## Status

Accepted.

## Context

Job scoring, mail review, hiring-round discovery, and note finalization run
paid assistant turns. Job discovery can issue thousands of ATS requests, and
the event and podcast scanners read third-party feeds.
Each runner originally excluded duplicates with a module-level promise. A
second server process or a hot reload could therefore start the same work
again. A process exit also left persisted job progress permanently marked
`running`.

## Decision

Every background runner that spends tokens or makes a non-trivial batch of
external requests must atomically claim durable ownership before it starts.
The owner renews a heartbeat; a fresh owner rejects another start, while an
expired owner may be replaced.

Scoring and directory sweeps keep a run id, runtime owner id, and heartbeat in
their existing progress documents. Every progress write verifies that identity
so late work cannot overwrite a replacement or regress its cursor.
Directory-sweep job flushes and dead-board cache writes use the same ownership
fence; progress ownership without data-write ownership would still allow a
replaced worker to publish late discoveries.

The ordinary job scanner, event scanner, podcast scanner, per-draft note
finalizer, per-episode podcast summarizer, and fixed assistant personas have no useful lease field in their
result documents, so they claim a named slot in `background-runs.json` through
`extension/robin/background-run-domain.ts`. Their final store mutation runs
while that slot is locked and verifies that the lease is still fresh. Losing a
heartbeat aborts their outbound requests, and an old runner's cleanup cannot
release its replacement.

The process-local assistant queue still preserves ordering inside one runtime.
When a queued turn reaches the front, it must also claim the persona's durable
slot before acquiring or rotating that persona's session. Product and Notes
conversations use the same mechanism with a key derived from their product or
draft id. A remote owner is reported as busy instead of allowing two processes
to append to one session.

Some conversational research intentionally continues after its HTTP listener
times out. That response may finish, but its durable session slot remains
renewed until the agent emits its terminal event. A bounded fifteen-minute
guard aborts and releases a turn that never settles. Response lifetime is not
treated as agent lifetime.

The shared lease duration, heartbeat clock, and runtime identity live in
`extension/robin/run-lease.ts`. Process-local promises remain only as a fast
path. Read paths treat expired leases as stopped without needing a cleanup
daemon.

## Consequences

- At most one server process may use a fixed assistant persona, score the
  backlog, finalize a given note, walk ATS sources, scan event feeds, or refresh
  the podcast shelf at a time.
- Replaced scanners cannot publish late results, and stop making requests when
  they observe that ownership was lost.
- Cancelling a note finalization clears remote ownership; the original process
  cannot publish afterward and aborts on its next heartbeat.
- A podcast summary reports remote work in its running set, so another process
  cannot hide the spinner or pay for the same transcript and model turn again.
- A restart releases every slot after a bounded delay. Completed results,
  imported jobs, and durable sweep cursors survive interruption.
- The file lock around the Robin data directory is the serialization boundary;
  this is not a distributed lease for unrelated filesystems.
