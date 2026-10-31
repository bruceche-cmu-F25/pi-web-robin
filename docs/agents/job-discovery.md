# Job discovery and intake

Files: `extension/robin/job-providers.ts`, `job-intake.ts`, `job-requirements.ts`, `jobs.ts`, `job-scan.ts`, `job-directory.ts`, `job-domain.ts`, `job-evidence.ts`, `job-tools.ts`, `job-rubric.ts`, `app/api/robin/jobs/score/route.ts`, `lib/job-scoring-runner.ts`, `scripts/telegram/bridge.ts`, `scripts/telegram/push-notifications.ts`.

- Discovery traverses sources; intake owns admission → hydration → admission again → merge. A detail endpoint may replace an unknown location or estimated posting date. Never treat the initial list filter as final admission.
- Workday tenants can omit both `locationsText` and `postedOn`. Missing dates are not proof of old postings and must not stop pagination. Explicit `30+ Days Ago` supplies only a lower age bound: stop only if even that bound is outside the requested window. Retain the existing page budget.
- Workday details carry `jobPostingInfo.location` and `additionalLocations`. Carry these through the hydration dispatcher, including full-description rows missing geography. Fill missing stored geography without overwriting pipeline status, notes, application evidence, or existing location labels from another source.
- `go.vansh.nyc` wraps newgradlist's ATS URLs. Resolve this known wrapper after cheap admission, with bounded redirects and credential-free HTTPS/known-ATS host checks on every hop; identity resolution does not bypass `readUnknownBoards`. Only a recognised posting URL establishes identity; a redirect to a careers home does not. Retain the short URL as an alias, dedupe by the resolved requisition, and index newly learned aliases within the same merge batch. Short codes are case-sensitive.
- Resolving a legacy short link also rebinds evidence: discard its old JD/ref (case-folded short codes previously cross-contaminated employers), fetch the canonical requisition, promote that URL and keep the short alias. An explicit empty fetched description invalidates suspect cached text/years if fetching fails; an ordinary undefined fetch miss does not erase useful evidence. Metadata changes mark scores stale, never reset status/notes/application/notification evidence. `getJobDetails` / `job_pending(id, refresh: true)` offers one explicit refresh for other suspect or mismatched JDs; failed refresh must not silently reuse suspect text.
- A substantive typed JSON-LD JobPosting takes precedence over longer HTML/embedded prose: a related-jobs carousel is not evidence for this requisition. Ordinary full-JD reads reuse cached text; refresh only when suspect.
- SmartRecruiters identity is employer + numeric posting id, not the optional title slug. Distinct ids remain distinct even if titles match.
- A numeric age limit (`18 years of age`) and future company prose (`ten years from now`) are not experience requirements even when the next sentence mentions engineering. False-positive experience extraction can auto-drop a genuine entry-level role before scoring.
- Fixing discovery does not authorize rewriting historical user statuses or merging away rows that may carry notes/application evidence. Audit historical damage separately; obtain explicit approval before restoring/dropping user pipeline entries.

## Scoring and delivery

- Professional experience comes only from the confirmed profile/CV. The configured numeric stretch is not permission to claim `met`: allow experience `unknown` only when `experienceProblem` says `stretch-experience` and an exact JD quote extracts the same requirement. Cap at 3.9. Unknown education/start/location/authorization and actual blockers remain excluded.
- A tool-level rejection of missing, stale or unsupported review evidence must explicitly tell the scorer to reread and repair once; a provisional technical failure is not evidence the candidate is unqualified. Do not endlessly auto-requeue rejected reviews.
- `lib/job-scoring-runner.ts` owns `startJobScoring()`: acceptance/refusal, the local fast path, durable claim/heartbeat, detached rounds, one-time out-of-scope-pin fallback, no-progress detection, eight-round cap and terminal cleanup. The HTTP route is only a guarded JSON adapter; GET still reads `scoringStatus()` from the Job domain. Keep paid turns in the host, not the extension. `job-scoring-runtime.ts` is separate session/tool-contract preflight, not this execution lifecycle.
- The durable scoring lease's AbortSignal must reach `runAssistantTurn`. Failures outside the paid-call catch (queue/storage/progress) must publish a terminal error while still owned, rather than leave `running` until lease expiry. Ownership checks still fence every publication.
- The bridge reads scoring errors, retries an expired lease at most once, and never loops on provider/model failures. With no recommendations, incomplete scans/scoring or a remaining backlog produce a `jobs-status` notification; only a genuinely completed empty check stays silent on Web Push. Keep the latest-preferences check and send-before-claim behavior. Restart the supervised bridge to load code; a Next HMR refresh alone does not update it. A preview proves digest assembly, not handset delivery.

## List navigation state

`JobsBoard.tsx` reads `status`, `q`, `sort`, `shown` and `below` from `useSearchParams` through `board-navigation.ts`; URL state never changes job records or scan preferences. Search and Show more replace history; status/order/disclosure changes push it. Changing status resets the expanded count and below-floor disclosure, but keeps the search. Invalid values fall back to safe defaults, and unrelated query context is preserved. Applied remains its existing dated log.

`useBoardNavigation.ts` is shared with Events. It keeps up to 40 last scroll offsets per canonical list URL in this tab's session storage, waits for data before restoring, and can finish restoration when async content becomes tall enough. Explicit filter changes retain the current viewport instead of restoring an older visit. User wheel/touch/pointer/scroll-key interaction cancels pending restoration. Storage failures degrade to ordinary scrolling; this is not cross-device state, a server write, or a separate snapshot for every identical-URL history entry. `e2e/board-navigation.mjs` exercises reload/back/forward, expanded rows, slow reads, changed result heights and restricted storage with all APIs mocked.

## Confirmed browser writes

`EventsBoard` adopts the full event returned by a successful flag PATCH through
`usePolledResource.updateData` before refreshing. `JobLinks` likewise adopts each
saved-link receipt, including individual successes in a partially failed seed
batch. A failed refresh retains these confirmed results, and earlier reads cannot
roll them back. Follow-up reads do not hold write controls locked; JobLinks guards
duplicate submissions synchronously and retains input on failure. These use the
existing resource interface, not a second client store.
`components/robin/BoardReceipts.test.mjs` runs the actual components and resource
module against controlled write/read failures and out-of-order responses.

## Browser progress cadence

The Scan and Score buttons use `mutateResponse` with an empty JSON object, like
other guarded writes. Bodyless `fetch(..., { method: "POST" })` is not compatible
with the shared `apiRoute` JSON guard and receives 415 before starting work. Keep
the guard; do not relax it to accommodate the client. `e2e/frontend-reliability.mjs`
checks both real button handlers against mocked endpoints without scanning or
spending model tokens.

`JobsBoard` sweep/scoring reads use `usePolledResource`'s data-derived interval:
4 seconds while the respective response reports `running`, 60 seconds at rest.
The first read, visibility return and explicit action-completion refresh remain
immediate; hidden documents do not run interval polls. Derive the numeric interval
inside the shared hook, not an effect dependency on inline selector identity.
No job scan/scoring is started by this client cadence change.

Regression checks:

```sh
node --experimental-strip-types --test extension/robin/job-*.test.mjs extension/robin/jobs.test.mjs
ROBIN_TEST_TASK_BACKEND=json node --experimental-strip-types --test extension/robin/job-*.test.mjs extension/robin/jobs.test.mjs
node --experimental-strip-types --test lib/job-scoring-runner.test.mjs lib/job-scoring-runtime.test.mjs app/api/robin/jobs/score/route.test.mjs app/api/robin/jobs/routes.test.mjs
```

Runner tests control assistant turns and lease/storage failures through its existing
imports, without paying for a model or changing personal data. Route tests cover
HTTP guards and unchanged receipt shapes; the jobs route integration and domain
checks retain real storage/lease coverage.

See `docs/jobs-crawl-audit-2026-10-25.md` for the observed data and limits, not a guarantee that current upstream boards have the same schema.
