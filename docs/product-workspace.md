# Product workspace

`/product` separates opportunity discovery, a launch reference map and the user's
own ideas. CRM remains `/product/jarvis`; notebooks, capture, stages and existing
evidence links are preserved.

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

## Presentation and navigation

The light navigation, reading measure and spacing draw on
[Linear's redesign](https://linear.app/now/how-we-redesigned-the-linear-ui) and
[Are.na](https://www.are.na/about), while retaining Pi theme tokens and square
geometry. Directory cards expose source metadata and keep hypotheses in native
disclosures. Color supplements visible labels, never substitutes for them.

`?view=discover|map|ideas` is history-aware. Legacy `?idea=` / `?stage=` links open
My ideas without an explicit view. Editors remain mounted across view switches.
The map uses native controls; node selection reveals and focuses its guide, with
a return link. Container queries support phones and an open research assistant.

## Checks

```sh
node --experimental-strip-types --test \
  extension/robin/product-*.test.mjs \
  components/robin/Product*.test.mjs \
  components/robin/product*.test.mjs \
  app/api/robin/product-opportunities/assess/route.test.mjs

PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local \
  --experimental-strip-types e2e/product-workspace.mjs
```

Browser checks mock all Robin APIs: no personal records or paid research runs.
They cover explicit assessment/persistence/cancellation, stale results and failed
refresh after assessment, directory discovery/adoption, map persistence, failed/conflicting saves,
failed refresh after a successful write, drafts, export, keyboard navigation,
phone/tablet/desktop layouts, an open assistant and English text wrapping.
