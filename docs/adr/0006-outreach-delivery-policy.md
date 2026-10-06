# 0006 — Outreach delivery policy has one browser-safe contract

## Status

Accepted.

## Context

Cold Reach originally displayed and estimated a recipient-local weekday
08:00–18:00 delivery window. The sender later changed to allow explicitly
reviewed outreach at any hour, but the old rule survived in three UI surfaces
and the operator documentation. The server therefore sent messages at times the
page said it would wait.

The same drift affected follow-ups: the domain enforced one full day while
parts of the UI and documentation still said seven days.

## Decision

`JARVIS_DELIVERY_POLICY` in `extension/robin/jarvis-shape.ts` is the single,
browser-safe description of delivery timing:

- reviewed mail may send at any hour;
- messages remain paced by a randomized 6–12 minute gap;
- a configured start instant and optional daily cap remain enforced;
- replies are checked every 15 minutes;
- one follow-up becomes eligible after 24 hours;
- three bounces in 24 hours pause the outbox.

The sender derives its timing constants from this value. Browser components
use the same value for status copy and schedule estimates. Recipient-local
working hours remain an informational helper only and must not be presented as
an enforced gate while `recipientWindowEnforced` is false.

Only one email transmission may run at a time, whether it was requested
manually or selected by an outbox tick. A renewable store-backed delivery
lease covers reply sync, claim, and Gmail delivery so two application processes
cannot send different contacts concurrently. Every claim also persists
`lastSendAt` before calling Gmail, reserving the pacing window even if the
process exits while the external result is unknown. That timestamp is captured
at claim time, after reply synchronization, rather than reusing the tick's
possibly stale start time. Losing the lease aborts token refresh or Gmail I/O;
an in-flight abort remains uncertain because the request may already have left
the process.

## Consequences

- A policy change must update one constant and its behavior tests rather than
  independent prose and timing constants.
- Queue estimates no longer skip nights or weekends while the policy allows
  all-hour delivery.
- Human review, source verification, at-most-once claims, pacing, scheduled
  starts, daily caps, reply checks, and bounce pauses are unchanged.
