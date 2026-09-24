# Jarvis market discovery

Open **Product → Jarvis**, or `/product/jarvis`.

This is a single market-discovery campaign, not an email sender. The target is **100 sendable core contacts** — core candidates with a publicly sourced individual work email — whose roles create information burden but who sit mostly outside the AI/tech echo chamber:

- 30 independent-clinic / specialty-practice owners and operators
- 25 small/midsize professional-services firm leaders
- 30 non-tech industry executives and association operators
- 15 non-technical leaders at small technology companies

The original tech/VC/research-heavy batch is retained as `adjacent` for comparison and does not count toward 100. A core candidate without a public work email stays in the list but does **not** advance the target; bounced and do-not-contact records drop out of it. Sent/replied counts are separate.

## Workflow

1. **Find next 3** to inspect a small batch, or **Research to 100** to run successive batches. The latter asks for confirmation because it consumes the configured model/search allowance.
2. Inspect the person's source quotation, role and **need hypothesis**. A hypothesis is not evidence that they have expressed a problem.
3. Inspect the public work-email source. `source_found` means the server saw the literal address on that page; it is **not** ownership, SMTP/deliverability, consent or legal-compliance verification. Obfuscated/JS-only/unreachable sources remain `unconfirmed`; missing addresses are never guessed.
4. Drafts use Bruce's outreach text; `area` fills "I came across your work in ___" (falls back to industry). Edit the subject/body and click **Approve identity, email and draft**. This enables Gmail and `mailto:` composer links. Neither sends mail nor marks the record sent. Check applicable outreach rules before contacting someone.
5. Send yourself, then mark **Sent**. Record **Replied**, **Interested**, **Declined**, **Bounced**, or **Do not contact** manually. Real needs/quotes and interview notes have their own fields, separate from the generated hypothesis.
6. Research never overwrites existing contacts, edited drafts, notes, replies or suppression. Identity deduplication uses normalized name/company or profile, and exact email. Shared team pages do not merge different people.

Draft edits revoke prior approval; changing an email requires a public source and an exact quotation containing it. Declined/bounced/do-not-contact records have no compose links. Do-not-contact is not reopenable through the API/UI.

## Research lifecycle

- Existing `runScopedAssistantTurn`, existing configured model/search service, isolated one-shot session.
- Exact tool allow-list: `web_search`, `fetch_content`, `get_search_content`. No Gmail, filesystem, personal-profile, or write tools.
- Model output must be a bounded JSON envelope. Server validates each candidate and then writes through `jarvis-domain.ts`; research cannot set user-owned status or reply fields.
- At most 3 candidates per batch (five-person batches hit the turn timeout), 30 turns per run, 4 minutes per turn. Three consecutive batches that add no sendable contact stop the job. A failed turn stops rather than silently spending on retries. Saved earlier batches survive.
- One background job on the local Next server, held in `globalThis` across hot reload. Closing the page does not stop it; **Stop research** does. Server restart interrupts it, which the page reports honestly; click again to resume toward the total target.
- This is not a durable worker queue for serverless or multiple server processes. Use a durable queue before deploying it that way.

## Storage and script

Data stays outside the repo in `~/.pi/robin/jarvis-discovery.json` (or `ROBIN_DATA_DIR`). The domain uses the existing locked, atomic JSON store. It includes status history and timestamps. GETs are read-only. All API writes use the existing same-origin and authentication guards.

With the standard dev server already running:

```sh
node --env-file-if-exists=.env.local --experimental-strip-types scripts/jarvis-discovery.ts status
node --env-file-if-exists=.env.local --experimental-strip-types scripts/jarvis-discovery.ts discover 100
node --env-file-if-exists=.env.local --experimental-strip-types scripts/jarvis-discovery.ts stop
node --env-file-if-exists=.env.local --experimental-strip-types scripts/jarvis-discovery.ts update CONTACT_ID replied
node --env-file-if-exists=.env.local --experimental-strip-types scripts/jarvis-discovery.ts note CONTACT_ID "Their actual feedback"
node --env-file-if-exists=.env.local --experimental-strip-types scripts/jarvis-discovery.ts export > /tmp/jarvis-export.json
```

`discover N` targets **N sendable core contacts** in total, not N additional; maximum 100. Adjacent records and people without a sourced email do not advance it. `report [file.html]` writes the same self-contained HTML list as the page's **Export HTML** button (`GET /api/robin/jarvis/report`, `?inline=1` to view in the browser); compose links in it follow the same approval gate as the page. The script calls the same HTTP API as the page, using `PI_WEB_PASSWORD` without printing it. `PI_WEB_URL` defaults to `http://127.0.0.1:30141`. No sending API exists.

## Email template

Edit `scripts/jarvis-email-template.txt` (`Subject: ...`, a blank line, then the body), then preview and save:

```sh
node --env-file-if-exists=.env.local --experimental-strip-types scripts/jarvis-discovery.ts template           # dry run + preview
node --env-file-if-exists=.env.local --experimental-strip-types scripts/jarvis-discovery.ts template --apply   # save
```

Placeholders: `{{firstName}}` (a contact's `firstName` override, else the first word of the name), `{{name}}`, `{{company}}`, `{{role}}`, `{{area}}`, and `{{work}}` ("your work leading X" / "your work in X"). An unknown placeholder is rejected. Saving rewrites only drafts that are unapproved, still `new`, and exactly what the previous template produced; edited, approved or contacted drafts are kept. New research uses the saved template.

The contact editor and every row of the HTML list have **Copy email / subject / body** buttons. The HTML list also has its own **Export HTML** button that saves the page as a standalone file.

## Checks

```sh
node_modules/.bin/tsc --noEmit
node --experimental-strip-types --test extension/robin/jarvis-domain.test.mjs lib/jarvis-discovery.test.mjs
# In an authenticated disposable browser on /product/jarvis:
playwright-cli -s=jarvis-check run-code --filename=scripts/check-jarvis-ui.playwright.js
```

The browser test intercepts all Jarvis API traffic; it never edits real contacts or runs real research. It covers research/stop, review gating, encoded compose links, failed-save preservation, unsaved-edit warnings, sent/replied/suppression, interview notes, filters, and desktop/mobile layouts.
