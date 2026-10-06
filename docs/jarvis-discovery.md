# Jarvis market discovery

Open **Product → Jarvis**, or `/product/jarvis`.

This is a single market-discovery campaign. Gmail sending is either one individually confirmed email, or a paced **outbox** that sends only contacts Bruce has approved in a batch (see [Outbox](#outbox)). Nothing is sent to a contact nobody approved. It has two parts.

## Current 100-person Shopify / DTC validation sprint (`info_exec`, primary)

The current sprint targets **founders, owners, CEOs and COOs of 5–100 person Shopify / Shopify Plus DTC brands**. Research works company-first, then identifies the current decision-maker. The 100 contacts are split across three experiments: multi-channel (34), regulated categories (33), and expansion/cross-border (33). Healthcare and legal contacts remain readable as historical research but are not added by this sprint.

**Rubric v4** (`JARVIS_RUBRIC_VERSION = 4`, 2026-09-29) adds five hard sprint requirements to the existing news-burden rubric:

1. **Decision owner** — current founder, owner, CEO, COO or president.
2. **Shopify proof** — an opened public source with an exact quotation supporting Shopify or Shopify Plus.
3. **Company fit ≥ 35/50** — real DTC brand, appropriate scale and operating complexity.
4. **Reachability ≥ 30/50** — current decision-maker, public footprint and a trustworthy public contact route.
5. **Why now** — a sourced recent launch, expansion, retail/channel move, funding, hiring, interview or relevant category event.

| Lane (`sourcingLane`) | Company signal | Target |
|---|---|---:|
| `multichannel` | Shopify plus retail, wholesale, Amazon, TikTok Shop or several acquisition channels | 34 |
| `regulated` | Beauty, supplements, food, children's products, pet health or health devices | 33 |
| `expansion` | Recent product, international, retail, funding, subscription or hiring event | 33 |

The three lanes feed an event-driven worker pool. Three research workers save each completed contact immediately, so one slow lane no longer blocks the others. Lane quotas are soft diversity targets rather than barriers to reaching the requested total. A single task has a 150-second hard ceiling; failures are isolated and the bounded worker budget prevents runaway spend. The model uses public web search only; nobody is contacted by research.

Older persona values remain readable for history but never qualify under v3.

A run asks for one persona per batch, choosing the one furthest behind its share (counting attempts), so the order sets the mix without starving the lower personas. A candidate returned for a persona that was not asked is dropped.

A contact from any cohort can be a target user. **Rescoring** re-assesses every contact not yet judged under the current rubric version: contacts with stored evidence and earlier score reasons are re-judged from those alone, eight per turn with no web tools; the rest are researched, four per turn. It sets `persona`, `watchList` and scores, or clears persona and watch list ("none") while keeping the scores, and never touches drafts, status or email. Bumping `JARVIS_RUBRIC_VERSION` re-queues everyone.

After the gates, every candidate is scored on four dimensions, 0–3 each, with a one-line reason per score. Thin evidence scores 1; a 3 needs specific evidence:

| Dimension | 3 | 2 | 1 | 0 |
|---|---|---|---|---|
| `change` | weekly change that alters their decisions, evidenced | monthly | slow, or only generally "fast-moving" | stable or local |
| `breadth` | many named entities or domains (portfolio, client book, market + tech + regulation) | a few | one area | one narrow feed |
| `unfiltered` | a small team (under ~50, a partnership, a solo GP) | ~50–500 with no analyst team mentioned | unclear size | large organization, or curates news for others |
| `footprint` | two or more kinds of public material beyond a bio | one | a bio only | a title only |

A person is a **research candidate** when they pass the model gates, have a watch list, reach **9/12**, score `change`, `breadth` and `footprint` at least 2, have no zero, and were assessed under the current rubric. This score does **not** establish a verified target user or an actual unmet need. A strict-ICP record also needs `icpReview.verdict = "verified"` after a human checks role, persona, evidence and personal contact route before email approval, sending or marking a social message sent. Missing review means pending; `adjacent` retains useful contacts outside the current ICP, without deleting their drafts or outreach history. Never target users: dropshippers, ecommerce agencies/course sellers, generic law-firm managing partners, clinicians without operating responsibility, large health systems, association staff, researchers, consultants, or news/monitoring sellers.

Each persona has its own search playbook in `extension/robin/jarvis-research.ts`, built on behaviour rather than titles: published portfolios and theses, practice pages that name the sectors covered, accelerator lists, executives quoted in trade press, CIO-of-the-year lists, conference outlook speakers, faculty pages.

Every counted Shopify/DTC target needs at least one **primary contact route**: a source-verified individual work email or a trustworthy personal Instagram tied to the founder and company. LinkedIn, X, TikTok and brand social accounts do not satisfy this gate. Research still saves trustworthy LinkedIn and other social profiles as secondary reference when found. Profile URLs never prove their posts were read or supply scoring evidence. A specific opened post can be stored separately as `socialEvidence` (direct post URL + exact quote) for manual verification. A saved profile that actually hits a login wall is recorded in `socialLoginRequired` and shown as a link for Bruce to open and sign into himself. Login in his own browser does not give the server research worker access: he can share a specific post URL or text for analysis. Never request passwords, bypass a login or auto-message anyone. An email still follows the public-source rules below.

## The original balanced campaign

The first campaign targeted **100 sendable core contacts** — core candidates with a publicly sourced individual work email — whose roles create information burden but who sit mostly outside the AI/tech echo chamber:

- 30 independent-clinic / specialty-practice owners and operators
- 25 small/midsize professional-services firm leaders
- 30 non-tech industry executives and association operators
- 15 non-technical leaders at small technology companies

It reached 100 and is kept as-is: its contacts, drafts and counters are unchanged. A core candidate in these cohorts without a public work email stays in the list but does **not** advance that target.

The original tech/VC/research-heavy batch is retained as `adjacent` for comparison and counts toward neither target. Bounced and do-not-contact records drop out of both targets. Sent/replied counts are separate. The on-page list and HTML export rank unsent contacts with work emails first (approved/ready before unreviewed), then missing-email contacts, then sent/replied contacts, with declined/bounced/do-not-contact last; within a group, higher news burden comes first. Both show each scored contact's total, and the contact page shows every dimension with its reason.

## Tiers: strict target users and the wide net

The page retains the old experiment tiers for comparison (`jarvisTier()` in `jarvis-shape.ts`), but current research produces A-rated **candidates**, and outreach additionally requires human ICP verification:

- **A** — a candidate under the strict model rubric above; the badge alone never authorizes outreach.
- **B** — a retained legacy wide-net executive above the old quality floor. B remains visible for experiment history but is not part of the current ICP.

Everything else is not contacted. The page's **Executives · A+B** filter, the tier badge on each row, the HTML list's default view and the outbox's experiment line (sent, replied and reachable per tier) all use the same function.

Wide-net mode remains in the domain for historical runs, but daily research and the primary UI now use strict v3 ICP research only.

## Public sources

Research and rescoring use public professional sources: organization pages, accessible social posts, interviews, conferences and trade press. Search snippets can corroborate identity but do not count as an opened post. LinkedIn and Instagram often restrict fetching; an inaccessible profile is still useful for manual outreach, not as evidence of its content. Research never logs in, bypasses restrictions, uses data brokers or guesses an email address.

## Workflow

The page shows the research funnel explicitly: **Prospect → Evidence complete → Human verified → Email queued**. These are separate states, not synonyms. Research may run at the same time as the outbox, but only contacts already human-verified and batch-approved can be queued; a newly discovered contact never crosses that boundary automatically. Instagram and other social routes remain browser/manual sends after batch review and are never transmitted by the server.

1. **Run research pipeline** manually adds 3–100 more contactable prospects; **Research to 100** fills the first sprint target. Three workers save results independently, while a bounded turn budget caps spend. One malformed or timed-out task is recorded and isolated instead of stopping the whole run. **Rescore existing contacts** assesses the earlier list against the new personas. The legacy balanced-campaign buttons remain separate.
2. Inspect the person's source quotation, role, **persona and news burden** (for `info_exec`) and **need hypothesis**. Use **Human ICP review** to record a reason and mark Verified, Pending or Adjacent. The five clearly mismatched people in the 2026-09-29 review were marked adjacent; the other 95 remain pending, not automatically approved. Scores are research judgements with cited reasons, not facts about the person; correct the cohort if a score looks wrong. A hypothesis is not evidence that they have expressed a problem. Record the **person's public work location** and **company HQ/office** separately, each with its public source URL. The person's IANA time zone (e.g. `America/Chicago`) may be inferred from a sufficiently specific sourced work location; it is not a fixed UTC offset or proof of their current physical position. Never substitute company HQ for the person's location or store a home address.
3. Inspect the public work-email source. `source_found` means the server saw the literal address on that page; it is **not** ownership, SMTP/deliverability, consent or legal-compliance verification. Obfuscated/JS-only/unreachable sources remain `unconfirmed`; missing addresses are never guessed.
4. Drafts introduce Jarvis as an early personal-relevance briefing idea; `opener` addresses the recipient's sourced work, while `area` remains available for custom templates. For the initial 100-contact campaign, unsent sendable core drafts also ask a role-specific question; these are hypotheses to verify, not claims about a person's pain. Edit the subject/body and click **Approve identity, email and draft**. This enables Gmail and `mailto:` composer links; those links only open drafts. Check applicable outreach rules before contacting someone.
5. To send, reconnect Google and approve `gmail.send`. Either open one **Ready** contact, click **Review and send one email**, read the full recipient/subject/body, and explicitly confirm; or tick contacts in the list and click **Approve and queue** for the [outbox](#outbox). Both send the stored approved snapshot and record Gmail's message and thread ids, marking **Sent** only on confirmed success. Alternatively, send yourself from a composer link and mark **Sent** manually; the outbox cannot track replies to those. Record **Interested**, **Declined** or **Do not contact** manually; the outbox records **Replied** and **Bounced** from Gmail for messages it can see. Real needs/quotes and interview notes have their own fields, separate from the generated hypothesis.
6. Seven full days after the original send, a contact still marked **Sent** with no reply or follow-up recorded gets **one** automatic follow-up from the outbox when the app sent the original, since only then is there a Gmail thread to reply in. Contacts sent from a composer link instead appear in the Jarvis reminder/banner/filter; follow up yourself and click **Mark followed up**, which only records a timestamp. Suppressed, bounced, replied, and previously followed-up contacts are never followed up.
7. Research never overwrites existing contacts, edited drafts, notes, replies or suppression. Identity deduplication uses normalized name/company or profile, and exact email. Shared team pages do not merge different people.

Existing contacts have empty location/time-zone fields until individually sourced; no backfill is guessed from the company name, industry or email domain. New research requests location evidence but does not discard an otherwise valid contact if optional geography is absent. Draft edits revoke prior approval; changing an email requires a public source and an exact quotation containing it. Declined/bounced/do-not-contact records have no compose links. Do-not-contact is not reopenable through the API/UI. A persisted send claim prevents repeat requests (including after crashes); if Gmail times out, the outcome is uncertain, so check Gmail Sent and reconcile manually instead of retrying from the app. Existing read-only grants must be re-authorized before sending is offered.

## Outbox

The outbox sends contacts Bruce approved, at a pace a personal Gmail account can sustain. It never chooses whom to contact.

- **Queueing.** Ticking contacts and clicking **Approve and queue** approves each one's identity, email and draft and adds it to the queue (`queuedAt`). Strict-ICP leads must first be human-verified; only unsent contacts whose email was seen on its source page (`source_found`) can be queued, and each carries the revision Bruce saw: a contact edited since the list loaded is skipped and reported. Editing a queued contact's draft or email removes it from the queue; **Remove from queue** does too.
- **Pacing.** One email per tick (every minute), 6–12 randomized minutes apart, at any hour after explicit review and queueing, and at most the optional daily limit counting initial sends and follow-ups since local midnight. Follow-ups become eligible after 24 hours and go before new sends. `JARVIS_DELIVERY_POLICY` in `jarvis-shape.ts` is the shared sender/UI contract for these values.
- **Reply and bounce detection.** Every 15 minutes, and on **Check replies now**, the outbox reads (never modifies) the Gmail thread of each message the app sent. A message Bruce did not send marks the contact **Replied**; a delivery-failure notice marks it **Bounced**; out-of-office auto-replies are ignored. The thread is read again immediately before any follow-up.
- **Follow-up.** One per contact, 24 hours after the original confirmed send, after a fresh thread check finds no reply or bounce. It is sent in the same thread (`In-Reply-To`/`References`, subject `Re: …`) and rendered from the follow-up template with `{{firstName}}` and the same placeholders as the first email. The default ends with an offer not to follow up again.
- **Stops.** A send whose outcome is uncertain is never retried and **pauses the whole outbox**, as do three bounces within 24 hours. **Resume sending** is the acknowledgement; check Gmail Sent first. **Pause sending** stops it at any time; queued contacts stay queued.
- **Where it runs.** A one-minute timer in the Next server process, started by `instrumentation-node.ts` and, idempotently, when the Jarvis route loads. It sends nothing while Google lacks `gmail.send`, and only the page's batch approval ever puts a contact in the queue.

## Research lifecycle

- Existing `runScopedAssistantTurn`, existing configured model/search service, isolated one-shot session.
- Exact tool allow-list: `web_search`, `fetch_content`, `get_search_content`. No Gmail, filesystem, personal-profile, or write tools.
- Model output must be a bounded JSON envelope. Server validates each candidate and then writes through `jarvis-domain.ts`; research cannot set user-owned status or reply fields.
- The DTC sprint uses three independent workers, at most one deeply researched contact per task, a 150-second task ceiling and a shared 120-turn budget. Results persist as each task completes; a slow or malformed task does not hold a wave open or stop productive workers. Legacy cohorts retain their earlier bounded batch runner.
- Rescoring is a second background job with its own state (`rescore`): eight contacts per turn from stored evidence or four with research, at most 80 turns, the same tool allow-list, writing only `persona`, `watchList`, `newsBurden`, `assessedAt` and `assessedVersion`. A contact the model skips is not retried in that run; start it again to retry. A failed turn stops rather than silently spending on retries. Saved earlier batches survive.
- One background job on the local Next server, held in `globalThis` across hot reload. Closing the page does not stop it; **Stop research** does. Server restart interrupts it, which the page reports honestly; click again to resume toward the total target.
- This is not a durable worker queue for serverless or multiple server processes. Use a durable queue before deploying it that way.

### Official website contact enrichment

Website enrichment is a separate four-worker queue, so it can run beside DTC discovery and the approved email outbox. It attempts every current DTC prospect and persists an explicit result: found, none, missing website, blocked, or error.

The crawler reads only public pages. It checks the verified company root plus up to four same-domain contact, support, wholesale, partnership, team, about, or press pages. It records same-domain public email addresses, `tel:` numbers, and real contact forms, but never submits a form. Named addresses are labelled personal only when the mailbox matches the prospect's name; generic and other employee addresses remain company contacts and never enter the personal-email outbox automatically.

Source pages and company sites are distinct. A saved article, podcast, marketplace, social profile, package string, Sentry endpoint, example address, newsletter form, or unrelated publisher domain must not be promoted to an official-site contact. When existing evidence does not establish a plausible company domain, a bounded public-source lookup runs before crawling; failure to prove the site is saved as `missing_website` rather than guessed.

## Storage and script

Data stays outside the repo in `~/.pi/robin/jarvis-discovery.json` (or `ROBIN_DATA_DIR`). A pre-review backup is at `~/.pi/robin/jarvis-discovery.json.pre-review-2026-09-29T18-03-24-028Z`. Daily auto-research was disabled on 2026-09-29; the previous 20-at-06:00 settings were retained, not erased. Do not re-enable until interview findings justify the ICP and scoring. No contacts were deleted and no outreach was queued by the review. The domain uses the existing locked, atomic JSON store. It includes status history and timestamps. GETs are read-only. All API writes use the existing same-origin and authentication guards.

With the standard dev server already running:

```sh
node --env-file-if-exists=.env.local --experimental-strip-types scripts/jarvis-discovery.ts status
node --env-file-if-exists=.env.local --experimental-strip-types scripts/jarvis-discovery.ts discover 100
node --env-file-if-exists=.env.local --experimental-strip-types scripts/jarvis-discovery.ts personas 30
node --env-file-if-exists=.env.local --experimental-strip-types scripts/jarvis-discovery.ts rescore
node --env-file-if-exists=.env.local --experimental-strip-types scripts/jarvis-discovery.ts stop
node --env-file-if-exists=.env.local --experimental-strip-types scripts/jarvis-discovery.ts update CONTACT_ID replied
node --env-file-if-exists=.env.local --experimental-strip-types scripts/jarvis-discovery.ts note CONTACT_ID "Their actual feedback"
node --env-file-if-exists=.env.local --experimental-strip-types scripts/jarvis-discovery.ts export > /tmp/jarvis-export.json
```

`discover N` runs the balanced campaign toward **N sendable core contacts** in total, not N additional; maximum 100. Adjacent records and people without a sourced email do not advance it. The `info_exec` cohort is started from the page. `report [file.html]` writes the same self-contained HTML list as the page's **Export HTML** button (`GET /api/robin/jarvis/report`, `?inline=1` to view in the browser); compose links in it follow the same approval gate as the page. The script calls the same capability-scoped HTTP APIs as the page, using `PI_WEB_PASSWORD` without printing it. `PI_WEB_URL` defaults to `http://127.0.0.1:30141`. `personas N` starts persona research toward N more qualified target users; `rescore` starts rescoring. The script has no send or queue command: mail goes out only through the reviewed contact UI (`send`) or the outbox, and only the page's batch approval (`queue`) fills the outbox.

## Email template

On **Jarvis CRM**, open **Email template · edit and generate drafts** to edit the subject and body. **Save template and regenerate drafts** previews the number affected, asks for confirmation, then saves the template and regenerates eligible drafts; it never queues or sends email. The CLI still supports a local template file (`Subject: ...`, a blank line, then the body):

```sh
node --env-file-if-exists=.env.local --experimental-strip-types scripts/jarvis-discovery.ts template           # dry run + preview
node --env-file-if-exists=.env.local --experimental-strip-types scripts/jarvis-discovery.ts template --apply   # save
```

Placeholders: `{{firstName}}` (a contact's `firstName` override, else the first word of the name), `{{name}}`, `{{company}}`, `{{role}}`, `{{area}}`, `{{work}}` ("your work leading X" / "your work in X"), and `{{opener}}` (the researched, second-person opening paragraph about this person's work). An unknown placeholder is rejected. Saving rewrites only current researched strict-ICP drafts that are unapproved, unqueued, still `new`, and exactly what the previous template produced; legacy, edited, queued, approved or contacted drafts are kept. New research uses the saved template.

The CRM defaults to the three current-ICP lists, with a second filter for **Email to review**, **Social · manual**, and **Contacted**. Historical audiences are tucked away, and the outbox folds to a status line when empty; a queued or paused outbox opens for supervision. The contact editor has **Profile / Email / Social / Notes** tabs. Email and each available social platform have editable per-person drafts. Social messages can be saved, copied, then sent by hand on the person's public profile; opening the profile or copying text never sends or logs a message. After sending manually, explicitly record the send (and any reply) in the Social tab; the exact sent text is retained even if the draft is edited later. Once social outreach is recorded, initial email approval and sending are blocked to prevent duplicate outreach. The contact editor and every row of the HTML list have **Copy email / subject / body** buttons. The HTML list also has its own **Export HTML** button that saves the page as a standalone file.

## Checks

```sh
node_modules/.bin/tsc --noEmit
node --experimental-strip-types --test extension/robin/jarvis-domain.test.mjs lib/jarvis-discovery.test.mjs
# In an authenticated disposable browser on /product/jarvis:
playwright-cli -s=jarvis-check run-code --filename=scripts/check-jarvis-ui.playwright.js
```

The browser test intercepts all Jarvis API traffic; it never edits real contacts or runs real research. It covers research/stop, review gating, encoded compose links, failed-save preservation, unsaved-edit warnings, sent/replied/suppression, 24-hour follow-up reminders and manual acknowledgement, interview notes, filters, and desktop/mobile layouts.
