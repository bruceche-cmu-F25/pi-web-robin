# Incoming information: email + AI weekly

The existing `/dashboard/gmail` destination is **Incoming / 新信息**. Its two source selectors are Email and AI weekly (`?feed=ai`); there is no additional global navigation tab. Both views stay mounted to retain mail filters, selected reading day and preference drafts. `/dashboard/ai-weekly` redirects to the shared entrance. Mail triage and badge counts remain unchanged; the weekly briefing never creates a todo or changes mail.

## Behavior

1. A weekly edition has **seven dated reading slots**, Monday–Sunday, alternating four practical developer stories and three wider-world stories. The reporting window is the **previous** Monday–Sunday, not seven predictions. Each slot contains at most one event. A missing reliable story is an explicit empty reading day, never invented filler.
2. Default selection is today's slot; all seven days can be read ahead. Opening a story does not mark it read. Mark read/unread is a confirmed server write, shared between devices. There is no overdue reading queue, streak or auto-created task.
3. Each story distinguishes facts, significance, an optional next step and uncertainty; it retains release status, event date, original source URL/title, publication date, exact evidence passage and server verification time. The UI says **passage/date matched**, not “all claims independently verified.” Vendor benchmarks and editorial judgements remain labelled limitations.
4. The page initially has no fake news. Read requests never start a paid model turn. An explicit Prepare/Retry or enabled server scheduler does. Research continues when the page closes. Running, interrupted, failed, partial-coverage and published states are distinct. A failed run cannot publish a half-written edition or replace an older edition.
5. Interests, IANA timezone, daily wall-clock time, automatic research and Telegram delivery are editable separately. New installations default to manual research, 08:00 in the host's named timezone, Telegram off. Saving interests affects the next edition, not already scheduled/read stories.
6. Automatic research starts after the configured time in an unpublished week. It runs on Monday normally, or catches up when Pi Web comes back online later that week. A committed edition is immutable: repeated starts return the existing result. A transient failure has an hour backoff; quota/rate-limit failures have six hours. At most three attempts in that week run automatically; explicit manual retry can exceed this budget.
7. Telegram is opt-in and uses the existing configured allowed chat IDs. It sends only **today's** slot after the configured time. A restart never sends earlier days' backlog. Disabling automation or Telegram prevents new sends; it cannot undo one already in flight. If a selected story is missing, the message says there is nothing reliable to add.
8. Delivery is reserved before network I/O. Confirmed successful sends are not repeated; explicit API refusals retry hourly, at most three attempts per day/chat. Transport ambiguity or an abandoned pending reservation becomes uncertain, **not** an automatic resend. This is not an exactly-once delivery guarantee.
9. Pi Web must be running and the computer awake. A minute timer is not an OS wake service or a cloud scheduler. No Slack, SMTP, Gmail writes, private transcript mining or personal-knowledge harvesting is enabled by this feature.

## Illustrated reading experience

- Practical stories use the existing fern tokens, world-view stories the iris tokens; category names, today labels, read checkmarks and selected borders convey the same information without color. Body text keeps the normal contrast. Light/dark themes and reduced motion are supported.
- The week overview shows actual available counts and explicitly marked reading progress. Desktop has a bounded sticky day list; mobile has a compact seven-day selector (two rows at 320px). Previous/next move focus to the new heading and scroll it into view; switching stories never marks them read. Confirmed read writes announce success. Empty slots remain navigable.
- Each story's factual section has an inline **[1]** citation and a source-host button. Both open the exact stored evidence passage and focus its disclosure. The original article is also always one explicit link away. The significance section is labelled AI interpretation, not an extra independently verified citation. There is currently **one source per story**, not invented numbered references.
- Optional imagery comes only from the stored article's `og:image` / `twitter:image` metadata. It is a source preview, not an AI-generated illustration or a verified photograph of an event. The caption links to the source, and View full image opens the locally served raster. No cropping of charts. Failed images fall back to an explicitly labelled diagram of the known event/reading dates, with no broken image or zoom link.
- Existing editions get imagery on demand without rewriting their immutable text or spending model tokens. Only the selected story's image loads. Browser requests stay on our origin; server fetches reveal neither the reader's IP nor mail to image hosts.

The image endpoint takes **week/day**, never a client-supplied URL. `ai-weekly-media-domain.ts` resolves a stored story before doing network work. It reuses the pinned-DNS public fetch guard on every redirect, caps the article prefix at 2 MiB and image at 3 MiB with streaming cancellation, and has a 15-second combined timeout. Only PNG/JPEG/WebP with matching signatures are served; no SVG, HTML or credentials. Responses have private caching, `nosniff`, restrictive CSP and no-referrer. In-process cache: at most 32 entries / 16 MiB, 24 hours for images, 15 minutes for misses; at most four in-flight source fetches. Image unavailability is decorative, never a reason to block reading or regenerate a briefing.

## Mapping the supplied workflow diagrams

| Diagram stage | Robin implementation |
| --- | --- |
| Trigger / catch-up / guard | `startWeeklyScheduler`, `weeklyClock`, week-key check and shared renewable `background-run-domain` lease |
| Prepare / interests / previous briefs | Named timezone, bounded public-interest prompt, last 12 weeks of event keys/titles/source URLs |
| Harvest | Fresh, isolated scoped model turn with only `web_search`, `fetch_content`, `get_search_content`; structured candidates |
| Verify / gaps | Independent SSRF-safe public fetch, 15-second per-page timeout, two workers, 2 MiB/page, exact visible passage and publication-date matching; rejected sources become coverage gaps |
| Brief | Second isolated turn with **zero tools**, only verified candidate evidence; strict key/reference validation and deterministic four/three day assignment |
| Publish / close | Ownership-fenced atomic edition + run completion in one domain document; partial failures remain run records |
| Deliver | Optional existing Telegram transport, per-day/chat reservations and receipts, latest-day-only catch-up |
| History / retention | 26 editions, 60 run records, 30 days of delivery receipts; read markers follow retained editions |

Original-page text is never an instruction. Neither model turn has bash, filesystem, mail, task, calendar, MCP or delivery capabilities. The deterministic adapter, not the model, publishes and sends. Prompts cap research at four multi-angle search calls and twenty page reads; the hard controls are turn deadlines, twenty admitted candidates, fetch size/time bounds, a one-owner lease, and automatic retry budget. The model's search-call budget is a prompt constraint, not a metered billing cap.

Deduplication combines stable event keys, canonical source URL + publication date, and source URL + normalized passage. A new dated changelog entry is eligible even on a previously used URL; an unchanged passage with a relabelled date is not. The editor also deduplicates semantically. This reduces repeat coverage; it cannot guarantee perfect semantic identity across all publishers.

### Deliberate boundaries

The diagrams describe a larger private-knowledge and grant-monitoring system. This implementation carries over its briefing/run/delivery flow, **not** GKE, Cloud SQL, transcript synchronization, grants, or contact extraction. It runs inside Robin's existing Node service. No new dependencies.

Login-blocked, browser-only, PDF-only or undated sources, and evidence outside the first 2 MiB of a page, are recorded as gaps rather than silently treated as verified. Long changelogs remain usable when the quoted passage and date occur in that bounded prefix. There is no headless-browser retry lane yet. Exact source passages are kept in editions; full copyrighted pages are not archived. A passage can support a claim without proving that claim true, so original-source comparison is not full independent fact-checking.

## Code and storage

- `extension/robin/ai-weekly.ts`: client-safe types, named-timezone calendar arithmetic, seven-day pattern.
- `extension/robin/ai-weekly-research.ts`: bounded untrusted output parsing, source verification and scoped prompts.
- `extension/robin/ai-weekly-domain.ts`: preferences, publication, reading, run records and delivery invariants.
- `lib/ai-weekly-runner.ts`: existing scoped assistant and Telegram adapters; process-lifetime scheduler registered in `instrumentation-node.ts`.
- `app/api/robin/ai-weekly/route.ts`: guarded read/generate/preferences/read-state adapters. No email endpoints change.
- `components/robin/InformationInbox.tsx`: shared entrance; `AiWeeklyBoard.tsx` owns the illustrated briefing view.
- `extension/robin/ai-weekly-media-domain.ts` and `app/api/robin/ai-weekly/image/route.ts`: optional bounded source-image cache and private raster delivery.

Domain state is `~/.pi/robin/ai-weekly/state.json` (or `$ROBIN_DATA_DIR/ai-weekly/state.json`), atomically replaced under the shared file lock. This is **new-domain storage**, not a legacy task/runtime filename. Do not add it to the existing SQLite runtime allow-list without a versioned migration. The shared background ownership registry already uses the selected JSON/SQLite backend. Lock order is background ownership fence → new-domain file lock; never reverse it. No network calls inside either lock. Corrupt or newer state fails closed.

## Checks

```sh
node --experimental-strip-types --test extension/robin/ai-weekly*.test.mjs app/api/robin/ai-weekly/route.test.mjs app/api/robin/ai-weekly/image/route.test.mjs lib/ai-weekly-runner.test.mjs
ROBIN_TEST_TASK_BACKEND=json node --experimental-strip-types --test extension/robin/ai-weekly-domain.test.mjs
node --env-file-if-exists=.env.local e2e/ai-weekly.mjs
node_modules/.bin/tsc --noEmit
```

Browser fixtures are explicitly labelled synthetic, mock API writes and delivery, and test the shared entrance, empty/running/ready/failure states, all seven days, keyboard access, reading state, opt-in preferences, inline evidence focus, previous/next, successful/missing images, dark/reduced-motion presentation and 375/320px phone overflow. They never send a real Telegram message or create a real weekly edition.
