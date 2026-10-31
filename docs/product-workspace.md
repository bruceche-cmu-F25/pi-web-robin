# Product workspace

`/product` is the **Product lab**, using the user-selected A layout: a project index,
a central reading/editing pane, and a collapsible Brainstorm partner. Existing ideas,
notebooks, capture, stages, links and launch plans remain on their original APIs.
The [market-validation framing workflow](agents/market-validation.md) is available
inside each idea's Experiments / Evidence & decisions views, using the same forms,
domain and separate storage as `/product/validation`. Opening either entry never
initializes storage, creates a project or migrates Jarvis data.

Outreach is unchanged: the lab explains the boundary and links to `/outreach/research`
in a new tab. It does not fetch CRM counts, transfer contacts or invoke send APIs.
`/product/jarvis` remains a legacy redirect. The prototype and implementation audit
are recorded in [product-lab-prototype.md](product-lab-prototype.md).

## Discovery source

The user-selected opportunity source is **only**
<https://www.starterstory.com/data/ios-app-ideas>.

`ProductResearch` presents this directory as the main workspace, not a disclosure
under interview-derived opportunities. Both the page-level and per-product AI
briefs start from directory candidates. Official product pages, App Store pricing
and reviews can be used to investigate them. Founder interviews may explain how
to execute, but are not the source for selecting products.

`product-opportunities.ts` reads the publicly visible rows on this one page. It
records the detail URL, listed domain, revenue/basis, solo score when shown and
exact discovery URL. Locked/blurred rows remain excluded. It does not follow
premium links, infer undisclosed revenue as zero, or assume the directory proves
a product has an iOS version. Low-revenue apps, high-revenue apps and unfamiliar
categories are all retained; the old $5K–$200K and SaaS-keyword gates are gone.

The current public **catalog snapshot** is separate from the old accumulated
`opportunities` history. Old daily picks are retained, including their original
dates; they are never relabeled as originating from this iOS page. Source changes
trigger a fresh check even after an old-source scan on the same day. Failed checks
retain the last successful snapshot and report an error; retries remain bounded
per source/day except for explicit refresh. The legacy daily history still adds
at most three new URLs, but that cap does not hide entries from the catalog view.

Revenue and solo scores are source claims, not audited revenue, profit, personal
fit scores or proof of demand for the user's derivative idea. Improvement and
context-transfer prompts are explicitly **unvalidated category templates**, not
individual product research. The research action asks for evidence before drawing
product-specific conclusions.

Saving is explicit and idempotent (`starter-story-${id}`). It saves the directory
and detail links with the hypotheses; repeated adoption opens the existing idea
without overwriting its name, notes or parked state. Legacy interview-case adoption
remains supported by the domain/API for compatibility, but is not a discovery UI.

## Is this worth doing?

Each directory candidate has an explicit **Assess this opportunity** action.
`product-assessment-domain.ts` owns the evidence gates, candidate lookup, response
validation and persistence; the HTTP adapter runs a one-shot research turn with
only `web_search`, `source_check`, `fetch_content` and `get_search_content`. No
coding, messaging or idea-writing tools are available. Page text is untrusted.

The rubric is tailored to a solo, low-budget improvement/context transfer without
inventing the user's skills, hours, audience or precise budget:

1. Demand and payment evidence.
2. A measurable improvement or evidence-backed context-transfer hypothesis.
3. Feasibility of a small solo prototype, not copying the full incumbent.
4. A practical path to first users.
5. Pricing, variable costs and margin risks.
6. Maintenance, platform dependencies, privacy, regulation and licensing.

Verdicts are **Worth a small test / Research first / Pass for now**, not a made-up
numerical ROI or permission to build. Every non-unknown criterion needs a source
reference and a quotation. A positive verdict requires reading-tool usage, at
least two distinct non-directory source URLs (including the official product or
App Store), supported demand/wedge/distribution, and no material unknown needed
before the first experiment. Concrete blockers can reject despite other unknowns;
missing information alone cannot. Unknown outcomes of the proposed experiment do
not by themselves prevent a small test. Citations are AI-supplied, not an independent
quote audit; the UI labels that limitation and never claims high confidence.

Assessments include the counterargument, narrow wedge, next experiment with a
proposed threshold, stop rule, unknowns and expandable source quotations. Saved
analysis lives separately in `product-assessments.json`, not in user-authored idea
notes or pipeline state. Changed directory facts mark the result stale; a source
change during a run rejects its obsolete write. Failure/cancellation keeps prior
results. A successful POST acknowledgement survives a failed subsequent GET.

The action uses the configured default model, one isolated session, a serialized
lock and a 180-second research-turn timeout, with a stop button. The prompt also
limits search/page counts and suppresses the search curator; those counts are
instructions, not a second hard runtime quota. Neither daily discovery nor opening
or polling the page runs paid assessments. A reload reads the stored result;
reassessment is another explicit action.

### Observed crawling limits (anonymous check, 2026-10-13)

The specified directory returned HTTP 200 and the current parser extracted 11
public candidates, without a CAPTCHA in this check. Its anonymous HTML contained
no infinite-scroll sentinel; the page's script says that sentinel is absent for
non-Pro visitors. This is a **public snapshot, not the complete directory**.
No hidden or authenticated pagination was requested.

Details vary: the Pushup Quest story was readable; the AudioPen business page
returned public summary/pricing-basis text, but the readable-content extractor
reported incomplete content. Registration/premium gates are present on the site.
That is not a blanket inability to fetch HTML, nor a guarantee all details are
accessible. Also check dates and definitions: the Pushup Quest list said $800/month
while its story mentioned $2,000 in August 2026. Neither number is silently promoted
to current recurring revenue. Revenue, native-iOS availability, technical stacks
and customer complaints need product-specific corroboration.

## Map and personal decisions

The eight map branches cover positioning, validation, implementation, billing,
distribution, release, operations and economics. They are parallel responsibilities,
not an automatic pipeline or readiness score. The previous Papermark/Subscribr
transcript breakdowns remain editorial references inside the map, not candidate
products in the directory. Their revenue is historical founder reporting, not an
independent audit or current pricing.

`Idea.launchPlan` is optional. `updateLaunchDecision` validates and merges one
branch under the store lock; `expectedUpdatedAt` rejects stale same-branch writes.
Different branches merge. Saving does not change the idea's stage, notes or parked
state. Drafts survive branch/project/view switches; failures retain them. Successful
PATCH acknowledgements remain visible if the subsequent refresh fails. Leaving
with map drafts warns through `beforeunload`; drafts are not durable offline storage.
Export contains saved decisions, not unsaved drafts. The cost calculator is an
unsaved scratchpad with no assumed prices.

### Personal idea autosave

`useIdeaText` owns each mounted idea's name/note drafts, PATCH queue, edit versions,
recovery receipts, debounce, retry, departure warning and deletion ordering.
`IdeaRow` is the UI/HTTP adapter: it adopts confirmed idea receipts, supplies the
write/delete operations, and handles confirmation, focus and recovery preview.
Key the row by idea id; stage, bet and link writes stay outside this text module.
The module serializes name and note PATCHes while keeping text editable.
Per-field edit versions prevent an old success from clearing
a newer draft and an old failure from requeueing obsolete text. Reverting a name to
the currently stored value still sends a write: a different name may already be in
flight. Successful idea receipts update the shared view before refreshing, so a
failed GET cannot roll the displayed note back.

Dirty text or unfinished writes install a native `beforeunload` warning, including
while the row/view is folded. Unmount clears unsent debounce timers. Confirmed delete
waits for queued text writes, stops the debounce, and fences retry callbacks before
DELETE (including a retry resuming between its name and note saves). All text entry
points stay closed during/after successful removal; a failed delete reopens editing
and restores the unsent note for explicit retry. Name/note edits also
have [bounded local text recovery](text-recovery.md), offered when the notebook is
reopened, with explicit preview/restore/discard. Different fields/tabs have separate
copies; exact acknowledged revisions are cleared. Mobile termination need not deliver
`beforeunload`, so backup happens at edit time. This is not offline synchronization
or cross-device conflict resolution; map decisions and new-idea capture are excluded.

Regression: `components/robin/useIdeaText.test.mjs` exercises the module interface
with controlled transport and real local-recovery functions: revision ordering,
independent fields/ideas, quota failure, retries, unmount and delete interleavings.
`e2e/product-autosave.mjs` mocks slow/failed saves, old-failure/new-success,
latest-failure retry, reverting a name, failed reads after acknowledged writes,
departure warnings and deletion ordering. It never writes personal ideas.

## Presentation and navigation

The default `/product` entry is the **lab overview**, not the external directory.
The index contains overview, the idea/capture inbox, active and parked ideas, and
reference links to discovery and the launch map. Selecting an idea shows its
Overview / Experiments / Outreach / Evidence & decisions tabs. Stage references and
the original bet controls remain available in a disclosure; a stage question is
reference guidance, not a newly verified claim. Existing bet settlement behavior
is unchanged and must not be confused with the separate validation decision path.

The primary capture action opens and focuses the inbox form without writing or
running AI. Its existing direct-idea and raw-capture/classification actions retain
their explicit submit/review boundaries. The empty overview offers discovery as an
alternative. Directory reads pause while hidden, and assessments/map editors remain
mounted across switches. The opportunity source restriction is unchanged.

The reading measure and spacing retain the earlier
[Linear](https://linear.app/now/how-we-redesigned-the-linear-ui) and
[Are.na](https://www.are.na/about) influences. Independent idea/capture/directory
cards now use the shared rounded surface tokens on the workspace ground; controls
use UI typography, without replacing the reading text's serif face. Mobile keeps
the workbench title and capture action together. Directory cards expose source
metadata and keep hypotheses in native disclosures. Color supplements visible
labels, never substitutes for them.

`?view=ideas|inbox|experiments|evidence|outreach|discover|map` is history-aware;
`idea` selects a product and `experiment` selects a validation project belonging to
it. Legacy `idea` / `stage` links still work; unknown views use the ideas overview.
Editors remain mounted across view switches. Back/Forward retains per-URL scroll
restoration and visited experiment editors, including dirty revisions. Opening an
idea's map changes view and idea in one history entry. The map's keyboard/return
navigation remains intact. Container queries collapse the project index when the
reading area becomes narrow; below the split breakpoint the page switches between
workspace and partner without unmounting either.

`ProductIncubatorShell` retains one mounted `AgentPanel` per visited idea plus a
general context. Requests, pending briefs, transcripts, drafts and late replies stay
with that idea. Switching context or opening the initially visible desktop panel
never sends a turn. Existing research tools and server sessions are unchanged.
A reply can be explicitly previewed, edited, cancelled or appended to the selected
idea's current note through its existing autosave queue. The keyed native dialog
seeds text before opening, so reopening cannot overwrite edits with an old preview.
Appending does not approve standards, change stage or overwrite the existing note;
save failures use the notebook's existing retry/recovery feedback.

`ProductExperiments` is only a frontend adapter: it filters existing validation
summaries by exact `ideaId`, verifies the loaded project's association, and embeds
`NewProjectForm` / `ValidationProjectWorkspace`. Initialization and creation remain
explicit. Only visited editors mount; inactive boards/editors stop polling while
retaining local drafts. The experiment's discussion is portaled to the right pane,
not sent to the general product assistant. Plan/evidence forms stay mounted when
tabs change, and preserve revision checks, explicit approval and human decisions.
An experiment created while its idea is hidden does not hijack the current URL.
Validation drafts are session-local, not durable offline storage. Unlinked legacy
validation projects remain accessible from All market validation.

Each idea links to `/product/validation?idea=<id>`. This only opens an editable
name/note snapshot: storage initialization and project creation remain separate,
explicit actions. Failed/missing source reads offer retry/cancel, not a blank
replacement. Later polls cannot overwrite or unmount the prefilled draft. The
original idea, its stage and the legacy CRM remain unchanged.

### Glass presentation

The directory uses the shared `.robin-workspace-rail` CSS frost, inset from the workspace edge. The existing reading scrollport stays opaque, now a separate rounded document with visible ground around it; forms and idea cards do not gain nested blur. Project views reuse the clear Glass tab material, rounded selected controls and 44px targets, wrapping rather than clipping long labels. Header/partner dividers no longer cut the shared background; mobile uses the short Partner label and omits the repeated English sublabel. Ordinary palettes retain their existing material/layout, apart from this mobile label simplification.

Escape closes the narrow project directory and restores its trigger focus. Choosing a reference view focuses the reading pane, rather than leaving focus in hidden navigation. Mounting, autosave/recovery, validation approvals and scoped partner sessions are unchanged. `e2e/workspace-ground.mjs` checks both Glass palettes, 320–1440px/landscape, solid accessibility fallbacks, directory focus, view history and opening/closing the partner with zero model or data writes.

## Checks

```sh
node --experimental-strip-types --test \
  extension/robin/product-*.test.mjs \
  components/robin/Product*.test.mjs \
  components/robin/product*.test.mjs \
  components/robin/useIdeaText.test.mjs \
  lib/text-recovery.test.mjs \
  app/api/robin/product-opportunities/assess/route.test.mjs

PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local \
  --experimental-strip-types e2e/product-workspace.mjs
PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local \
  --experimental-strip-types e2e/product-lab.mjs
PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local \
  --experimental-strip-types e2e/product-autosave.mjs
```

The lab integration check uses a temporary real validation database behind mocked
HTTP. It covers idea-scoped drafts and late replies, preview cancellation/editing/
append, clean versus dirty bet updates, explicit initialization/creation, retained
forms and browser history, plan save failure, approval despite failed reads,
counterevidence and decisions, cross-idea experiment rejection, and Chinese/English
light/dark layouts from 320–1600px. It asserts zero Outreach requests and uses no
real model. Screenshots are in `/tmp/product-lab`; phone checks are browser viewport
emulation, not physical-device verification.

Browser checks mock all Robin APIs: no personal records or paid research runs.
They cover explicit assessment/persistence/cancellation, stale results and failed
refresh after assessment, directory discovery/adoption, map persistence, failed/conflicting saves,
failed refresh after a successful write, drafts, export, keyboard navigation,
phone/tablet/desktop layouts, an open assistant and English text wrapping.
