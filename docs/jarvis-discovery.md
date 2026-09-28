# Jarvis market discovery

Open **Product → Jarvis**, or `/product/jarvis`.

This is a single market-discovery campaign. Gmail sending is either one individually confirmed email, or a paced **outbox** that sends only contacts Bruce has approved in a batch (see [Outbox](#outbox)). Nothing is sent to a contact nobody approved. It has two parts.

## Target personas (`info_exec`, primary)

Jarvis fits **executives** who keep an explicit watch list — a portfolio, a client book, competitors, a technology agenda — and pay for missing a development on it. A named list also makes "why this reached you" precise. The target is **uncapped**: each run asks for a number of qualified people, and more can always be added.

**Rubric v2** (`JARVIS_RUBRIC_VERSION = 2`, 2026-09-26) tightened v1, which let in regional law/CPA partners and construction or hospitality presidents. Four gates come first; failing any gives persona "none":

1. **Executive** — founder, C-level, president, fund GP/partner, advisory-firm MD/managing partner, or an EVP/SVP running a function. Not professors, researchers or individual contributors.
2. **About 500 people or fewer** — no strategy or analyst team filters news for them.
3. **A named watch list** (`watchList`), stated concretely from evidence, e.g. "14 seed-stage vertical-AI portfolio companies".
4. **A fast-moving field** — venture, AI and software, fintech and banking technology, healthcare technology and payer policy, M&A, energy transition, cybersecurity. Not construction, hospitality, real estate, agriculture, general manufacturing or local practices.

| # | Persona (`persona`) | Who | Share (%) |
|---|---|---|---|
| 1 | `vc` | GPs and partners of early-stage funds, solo GPs, practising angels, family-office CIOs, PE operating partners, corporate-venture heads | 35 |
| 2 | `client_advisor` | MDs and partners in M&A, investment banking, corporate finance, boutique strategy consulting and deal practices — not general law/CPA managing partners, insurance or wealth firms | 25 |
| 3 | `startup_leader` | Founders and C-level of 5–200 person companies in AI, fintech, healthtech, climate, cybersecurity, defense tech | 25 |
| 4 | `nontech_tech_leader` | CIO/CTO/CDO/chief strategy/corporate-development executives at midsize non-tech companies, and CEOs of midsize banks, credit unions, insurers and healthcare providers who visibly track technology or regulation | 15 |

`researcher` remains a known value so v1 assessments still render, but it is no longer researched or counted.

A run asks for one persona per batch, choosing the one furthest behind its share (counting attempts), so the order sets the mix without starving the lower personas. A candidate returned for a persona that was not asked is dropped.

A contact from any cohort can be a target user. **Rescoring** re-assesses every contact not yet judged under the current rubric version: contacts with stored evidence and earlier score reasons are re-judged from those alone, eight per turn with no web tools; the rest are researched, four per turn. It sets `persona`, `watchList` and scores, or clears persona and watch list ("none") while keeping the scores, and never touches drafts, status or email. Bumping `JARVIS_RUBRIC_VERSION` re-queues everyone.

After the gates, every candidate is scored on four dimensions, 0–3 each, with a one-line reason per score. Thin evidence scores 1; a 3 needs specific evidence:

| Dimension | 3 | 2 | 1 | 0 |
|---|---|---|---|---|
| `change` | weekly change that alters their decisions, evidenced | monthly | slow, or only generally "fast-moving" | stable or local |
| `breadth` | many named entities or domains (portfolio, client book, market + tech + regulation) | a few | one area | one narrow feed |
| `unfiltered` | a small team (under ~50, a partnership, a solo GP) | ~50–500 with no analyst team mentioned | unclear size | large organization, or curates news for others |
| `footprint` | two or more kinds of public material beyond a bio | one | a bio only | a title only |

A person is a **target user** when they pass the gates, have a watch list, reach **9/12 with no zero**, and were assessed under the current rubric version. Never target users: association staff (a channel, not a user), Fortune 500 executives, researchers and professors, ceremonial roles, and people who sell news or monitoring products.

Each persona has its own search playbook in `extension/robin/jarvis-research.ts`, built on behaviour rather than titles: published portfolios and theses, practice pages that name the sectors covered, accelerator lists, executives quoted in trade press, CIO-of-the-year lists, conference outlook speakers, faculty pages.

**A work email is optional for this cohort, but worth effort**, because only people with a confirmed email can go through the outbox. Senior people rarely publish an address, and counting only findable emails is what filled the first campaign with association staff. A qualified person counts with or without an email; without one, the list says so and `profileUrl` is the page for reaching them through LinkedIn or an introduction. An address, when found, follows the same public-source rules as everywhere else.

## The original balanced campaign

The first campaign targeted **100 sendable core contacts** — core candidates with a publicly sourced individual work email — whose roles create information burden but who sit mostly outside the AI/tech echo chamber:

- 30 independent-clinic / specialty-practice owners and operators
- 25 small/midsize professional-services firm leaders
- 30 non-tech industry executives and association operators
- 15 non-technical leaders at small technology companies

It reached 100 and is kept as-is: its contacts, drafts and counters are unchanged. A core candidate in these cohorts without a public work email stays in the list but does **not** advance that target.

The original tech/VC/research-heavy batch is retained as `adjacent` for comparison and counts toward neither target. Bounced and do-not-contact records drop out of both targets. Sent/replied counts are separate. The on-page list and HTML export rank unsent contacts with work emails first (approved/ready before unreviewed), then missing-email contacts, then sent/replied contacts, with declined/bounced/do-not-contact last; within a group, higher news burden comes first. Both show each scored contact's total, and the contact page shows every dimension with its reason.

## Tiers: strict target users and the wide net

The campaign's question is whether executives in general want Jarvis, so outreach casts a wide net with a quality floor, and reply rates are compared per tier (`jarvisTier()` in `jarvis-shape.ts`):

- **A** — a target user under the strict rubric above.
- **B** — any other **current executive** (title check; not former, assistant or professor), outside associations and chambers, assessed under the current rubric with a news burden of **at least 6/12** and a `change` score of at least 1.

Everything else is not contacted. The page's **Executives · A+B** filter, the tier badge on each row, the HTML list's default view and the outbox's experiment line (sent, replied and reachable per tier) all use the same function.

**Wide net · 50 executives with email** runs `info_exec` research in wide mode: the persona playbooks still steer where to look, but any executive above the floor is kept, with persona "none" when they fit no persona, and a published work email is **required**. The run counts research-found A/B executives whose email was seen on its source page.

## Public sources

Research and rescoring use any public professional source: company and firm pages, LinkedIn public profiles and posts, personal websites, Substack/Medium, X/Bluesky, podcasts and show notes, conference talks, GitHub, Google Scholar, university directories, press releases and trade-press interviews. LinkedIn usually requires a login when fetched, so what the search result itself shows (headline, current role, post text) is used as corroboration, and a public LinkedIn URL may be the profile link; the cited evidence must still be a page that could be opened. Research never logs in, never uses scraping or data-broker services, and never guesses an email address.

## Workflow

1. **Find 3 target users** inspects quality; **Find 30 more target users** runs successive `info_exec` batches until 30 more people qualify. **Rescore existing contacts** assesses the earlier list against the personas. Only candidates that qualify under the current rubric advance the run; an info_exec candidate without scores or a watch list is rejected. **Find next 3** and **Research to 100 sendable** still run the original balanced campaign, which counts work emails. Longer and focused research asks for confirmation because it consumes model/search allowance, and every run stops after three batches that add nothing it counts, or three failed batches.
2. Inspect the person's source quotation, role, **persona and news burden** (for `info_exec`) and **need hypothesis**. Scores are research judgements with cited reasons, not facts about the person; correct the cohort if a score looks wrong. A hypothesis is not evidence that they have expressed a problem. Record the **person's public work location** and **company HQ/office** separately, each with its public source URL. The person's IANA time zone (e.g. `America/Chicago`) may be inferred from a sufficiently specific sourced work location; it is not a fixed UTC offset or proof of their current physical position. Never substitute company HQ for the person's location or store a home address.
3. Inspect the public work-email source. `source_found` means the server saw the literal address on that page; it is **not** ownership, SMTP/deliverability, consent or legal-compliance verification. Obfuscated/JS-only/unreachable sources remain `unconfirmed`; missing addresses are never guessed.
4. Drafts introduce Jarvis as an early personal-relevance briefing idea; `opener` addresses the recipient's sourced work, while `area` remains available for custom templates. For the initial 100-contact campaign, unsent sendable core drafts also ask a role-specific question; these are hypotheses to verify, not claims about a person's pain. Edit the subject/body and click **Approve identity, email and draft**. This enables Gmail and `mailto:` composer links; those links only open drafts. Check applicable outreach rules before contacting someone.
5. To send, reconnect Google and approve `gmail.send`. Either open one **Ready** contact, click **Review and send one email**, read the full recipient/subject/body, and explicitly confirm; or tick contacts in the list and click **Approve and queue** for the [outbox](#outbox). Both send the stored approved snapshot and record Gmail's message and thread ids, marking **Sent** only on confirmed success. Alternatively, send yourself from a composer link and mark **Sent** manually; the outbox cannot track replies to those. Record **Interested**, **Declined** or **Do not contact** manually; the outbox records **Replied** and **Bounced** from Gmail for messages it can see. Real needs/quotes and interview notes have their own fields, separate from the generated hypothesis.
6. Seven full days after the original send, a contact still marked **Sent** with no reply or follow-up recorded gets **one** automatic follow-up from the outbox when the app sent the original, since only then is there a Gmail thread to reply in. Contacts sent from a composer link instead appear in the Jarvis reminder/banner/filter; follow up yourself and click **Mark followed up**, which only records a timestamp. Suppressed, bounced, replied, and previously followed-up contacts are never followed up.
7. Research never overwrites existing contacts, edited drafts, notes, replies or suppression. Identity deduplication uses normalized name/company or profile, and exact email. Shared team pages do not merge different people.

Existing contacts have empty location/time-zone fields until individually sourced; no backfill is guessed from the company name, industry or email domain. New research requests location evidence but does not discard an otherwise valid contact if optional geography is absent. Draft edits revoke prior approval; changing an email requires a public source and an exact quotation containing it. Declined/bounced/do-not-contact records have no compose links. Do-not-contact is not reopenable through the API/UI. A persisted send claim prevents repeat requests (including after crashes); if Gmail times out, the outcome is uncertain, so check Gmail Sent and reconcile manually instead of retrying from the app. Existing read-only grants must be re-authorized before sending is offered.

## Outbox

The outbox sends contacts Bruce approved, at a pace a personal Gmail account can sustain. It never chooses whom to contact.

- **Queueing.** Ticking contacts and clicking **Approve and queue** approves each one's identity, email and draft and adds it to the queue (`queuedAt`). Only unsent contacts whose email was seen on its source page (`source_found`) can be queued, and each carries the revision Bruce saw: a contact edited since the list loaded is skipped and reported. Editing a queued contact's draft or email removes it from the queue; **Remove from queue** does too.
- **Pacing.** One email per tick (every minute), 6–12 randomized minutes apart, only on weekdays 08:00–17:59 in the recipient's sourced time zone (America/New_York when unknown), and at most the daily limit (default 20, selectable 10–40) counting initial sends and follow-ups since local midnight. Follow-ups go before new sends.
- **Reply and bounce detection.** Every 15 minutes, and on **Check replies now**, the outbox reads (never modifies) the Gmail thread of each message the app sent. A message Bruce did not send marks the contact **Replied**; a delivery-failure notice marks it **Bounced**; out-of-office auto-replies are ignored. The thread is read again immediately before any follow-up.
- **Follow-up.** One per contact, seven days after the original send, as a reply in the same thread (`In-Reply-To`/`References`, subject `Re: …`), rendered from the follow-up template with `{{firstName}}` and the same placeholders as the first email. The default ends with an offer not to follow up again.
- **Stops.** A send whose outcome is uncertain is never retried and **pauses the whole outbox**, as do three bounces within 24 hours. **Resume sending** is the acknowledgement; check Gmail Sent first. **Pause sending** stops it at any time; queued contacts stay queued.
- **Where it runs.** A one-minute timer in the Next server process, started by `instrumentation-node.ts` and, idempotently, when the Jarvis route loads. It sends nothing while Google lacks `gmail.send`, and only the page's batch approval ever puts a contact in the queue.

## Research lifecycle

- Existing `runScopedAssistantTurn`, existing configured model/search service, isolated one-shot session.
- Exact tool allow-list: `web_search`, `fetch_content`, `get_search_content`. No Gmail, filesystem, personal-profile, or write tools.
- Model output must be a bounded JSON envelope. Server validates each candidate and then writes through `jarvis-domain.ts`; research cannot set user-owned status or reply fields.
- At most 3 candidates per batch (five-person batches hit the turn timeout), 30 turns per run, 4 minutes per turn. Three consecutive batches that add nothing the run counts stop the job.
- Rescoring is a second background job with its own state (`rescore`): eight contacts per turn from stored evidence or four with research, at most 80 turns, the same tool allow-list, writing only `persona`, `watchList`, `newsBurden`, `assessedAt` and `assessedVersion`. A contact the model skips is not retried in that run; start it again to retry. A failed turn stops rather than silently spending on retries. Saved earlier batches survive.
- One background job on the local Next server, held in `globalThis` across hot reload. Closing the page does not stop it; **Stop research** does. Server restart interrupts it, which the page reports honestly; click again to resume toward the total target.
- This is not a durable worker queue for serverless or multiple server processes. Use a durable queue before deploying it that way.

## Storage and script

Data stays outside the repo in `~/.pi/robin/jarvis-discovery.json` (or `ROBIN_DATA_DIR`). The domain uses the existing locked, atomic JSON store. It includes status history and timestamps. GETs are read-only. All API writes use the existing same-origin and authentication guards.

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

`discover N` runs the balanced campaign toward **N sendable core contacts** in total, not N additional; maximum 100. Adjacent records and people without a sourced email do not advance it. The `info_exec` cohort is started from the page. `report [file.html]` writes the same self-contained HTML list as the page's **Export HTML** button (`GET /api/robin/jarvis/report`, `?inline=1` to view in the browser); compose links in it follow the same approval gate as the page. The script calls the same HTTP API as the page, using `PI_WEB_PASSWORD` without printing it. `PI_WEB_URL` defaults to `http://127.0.0.1:30141`. `personas N` starts persona research toward N more qualified target users; `rescore` starts rescoring. The script has no send or queue command: mail goes out only through the reviewed contact UI (`send`) or the outbox, and only the page's batch approval (`queue`) fills the outbox.

## Email template

Edit `scripts/jarvis-email-template.txt` (`Subject: ...`, a blank line, then the body), then preview and save:

```sh
node --env-file-if-exists=.env.local --experimental-strip-types scripts/jarvis-discovery.ts template           # dry run + preview
node --env-file-if-exists=.env.local --experimental-strip-types scripts/jarvis-discovery.ts template --apply   # save
```

Placeholders: `{{firstName}}` (a contact's `firstName` override, else the first word of the name), `{{name}}`, `{{company}}`, `{{role}}`, `{{area}}`, `{{work}}` ("your work leading X" / "your work in X"), and `{{opener}}` (the researched, second-person opening paragraph about this person's work). An unknown placeholder is rejected. Saving rewrites only drafts that are unapproved, still `new`, and exactly what the previous template produced; edited, approved or contacted drafts are kept. New research uses the saved template.

The contact editor and every row of the HTML list have **Copy email / subject / body** buttons. The HTML list also has its own **Export HTML** button that saves the page as a standalone file.

## Checks

```sh
node_modules/.bin/tsc --noEmit
node --experimental-strip-types --test extension/robin/jarvis-domain.test.mjs lib/jarvis-discovery.test.mjs
# In an authenticated disposable browser on /product/jarvis:
playwright-cli -s=jarvis-check run-code --filename=scripts/check-jarvis-ui.playwright.js
```

The browser test intercepts all Jarvis API traffic; it never edits real contacts or runs real research. It covers research/stop, review gating, encoded compose links, failed-save preservation, unsaved-edit warnings, sent/replied/suppression, seven-day follow-up reminders and manual acknowledgement, interview notes, filters, and desktop/mobile layouts.
