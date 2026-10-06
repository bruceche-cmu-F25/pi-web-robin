# ADR 0007: Use a durable lease for Cold Reach research

## Status

Accepted

## Context

Cold Reach research is long-running and can make many paid assistant turns. Its previous `globalThis` registry prevented duplicate work only inside one Node.js process. A server restart made the UI call an active stored run interrupted, while two server processes could both start research against the same data file. A stop request routed to a process that did not own the controller also did nothing.

## Decision

Every active discovery, rescoring, and website-enrichment run stores an owner id and renewable heartbeat in the Jarvis domain file. Starting a run atomically claims its own task slot only when no fresh lease exists. The owning process renews its lease every 30 seconds; a lease is stale after 120 seconds. The three task types retain separate slots and may run concurrently where the product permits it.

Stopping research always persists cancellation. If the request reaches the owner, its local abort controller is also stopped immediately. If it reaches another process, the owner observes the lost lease on its next heartbeat and aborts. Late writes remain guarded by the run id and running status.

Reads project an expired lease as an interrupted run without mutating history. Runs written before leases existed are treated as expired and can be restarted.

## Consequences

- Concurrent server processes cannot intentionally claim the same active task slot.
- A crashed owner releases the slot after a bounded delay without a cleanup daemon.
- Stop works through any server process sharing the same Robin data store.
- This is a single-store lease, not a distributed multi-host queue; shared-filesystem locking remains the serialization boundary.
