# Market validation: framing slice

Scope: `extension/robin/validation-{domain,shape,storage}.ts`, `app/api/robin/validation/**`, `app/product/validation/page.tsx`, `components/robin/ValidationWorkspace*`, `components/robin/ProductExperiments.tsx`, `components/robin/validation-copy.ts`, `e2e/market-validation.mjs`, `e2e/product-lab.mjs`. The target specification is [PRODUCT.md](../../specs/market-validation/PRODUCT.md); the longer roadmap is [TECH.md](../../specs/market-validation/TECH.md).

## What is implemented

`/product/validation`, linked from Product, is an opt-in problem-validation workspace. An existing idea supplies an editable name/note snapshot; creating validation does not change that idea. The page supports new briefs, draft-only AI discussion, up to three candidate segments, manual selection/editing, explicit criteria approval, sourced manual evidence and counterevidence, human outcome decisions, revision history and JSON export. It does not progress to B automatically.

The Product lab now embeds these same forms in each idea's Experiments / Evidence & decisions tabs (`?idea=<id>&view=experiments&experiment=<project-id>`). `ProductExperiments` filters summaries by `ideaId`; `ValidationProjectWorkspace` additionally checks the fetched aggregate's association before displaying or modifying it. Never infer association from names. Existing unlinked projects remain in the standalone workspace. The lab only initializes/creates on explicit clicks, retains the acknowledged creation receipt if a later read fails, and does not redirect a different active idea after a background create finishes.

Visited project editors remain mounted across tab, project and browser-history switches. Inactive editors stop polling, but retain their own dirty revision and local message. The discussion is portaled into the lab's stable partner host; it does not acquire the general product assistant's tools. Plan/evidence forms use `hidden` rather than conditional unmounting, and headings use per-instance IDs. The standalone route retains its inline discussion and original lifecycle. New-project forms can lock the source idea in the lab; their name/brief snapshot stays editable. None of this changes domain commands, storage, criteria approval or stage progression.

The idea-row entry `/product/validation?idea=<id>` opens the new-project form with an editable snapshot of that idea. Resolve the source before mounting the form, and retain that first snapshot across polls: later reads must not overwrite or unmount edits. Missing/failed source reads offer refresh/cancel. The query is navigation state, not permission to initialize storage, create a project, or run the model; these still require explicit buttons. Cancel clears the source query and creating a project replaces it with the project id. Back/Forward restores the source-entry form.

There is no CRM/contact collection, research crawler, paid-source integration, sequence, email send path, background scheduler, or Jarvis migration in this slice. The AI turn has **an empty exact tool allow-list**, uses the configured model through `runScopedAssistantTurn`, is one-shot with a 120-second timeout, and aborts on request cancellation. It proposes hypotheses, not web-verified facts. Do not quietly add `product_add_link`, coding tools or arbitrary web tools to this scope: source research is a separately reviewed slice.

The discussion uses the main Chat's shared bubble, Markdown, speaker-label and composer styles, both standalone and in the product partner portal. Generic validation form/button CSS excludes the shared composer field/action; other artifact forms keep their own layout. This is presentation only: draft-only sends, explicit kickoff, cancellation, approval and dirty-form guards are unchanged.

## Invariants

- `validation-domain.ts` owns all writes and input checks. HTTP routes use `apiRoute` origin/content-type checks and bounded JSON parsing. Model JSON is parsed into only a reply and unapproved plan; it never enters the human command dispatcher. Unknown model keys, including approval/status fields, fail closed.
- Commands carry an operation ID and expected project revision. SQLite serializes read/check/write/activity/receipt with `BEGIN IMMEDIATE`; a replay returns the current saved project, not a stale receipt. Reusing an operation ID for different input is a conflict. Stale edits are 409, not last-write-wins.
- Every saved plan is a new immutable revision, even a human-selected ICP. Approval binds the exact saved plan, complete criteria and selection. A later explicit human revision resets current approval but leaves prior plans, observations, approval events and outcomes intact. Pass/fail requires selected current-plan evidence; inconclusive can explicitly record insufficient observations. The system does not certify the evidence or automatically promote the stage.
- First-slice AI discussion only runs while the current plan is a draft. To revise approved/closed work, the user explicitly creates a revised draft first. This conservative limit is visible in the UI; automated result interpretation is not shipped yet.
- A discussion first records its user message and a durable `running` operation, then calls the model outside the transaction. Duplicate/stale requests are rejected before spend. Success commits the draft and conversation atomically; failure keeps the old plan and user's question. Retry is an explicit new operation, never an automatic re-spend.
- Cancellation marks the operation cancelled and fences late completion. The same stop works after reload or from another tab. A process crash can leave a running record; the user cancels it before a new turn. No lease expiry restarts a paid model call. UI cancellation also aborts its HTTP request, but model/provider cancellation is not a guarantee of refunded usage.
- Forms retain unsaved text on failed/conflicting saves; an acknowledged write is applied before any refetch. Editors use the revision captured when editing began, not a silently updated polling revision. Polling pauses while artifact/evidence forms are dirty. Plan and evidence editing cannot replace each other's unsaved context. Departure warning is browser best-effort, not durable offline draft recovery.
- Labels for textareas and selects are separate `label[for]` elements with `useId`, not labels containing their option/value text: the accessible name must remain stable after editing.

## Storage and operations

The new `market-validation.sqlite` is independent of task-v3 and Jarvis storage. It has two tables in v1: projects (bounded JSON aggregate plus indexed identity/revision) and operation receipts. This intentionally favors a single project's atomic framing history over prematurely scaffolding the full relational CRM; introduce normalized contacts and delivery tables with a versioned migration when their slice exists.

- GET never initializes. The explicit initialize action reserves a private file, creates a versioned schema and records `market-validation.initialized`. Existing databases are verified, never replaced. If the database disappears after the marker exists, reads/init fail closed. An interrupted schema initialization leaves an invalid file requiring operator inspection, not automatic deletion/reinitialization.
- Built-in `node:sqlite`; local disk, WAL, `synchronous=FULL`, foreign keys and bounded busy timeout. No model/network work inside transactions, no JSON fallback. No changes to `task-schema.ts` or the operational-state allow-list.
- The HTTP export is a consistent logical snapshot with schema version, projects, operation receipts and SHA-256 over `{projects, operations}` serialized as returned. It excludes credentials and old CRM data. It includes personal notes: treat the download as private. It is **not yet a tested disaster-recovery/restore command**; that is still required before sending/CRM rollout. Existing `robin:storage export` does not include this database.
- No initialization, actual model call or real data mutation was needed for development checks: domain/HTTP tests use temporary directories, and browser tests intercept all Robin APIs and use a separate temporary domain database.
- The legacy Jarvis startup registrations and data are untouched. Before enabling a future send path, resolve old runners and historical suppression limitations explicitly. The new page's discussion stop is not a global stop for old outreach.

## Verification

```sh
node --experimental-strip-types --test \
  extension/robin/validation-domain.test.mjs \
  app/api/robin/validation/route.test.mjs
node_modules/.bin/tsc --noEmit
node_modules/.bin/eslint extension/robin/validation-*.ts \
  components/robin/ValidationWorkspace.tsx components/robin/validation-copy.ts \
  app/product/validation/page.tsx app/api/robin/validation/route.ts \
  app/api/robin/validation/discuss/route.ts
node --env-file-if-exists=.env.local --experimental-strip-types e2e/market-validation.mjs
```

The browser test uses a healthy existing dev server on 30141, an isolated browser and mocked Robin endpoints backed by a temporary real domain. It tests failed saves, acknowledged writes followed by read failure, cancellation, stale edits, human approval, counterevidence, retained versions, Chinese/English, light/dark and 320/375/812/1440px. It never initiates a live model turn. Domain tests additionally exercise two-process revision contention, replay, invalid/corrupt storage, and generation failure/cancellation. These are framing checks, not proof of email delivery safety or market demand.
