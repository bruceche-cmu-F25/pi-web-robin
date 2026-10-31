# Market Validation — Technical Plan

Status: framing slice implemented; the remaining CRM/recruitment/delivery design is still a roadmap. [PRODUCT.md](./PRODUCT.md) records the target behavior contracts. Implementation was authorized after this plan was written; no live campaign, vendor purchase, legacy shutdown, or data migration was authorized.

## Implemented slice and current limits

- `/product/validation` and guarded `/api/robin/validation` commands implement explicit empty initialization, idea/brief snapshots, versioned ICP/criteria drafts, human approval, manual evidence, human stage-A outcomes, history and a portable JSON export.
- Draft-only discussion uses the existing isolated assistant helper with **no tools**, a 120-second timeout, durable operation claims and cancellation fencing. It is not market research. Approved work must be explicitly revised before another framing turn; AI result interpretation is not implemented.
- `validation-storage.ts` implements a dedicated v1 SQLite database with project aggregates and operation receipts. The proposed domain records below remain logical future records: contacts, enrollments and deliveries have not been scaffolded. Relational normalization belongs to the slice that needs those records.
- `validation-domain.ts` owns writes, revision checks and replay. Model output can save only an unapproved proposal. UI conflicts preserve drafts; write receipts are applied before refresh. Existing Product/Jarvis state, runtime and tool registration remain unchanged.
- The logical export is implemented and checked; verified disaster-recovery restore, attachments, source crawlers, inbound forms, CRM, sequence execution and live email tests remain unimplemented. No claims about their readiness follow from the framing tests.
- See [implementation notes and runnable checks](../../docs/agents/market-validation.md).

## Context

This belongs to the local Robin product workspace, not upstream Pi Web's session/runtime feature set. Preserve the repository's domain-module pattern: HTTP and any future Pi tools are adapters over domain commands, not independent state writers. Do not alter Pi's extension protocol, session format, or global agent prompt.

Research baseline: repository HEAD `23955217e90c36837b1869734b5675ffa5d1e2f8`, plus an already-dirty working tree. The references below are pinned where files were unchanged; observations of `instrumentation-node.ts` are explicitly working-tree observations. No existing edits were changed for this specification.

| Inspected code | Finding and consequence |
| --- | --- |
| [product-domain.ts:17–62](https://github.com/bruceche-cmu-F25/pi-web-robin/blob/23955217e90c36837b1869734b5675ffa5d1e2f8/extension/robin/product-domain.ts#L17-L62) | The idea model was simplified after many structured collections went unused. Keep idea capture simple; create validation artifacts only after an explicit start, generated from conversation rather than a large intake form. |
| [jarvis-shape.ts:1–12, 87–100, 143–194](https://github.com/bruceche-cmu-F25/pi-web-robin/blob/23955217e90c36837b1869734b5675ffa5d1e2f8/extension/robin/jarvis-shape.ts#L143-L194) | A single-campaign lead combines hard-coded personas, approvals, routes, and delivery fields. Do not make the new model a renamed JarvisLead or reuse its qualification predicates. |
| [outreach-shape.ts:21–44](https://github.com/bruceche-cmu-F25/pi-web-robin/blob/23955217e90c36837b1869734b5675ffa5d1e2f8/extension/robin/outreach-shape.ts#L21-L44) | Templates and final-send validation contain product-specific claims and URLs. New approvals must pin user data, not these constants. |
| [jarvis-mail.ts:7–85](https://github.com/bruceche-cmu-F25/pi-web-robin/blob/23955217e90c36837b1869734b5675ffa5d1e2f8/extension/robin/jarvis-mail.ts#L7-L85) | Existing Gmail transport demonstrates MIME encoding, account checks, and thread reading. It does not provide the new approval contract or complete reply ingestion; its old auto-reply behavior is not the new default. |
| [jarvis-outbox.ts:72–138](https://github.com/bruceche-cmu-F25/pi-web-robin/blob/23955217e90c36837b1869734b5675ffa5d1e2f8/lib/jarvis-outbox.ts#L72-L138) | Existing runner claims before I/O and holds uncertain sends, but uses Jarvis-specific timing, follow-up and eligibility logic. Reuse lessons/tests, not its policy or queue. |
| [task-store.ts:1–117](https://github.com/bruceche-cmu-F25/pi-web-robin/blob/23955217e90c36837b1869734b5675ffa5d1e2f8/extension/robin/task-store.ts#L1-L117), [task-schema.ts:1–20](https://github.com/bruceche-cmu-F25/pi-web-robin/blob/23955217e90c36837b1869734b5675ffa5d1e2f8/extension/robin/task-schema.ts#L1-L20) | Node SQLite is available; the existing v3 catalogue is closed and has transitional JSON behavior. New CRM tables cannot be inserted into that catalogue or runtime-state allow-list without a migration. |
| [todo-domain.ts:1–67](https://github.com/bruceche-cmu-F25/pi-web-robin/blob/23955217e90c36837b1869734b5675ffa5d1e2f8/extension/robin/todo-domain.ts#L1-L67) | Example domain ownership and revision-conflict handling. Follow this shape, not direct route/store writes. |
| `instrumentation-node.ts:4–19`, current working tree | Startup still registers `startJarvisOutbox()` and `startJarvisDaily()`. This is code registration, not proof a live queue is active. Legacy runner disposition is a live-rollout gate. |

Read [Robin storage operations](../../docs/robin-task-storage.md) before implementation. Existing backups do not cover a new CRM database automatically. The current `CONTEXT.md` defines legacy Channel Plan as exact-copy approval; the new rule-based approval is a different concept and must not silently redefine the old contract.

### Public mechanism research

This is targeted documentation research, not a full competitive audit, browser trial, or proof of vendor access. No vendor account was created and no paid source was called.

| Source and evidence level | Mechanism to adopt | Deliberately not adopting |
| --- | --- | --- |
| [Attio objects and lists](https://docs.attio.com/docs/objects-and-lists), full page read | Person/company records separate from process-specific entries and attributes: shared Contact versus Experiment Participant. | Custom-object builder, schema editor, enterprise CRM breadth. |
| [Apollo sequence rulesets](https://knowledge.apollo.io/hc/en-us/articles/4409396858509-Manage-Sequence-Rulesets) and [reply behavior](https://knowledge.apollo.io/hc/en-us/articles/4409878127629-Prevent-Replies-From-Ending-a-Sequence), search excerpts only; direct ruleset fetch returned HTTP 403 | Explicit eligibility/stop policies and a sequence distinct from contact identity. Search excerpts describe default sequence termination on reply. | Treating the excerpt as a verified complete specification, copying every sales-automation option, or automatic continuation after replies. |
| [Clay waterfalls](https://university.clay.com/docs/building-a-data-waterfall), full page read | Ordered enrichment sources with stop-on-sufficient-information and clear provider attribution. | Assuming Clay's underlying providers or social data are accessible to this workspace. |
| [Gmail messages.send](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send), full page read | OAuth-authorized sending returns a Message resource; retain provider identity separately from delivery confirmation. | An exactly-once claim: the documented request has no application idempotency-key contract. |
| [Gmail history.list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list), relevant passages read | Paginated incremental synchronization; persist a cursor after processing all pages; expired/invalid history IDs require resynchronization after 404. | Advancing a cursor after a failed page, or assuming an empty partial read proves no reply. |
| [LinkedIn Messages API](https://learn.microsoft.com/en-us/linkedin/shared/integrations/communications/messages), relevant passages read | Capability discovery before promising a channel: access is partner-restricted and the documented messaging action requires a member action, not an automated scheduled event. | First-release automatic LinkedIn messages or browser automation as a presumed workaround. |

These support design choices, not an endorsement of a vendor or legal conclusion. The source-selection spike must additionally research the actual chosen ICP's accessible sources and verify sample quality.

## Proposed changes

### 1. Keep the initial implementation small and domain-owned

Proposed modules, introduced only in the slice that needs them:

- `extension/robin/validation-domain.ts`: product/ICP artifacts, approved experiments, evidence, source plans, budgets, outcome decisions. Compact draft/save/approve/review commands with explicit revisions, not a generic workflow engine.
- `extension/robin/crm-domain.ts`: identities, routes, participant review, merges, suppression, conversation/evidence associations, and chronological activity queries.
- `extension/robin/outreach-domain.ts`: immutable sequence approvals, batches, enrollments, step progress, pause/end/resume, dispatch authorization, reconciliation, and reply-send approvals. This is the sole sender-policy authority.
- `extension/robin/validation-storage.ts`: private SQLite connection/transaction/schema support shared by these three domains. The public HTTP/tool layer does not import it.
- `lib/validation-runner.ts`: a bounded wake reads due work, calls domains, performs generation/provider I/O, and records the result. It owns no business rules or parallel state file. Start with a manually invoked/test wake; add an opt-in app-hosted timer only after failure tests pass. No new general-purpose scheduler.
- A narrow Gmail transport module behind the runner. Extract genuinely product-neutral MIME/HTTP helpers only if both callers can share them without changing legacy behavior; otherwise introduce the minimal new transport and leave Jarvis untouched. Do not copy its product policy or sender address.

New HTTP adapters live under a dedicated `/api/robin/validation/` namespace. UI entry is proposed under Product, with a separate validation workspace; exact route/navigation placement is a UI decision, not a reason to rewrite the existing idea board. Use existing polling, styles, i18n, and revision-conflict patterns. Read the relevant `docs/agents/` notes, visual-language guide, and local Next guides before touching those surfaces.

Research/generation commands may save proposals, never approvals. A human-only authenticated command path approves reviewed snapshots; background AI calls cannot provide a boolean `approved: true` to bypass it. If Pi tools are later exposed, read SDK docs and the tool-scoping notes then; never place approval or send capabilities in a research turn fed untrusted pages. No new Pi tools are required to prove the first slice.

### 2. Storage: fresh domain, not a Jarvis import or task-v3 patch

Proposed default: a dedicated `market-validation.sqlite` under Robin's data directory, using built-in `node:sqlite`. This is one new source of truth for a new domain, not a second copy of migrated task collections. It avoids forcing unrelated task upgrades and enables relational uniqueness for CRM operations; the cost is a separate backup/init lifecycle that must be shipped with it.

- Explicit initialization creates an empty versioned schema and globally paused execution policy. Reads, server startup, and background wakes never auto-initialize or repair it.
- Existing files are never overwritten by init. Missing/corrupt/newer databases fail closed. Subsequent schema changes use explicit versioned migrations, stopped writers, verified backup, and rollback/recovery tests. No JSON fallback or dual writes.
- Enable foreign keys on every connection; use WAL, local disk, `synchronous=FULL`, bounded busy timeout, and short `BEGIN IMMEDIATE` transactions. Network/model calls are outside transactions. Follow existing nested transaction behavior without adding a general repository abstraction or ORM.
- Initialize only after the user chooses to start validation; don't create it for every Product visit. Existing idea IDs are optional references, not cross-database foreign keys or atomic writes. Preserve a brief snapshot so later editing/removing an idea does not invalidate an experiment.
- Store indexed identity/status/version/foreign-key fields as columns; bounded artifact bodies can be validated JSON. Schema checks, foreign keys and unique constraints protect invariants, not just TypeScript types.
- Add a verified export/backup/restore command scoped to this database and attachments. Existing `robin:storage` export does not include it. A restore creates a paused runtime generation; old claims cannot execute against it. Credentials stay in the existing secret/account mechanism, never in CRM export.

Alternative considered: a task schema v4 containing all CRM state. This could share backup infrastructure but would expand the task migration and require all task writers to stop. Revisit before implementation if shared atomic task/CRM behavior becomes necessary; the initial design does not require it. Do not implement both.

### 3. Domain model and terms

The following are logical records, not a demand to create every table on day one. Add only what the current vertical slice uses. Versioned artifacts share one constrained storage mechanism; no user-defined schema builder.

| Record | Required distinction |
| --- | --- |
| Validation Product | Optional idea reference; brief and chosen offer; not the existing idea's automatic replacement. |
| Artifact Revision | Typed ICP, offer, source-plan, criteria or sequence draft; immutable approved revision, parent revision, author and decision. |
| Experiment | Product, stage A/B/C, pinned criteria/ICP/offer revisions, start/end, outcome and human decision. |
| Evidence | Source/document, exact passage or structured observation, observed time, claim, support/counterevidence and actor; source links may be unavailable later. |
| Source Run | Pinned source plan, approval scope, cost reservations, progress and resumable/cancelled result checkpoints. |
| Contact / Company / Contact Route | Shared identity, optional company; route provenance and verification separate from consent/restriction. |
| Participant | Unique experiment/contact relationship, fit judgment, lead review, recruitment source/permission, observations. |
| Sequence Revision / Batch | Approved rules and fixed recipient selection; sender, policy and prompt versions. A changed prompt never mutates an active batch. |
| Enrollment / Step | Participant's progress in one batch; separate terminal/paused reasons and step attempts. Manual tasks use the same step timeline, not a second Todo source of truth. |
| Message / Delivery Attempt | Immutable content snapshot and generation inputs; one external attempt with provider/thread IDs, uncertainty and resolution. |
| Conversation / Finding | Incoming messages, manual notes, proposed drafts, exact-copy reply approvals and source-linked observations. |
| Suppression / Activity | Scoped restrictions and auditable human/AI/system transitions; not a single all-purpose contact status. |

Store commands with operation IDs and expected revisions; persist their outcome with the mutation and activity entry so retrying an HTTP request cannot double-apply it. Actor identity comes from the trusted adapter, not model output. Index due steps, unresolved attempts, provider message IDs, participant relationships and contact routes. Record UTC instants and explicit IANA zones for policy calculations.

Identity rules: match verified stable identifiers, flag uncertain matches for human review, and never auto-merge by display name. Do not strip Gmail dots/plus tags across arbitrary providers or conflate shared role mailboxes with a person. Maintain canonical contact redirects on merge and check route-level collisions as well as contact-level active enrollment uniqueness. Paused but resumable enrollments still occupy the active-contact reservation. Merging contacts with two active enrollments pauses/conflicts them rather than dropping either history.

### 4. Research and AI contract

- Save bounded source excerpts and structured evidence, not entire inboxes or uncontrolled scraped dossiers. Restrict retrieval to the selected product/experiment and known contact facts.
- Candidate comparison and experiment-card drafting are model work; version validation, approvals, budgets, and state transitions are deterministic domain work.
- Source discovery and enrichment are distinct. Start with search/public pages and reviewed imports using existing research capability; add one approved paid provider only after a real sample shows a missing capability. A source plan must cite that provider's own access/usage docs and record observed cost/quality before expansion.
- Each paid external call reserves its documented upper-bound cost in a transaction before I/O, then settles actual cost. Parallel calls share the remaining budget. Ambiguous billed requests retain their reservation; no release-and-retry loophole. Unbounded pricing or exhausted credits holds the run for review.
- Approved sample size, run cancellation and spending caps apply even if a source page or model response requests more data. Expired run leases can resume safe reads/checkpoints, not repeat uncertain billed work automatically.
- Initial inbound path: an explicitly chosen external form plus reviewed CSV/manual import with submission ID, permission wording, source and time. Deduplicate reimports; protect CSV export cells from formula execution. No public anonymous write route is introduced into the local Robin server. A hosted webhook/form is a later, separately secured integration.
- Prompt generation returns validated structured subject/body plus referenced evidence/approved claims. Render permitted recipient fields and links through controlled code; reject injected headers, unknown URLs, invented recipient routes, or invalid references. The model never chooses the dispatch target.
- Evidence references alone cannot prove a paraphrase true. Favor neutral templates and constrained fact slots; hold unsupported claims. Adversarial sample review is required before activation. Do not sell a model-based fact checker as a guarantee of hallucination-free mail.
- Separate discovery/validation evidence from sensitive health data. A food-photo application does not justify inferring conditions or obtaining diets/medical histories during lead generation.

### 5. Execution state and the stop contract

Suggested orthogonal states:

- Experiment: `draft → approved → running ↔ paused → review → closed`; result `pass | fail | inconclusive`, with a separate human decision/revision.
- Enrollment: `approved → active ↔ paused → completed | ended`; independent pause reasons include human, reply, sync, account, uncertainty, and policy. Resuming one reason does not clear others.
- Step: `waiting → preparing → ready → dispatching → accepted | failed_before_send | uncertain | cancelled`; manual steps use `waiting_manual → completed | skipped | blocked`. Delivery confirmation is a separate provider event, not inferred from `accepted`.
- Global/batch/contact execution controls are persisted, not only UI flags. First release allows one concurrent outbound transport request per sender; no distributed throughput machinery.

Dispatch protocol:

1. Select a due step under a renewable worker claim. Generation may happen outside the transaction. Recheck the pinned approval and contact-route versions when saving the frozen message; a stale result is held/discarded, never silently substituted.
2. Refresh relevant reply state outside the transaction. A failed/stale read blocks dispatch, including initial contact where recent mailbox activity may already show a conversation.
3. In one short transaction, re-read all stop/suppression/approval/account/expiry gates, validate the sync watermark, reserve sender pacing/capacity, and create a unique dispatch-authorized attempt for the enrollment step. Persist its content hash, attempt ID, owner/fence, sender and outbound correlation Message-ID. This commit is the linearization point for dispatch versus stop.
4. Immediately before provider I/O, recheck cancellation/account validity and abort if possible. A stop committed before step 3 prevents authorization. If step 3 committed first, the stop response lists that attempt as in-flight even if the socket has not opened yet; cancellation is best-effort, never a recall guarantee.
5. Call the provider once outside the transaction. Success records provider acceptance and IDs in a transaction. Conclusive pre-send refusal releases only demonstrably unused capacity according to policy. A timeout, disconnect, ambiguous error, or process death after authorization becomes `uncertain`; it is not eligible for another automatic call.
6. Late receipts may reconcile the same attempt monotonically even after its worker lease expires; expired workers cannot authorize subsequent sends. Duplicate callbacks are deduplicated by provider ID. Contradictory evidence opens review rather than overwriting history.
7. Persist stop and its activity event atomically. Stop invalidates future work authorization; an acknowledgment returns active attempts and the control revision. Storage errors never become a successful stop response. Resume recomputes eligibility and future spacing; it never drains all overdue steps immediately.

A unique step/attempt constraint prevents duplicate local claims, but cannot make Gmail exactly once. An RFC Message-ID assists Sent-folder reconciliation; it is not a provider idempotency key. Reconciliation prefers provider message/thread IDs and correlation headers. Absence in a search does not prove non-delivery. An explicit human-authorized retry after documented resolution creates a new attempt linked to the old one, never deletes the old attempt.

Cold-sequence pause on reply does not prevent a separately exact-copy-approved human response. Global emergency pause, account failure and suppression do prevent new workspace sends, including responses, until appropriately resolved. Keep user-reported social completion separate from provider-confirmed email activity.

### 6. Gmail and conversation ingestion

Use the existing Google account/token facilities only after inspecting their scopes and obtaining explicit selection of a sender; do not automatically bind to an old outreach account. Verify sender identity before and after token refresh, not just when a batch is created. Consider account-generation changes part of the authorization snapshot.

Start with bounded polling instead of adding Pub/Sub infrastructure. Gmail history synchronization needs full paging, deduplication, a last-success watermark, cursor commit only after durable processing, and a resync path for expired history IDs. During incomplete resync, hold affected sending. Process only messages relevant to known recipients/threads; do not persist unrelated mailbox bodies or provide them to the model. Provider reads can inspect metadata for matching without importing an entire personal mailbox into the CRM.

Persist incoming relevant mail and pause the known person's cold outreach in the same database transaction, before classification. Unknown/ambiguous associations go to manual review. Auto-replies are visible and conservatively hold rather than being silently ignored as in the old Jarvis reader. Model classification cannot lift holds or create reply-send approvals.

Unsubscribe handling is a live gate. Minimum viable path is an explicit opt-out instruction in mail plus reliable reply ingestion and a conservative hold for inbound responses; bulk/marketing situations requiring one-click mechanisms need those mechanisms or remain unsupported. An unsubscribe link must not point to a private localhost service. Final sender identity, footer, channel/region requirements, quotas and bounce thresholds need reviewed policy; pacing is not a guarantee of deliverability or compliance.

### 7. Cutover, security, and operations

- Inventory old registrations, external scripts and supervised runners before live rollout; current startup imports alone do not establish their runtime state. Seek explicit authorization to disable/archive them. Same-sender coexistence is blocked unless one authoritative gate covers both systems; prefer retiring the old sender path rather than building dual-system coordination.
- No Jarvis data, approvals or hidden opt-out import. Explain the consequence of a clean slate: the new CRM cannot know historic refusals in discarded data. A reused audience requires an explicitly authorized suppression-only input or a fresh eligible audience; do not promise historical deduplication without history.
- New domain HTTP writes follow existing authentication/origin protections; never approve via GET. Research URLs require public-host/redirect validation and limits; no arbitrary local/private fetches or executable attachments. Preserve least-privilege tokens and redact provider errors/logs.
- Audit mutations include actor, operation ID, scope, prior/current revisions, time and reason. Keep message content in controlled content records so approved erasure can remove PII without making ordinary operations silently mutable. Minimal suppression identifiers are still sensitive, even if hashed; document retention and access.
- Export a consistent database snapshot plus referenced attachments and manifest. Verify checksums, foreign keys, counts and readable versions. Restore with writers stopped, credentials excluded, global pause set, old execution leases invalidated, and uncertain historical sends unreplayed. Do not copy only a live WAL database's main file.
- Observability: runner heartbeat, last successful sync, queued/blocked/in-flight counts, cost reservations, stop receipts, stale approvals and uncertainty. These are operational facts, not marketing metrics.

## Implementation sequence

Each slice must leave a runnable behavior check and usable end-to-end path. Source and UI files are added incrementally, not pre-scaffolded for every logical record.

| Slice | Shippable path | Exit gate |
| --- | --- | --- |
| 1. Framing and experiment | Start from a brief → compare ICPs → approve criteria → attach evidence → record human decision. Introduce minimal storage, versions, export and revision checks. | Two different synthetic product briefs work with no product-specific code; no network sending capability. |
| 2. Sample recruitment and CRM | Source plan → bounded sample/import → identity review → participant review → history/restrictions. Include external-form import and source cost reservation if a paid provider is approved. | Reimports/duplicates do not create parallel identities; expansion and paid calls cannot bypass approval. |
| 3. Sequence dry run | Edit prompt → previews → approve fixed batch → generate → simulate execution → pause/end/resume. Add manual social tasks. | Stop/crash/race contract tests pass with a controlled fake transport before a live send path is enabled. |
| 4. Email and conversations | Explicit sender setup → canary to an owned test inbox → provider receipts → inbound pause → user-approved reply → interview findings. | Real-account opt-in test and failure matrix pass; legacy isolation and operational policy are resolved. |
| 5. Full validation loop | Record B usage and C payment evidence → compare cohorts/versions → human outcome decision → next experiment; exercise backup and paused restore. | One small authorized real experiment can be reviewed honestly; a second different product uses the same workflow without code changes. |

A and B/C tracking can use manual/imported evidence in the first release. Do not block the closed loop on an analytics SDK, payment processing, social automation, public form hosting, or a graphical sequence builder. Adding a new source/channel follows demonstrated need, not a speculative plugin framework.

## Testing and validation

Use Node's existing test runner and temporary data directories; no live personal data, email sends, billed calls, or legacy fixtures imported into production. Test public domain commands, not file-format snapshots. Inject time, model generation and provider outcomes at real I/O seams; use SQLite and real transactions for concurrency tests.

| Product contracts | Concrete verification |
| --- | --- |
| P01–P07 | Empty start; two materially different B2B/B2C briefs; edits preserve prior artifact revisions; a model-generated approval is refused; weak-evidence choice does not bypass send/budget gates. Include manual critique of question quality. |
| P08–P16 | Counterevidence and unknowns survive summaries; exact quotes trace to sources; criteria changes retain old cohort context; pass requires human decision; refunds and promised payments do not count as actual paid outcomes. |
| P17–P23 | Source returns partial/403/no results distinctly; cancelled runs retain work; paid calls reserve budget atomically; timeout does not refund an uncertain bill; duplicate form IDs do not enroll recipients; injected page instructions cannot approve actions. |
| P24–P30 | Same person across two products has separate fit/outcome; route change invalidates use; same-name people stay separate; merge with active enrollments pauses conflict; shared mailbox collisions block; opt-out survives merge/reimport and prevents channel switching. |
| P31–P37 | Preview causes zero sends; fixed recipient batch excludes later leads; prompt v2 leaves v1 batch unchanged; unknown claims/URLs and email header injection hold; changed rules need approval; opening/copying social drafts produces no send event. |
| P38–P47 | Multi-process claim contention; restart at every dispatch boundary; caps/gaps/DST/fallback zone; stale sync; delayed provider success; stop-before/after-authorization; failed stop write; parent resume retains child hold; end cannot resume; no overdue burst. |
| P48–P53 | Reply persists and pauses before classification; duplicate incoming event dedupes; new-thread reply match is reviewed; auto-reply conservatively holds; stale reply-copy approval fails; findings retain original words; counts distinguish attempts/messages/people/outcomes. |
| P54–P56 | Two-tab stale approval conflict; offline save/stop error; partial bulk result; empty/error/loading distinctions; keyboard-only and mobile stop/review workflows, visible focus and non-color status labels. |
| P57–P62 | Unrelated mail and secrets excluded from AI/export; explicit erasure removes content while honoring restrictions; restore stays paused; missing/corrupt DB refuses sending; legacy code remains untouched; account change invalidates dispatch; every human gate rejects research-worker calls. |

### Mandatory delivery failure matrix

1. Crash before claim: no attempt; step remains eligible.
2. Crash after generation but before authorization: no provider call; saved draft may be reused after checks.
3. Crash after authorization but before socket I/O: conservative uncertainty unless pre-send cancellation is conclusively recorded; never automatic resend.
4. Provider accepts, response lost or local commit fails: reconcile the original attempt; do not replay.
5. Duplicate wake or two processes: one authorization/transport request for that step; the loser observes existing ownership/state.
6. Pause commits before authorization: no dispatch. Authorization commits first: stop receipt names in-flight attempt; later acceptance is retained.
7. Lease expires while provider returns: old attempt can record a verified receipt, but stale worker cannot initiate another send.
8. Reply/opt-out commits before authorization: dispatch refused. Provider-unobserved arrival during an in-flight request is disclosed, not falsely guaranteed away.
9. Gmail history pagination fails or cursor expires: sending held until bounded resync succeeds; no cursor jump drops replies.
10. Resume after days offline or restore: normal pacing, no reset counters, no replay of accepted/uncertain work; expired experiment requires review.

Before a live canary, verify the sender, scope, permissions, relevant provider/region rules, unsubscribe handling, finite daily cap, timing and sync freshness policy. Canary messages go only to explicitly owned/authorized test recipients. Inspect actual MIME/thread IDs and induced reply/auto-reply/bounce behavior; do not intentionally cause complaints to test a threshold. Then run one small user-approved experiment, not a default 100-contact blast.

At each implementation slice run focused tests, typecheck (`node_modules/.bin/tsc --noEmit`) and relevant lint, then the full suite before rollout. Browser verification should reuse a healthy dev server on port 30141 and follow the repository's stale-HMR troubleshooting rules. Never run `next build` during development. Framing checks are documented in the implementation notes; they do not exercise a live model/provider or prove the later delivery slice.

## Decisions still required before implementation/live use

- The framing slice uses the dedicated database and a separate Product entry; review the page before extending it to CRM. No mock was supplied.
- Select the first real product and source/sample, then approve the experiment's actual criteria. The sold Jarvis project is not the pilot.
- Resolve operational values, sender and regional/consent/retention rules identified in PRODUCT.md. Do not smuggle legacy timing or generic thresholds in as approved defaults.
- Obtain explicit permission for any legacy shutdown and any suppression-only handling. This planning change has done neither.
- Recheck Gmail OAuth scope/security implications and any chosen paid provider's current terms/pricing at implementation time; the public research here is not an access test.
