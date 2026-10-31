# Unified Brief — PRODUCT

Status: staged rebuild. M1 (stored preview) and M2a (explicit Gmail acquisition) are implemented. Both produce a manually invoked **shadow preview**, not a replacement for existing automation. Public research, fresh Google events, editorial generation, delivery and the shared reader remain later slices.

## Summary

Robin turns relevant private updates and public developments into one versioned daily brief. The phone Day surface, the desktop Incoming/News surface and optional notifications present the same edition at different lengths. Understanding information does not itself authorize an action.

The supplied deployment diagram, entity diagram and two execution diagrams are architectural references, not authorization to upload conversations, deploy cloud infrastructure or enable external delivery. This milestone changes the backend only; it does not define a new visual design.

## Behavior

1. **One edition.** A brief has a date, timezone, version, creation time, source coverage and stable identity. Short and full presentations reference that edition; opening either spends no model tokens and performs no upstream refresh.
2. **Two purposes.** Separate information requiring a decision from developments worth knowing. Each item states what changed, why it matters when supported, the source, and an optional next step. Do not pad a quiet day.
3. **Real freshness.** Distinguish event time, publication time, observation time and assigned reading day. A previous-week story remains a previous-week story. Missing or stale mail checks never mean an empty inbox.
4. **Visible coverage.** Show unavailable, disconnected, stale, partial and successfully checked sources independently. A useful partial edition may be published with explicit gaps. If every source failed, retain the earlier edition and report failure.
5. **Versioned updates.** Refreshing does not silently overwrite a published edition. A deliberate new request creates a new version; retrying the same request returns or resumes the original operation without another edition.
6. **Preserved original records.** Tasks, calendar records, mail reviews and weekly reading remain owned by their existing workspaces. Briefing does not duplicate or rewrite those records.
7. **Different states.** Read, handled, added to tasks, completed and notification accepted are distinct. Opening a brief never marks all its items handled or creates a task.
8. **Actions require policy or intent.** An actionable suggestion can be accepted explicitly. Existing mail automation must be migrated through an explicit policy decision; the rebuild does not silently disable or broaden it. Repeated acceptance must not duplicate a task.
9. **Traceable evidence.** Keep original record references and relevant quotations where available. A stored model summary is labelled as such, not as the underlying email. A source-passage match is not independent verification of every generated claim. Conversation assertions are not verified facts.
10. **Incremental acquisition.** Completed, durably saved acquisition work is reused after failure. A checkpoint cannot advance without its corresponding saved result. An explicit refresh can acquire newer input rather than pretending a retry did so.
11. **Source privacy.** Public research receives only approved public interests and public material. It cannot read mail, tasks, credentials or private conversations. Private input may be sent to a configured model only as part of an explicitly enabled processing policy.
12. **Knowledge is opt-in.** Conversation and Obsidian ingestion default off. Enabling them names projects/vaults and allowed scope. It does not grant arbitrary filesystem access, automatic note editing or transcript uploading.
13. **Read-only composition.** The writer can produce a proposed brief but cannot send messages, modify tasks/calendar, run shell commands or alter acquisition progress. Validated program logic publishes the result.
14. **Failure recovery.** Manual and scheduled invocations cannot overlap the same active generation. An expired worker cannot publish or overwrite its successor. Failure records identify the stage and whether a safe retry is available.
15. **Bounded cost.** Generation has enforced per-operation call/page/byte/time limits and retry limits. Exhausted or uncertain spend is not reset by a retry. Quota limitations are distinguishable from malformed output and inaccessible sources.
16. **Independent delivery.** A published brief remains available when delivery fails. Retrying delivery sends that edition; it never reruns research. Delivery is off unless enabled for a selected channel/audience.
17. **Uncertain delivery.** External acceptance does not prove display or reading. An ambiguous send is shown as uncertain and is not automatically resent. Disabling delivery is checked before each send.
18. **No stale notification flood.** Waking after downtime must not send every missed day. Revisions do not automatically trigger repeated notifications.
19. **Local operating limits.** Initial deployment uses the existing machine. Sleep/power-off prevents work; a local scheduler is not a wake service. Cloud deployment requires a separate decision.
20. **Protected continuity.** Existing weekly editions, read markers, tasks, mail handled flags and delivery history survive migration. No live storage migration or automatic deletion occurs while introducing the shadow pipeline.
21. **Inspectability.** The operator can inspect runs, input coverage, reuse, result version and failures without starting another run. Diagnostics must not expose credentials or unrestricted raw source text.
22. **Shadow milestone.** The initial preview consumes stored mail reviews, current tasks, local calendar records and existing weekly stories. It does not call Gmail, Google Calendar, web research or a model. Google-only events are explicitly missing from this preview; weekly content is explicitly reused.
23. **No implicit activation.** Initializing shadow storage and running a preview are separate explicit commands. GET/status does not initialize storage. No scheduler, outbound sender or UI cutover is activated by this milestone.
24. **Honest scope.** A deterministic shadow preview is not described as a freshly researched daily brief. The next stages must implement fresh bounded acquisition and evidence-backed editorial composition before replacing production generation.
25. **Opt-in Gmail slice (M2a).** `acquire` may read the primary Gmail account through a fixed recent-mail policy; default `shadow` remains network-free. Account-specific history and queued messages survive bounded runs. Labels/deletions are reconciled, expired cursors trigger a scoped bootstrap, and byte/body/item caps remain visible coverage gaps. Budget reservations survive retries. Missing bodies are not fabricated; untriaged mail does not become an action. No private source text goes to research or a model in this slice. Existing Brief/v1 storage requires an explicit, backed-up offline upgrade, never a read-triggered migration.
