# Cold Reach CRM

`/outreach/research` is the Cold Reach CRM. `/outreach` and the historical `/product/jarvis` bookmark lead here. Jarvis is the first supported product; the product selector currently contains only Jarvis. Independent discovery and storage for other products are deferred. Existing contacts, Gmail threads, drafts and send history stay in the Jarvis store.

## Workspace

The header identifies the product. The pipeline counts all of its contacts across email and social: Needs review, Ready, Contacted, Replied, Interested and Closed. Clicking a stage opens its complete list. The initial list focuses on current Shopify / DTC candidates; historical audiences remain under More filters. Channel counts reflect the filtered list, and social contacts are eligible even if they also have a sourced email.

The workspace retains the left-hand list and right-hand contact detail. The top navigation exposes Contacts, Review queue, Send queue and Templates. Select people independently of channel, then click Add to review queue. This persists the selection without approving or sending anything. Existing queue entries are deduplicated.

## Review and send

1. Review queue shows one person at a time: identity, every contact route, fit/evidence, channel selection and editable full message. Previous/Next and Review later let the user move through the queue; Remove from review leaves the contact in the CRM.
2. Approve → Send queue validates revision, sourced email or exact social route, and copy. It saves the approved message without setting the automatic email-outbox queue timestamp. Review queues survive reloads. Changed approved email copy or social routes require renewed review.
3. Send queue shows each approved person’s contact routes and approved message. Email has an explicit Robin send action and confirmation; social has Copy message, Open profile, and I sent it → confirm log. A person stays in the queue after a send while any other available, unskipped contact route remains, including routes whose messages are not prepared yet. Return to review allows editing without sending. Existing at-most-once email safeguards remain in force.
4. Templates opens first-email and follow-up editors directly from the homepage. The legacy automatic email outbox remains in Copy & outbox; moving people to the new Send queue never starts it.

`/outreach/batch` supports historical batch links, including old `/outreach?channel=email&ids=…` links. Ordinary work starts and returns within the CRM. Changing an address/profile or a concurrent contact update requires renewed review; already contacted, queued or suppressed contacts cannot enter a new batch.

## Verification

`node_modules/.bin/tsc --noEmit`, `npm run lint`, and `node --experimental-strip-types --test extension/robin/jarvis-domain.test.mjs lib/jarvis-discovery.test.mjs`.

Domain tests use a disposable `ROBIN_DATA_DIR`, including LinkedIn/X/TikTok approval, changed copy, manual contact/reply progression and email separation. Browser verification opens real batch previews without approving, queueing or sending them.

Recipient-facing copy uses “a product we’re building”, never the Jarvis product name. Legacy unsent drafts are presented in this form on read and persisted on the next write; changed copy loses approval and queue membership for fresh review. Sent and in-flight history stays intact. Follow-up subjects are also unnamed.

Copy & outbox has separate first-email and follow-up template editors. The first email asks whether the recipient would try an early version and share feedback; the free one-month trial offer belongs in the follow-up. Follow-up uses the original subject/thread and the current 24-hour, fresh-reply-check and one-follow-up rules. Saving its body validates placeholders and changes no outbox settings or send history. Updating the first template regenerates only eligible untouched drafts and reports the kept count.

## Sent and multiple platforms

Sent sits immediately after Send queue and includes legacy email history and manually logged social sends. It supports name/company search and expandable per-platform timestamps and message text. New workflow contacts can reopen their platform planner from Sent.

Send queue allows changing platforms and editing copy. Approve message for this platform saves an independent route and message snapshot without sending. Existing prepared platforms remain approved. A person stays in Send queue while any available, unskipped unsent platform remains (including unprepared platforms) and may also appear in Sent after their first send. The queue shows the remaining channel count and selects another pending channel after each send. Replies and closed contacts stop further channel planning. Unverified email addresses are not available send routes; previously skipped social routes do not prevent completion. New platforms require their own confirmation; already sent platforms cannot be re-planned or sent again. Additional-platform approval never enrolls email in the automatic outbox. Multi-platform domain tests cover both email-first and social-first sequences, remaining queue membership, suppression, stale revisions and duplicate prevention.

Send queue offers “Cannot message / Premium required · Skip LinkedIn” (and “Cannot message” for other social platforms). Skipping records `cannot-dm` without a sent timestamp, works before message approval, and keeps other unprepared routes in the queue. A skipped route can be restored by approving its message again. When every available route is sent or explicitly skipped, the person leaves Send queue.

## LinkedIn Connect tracking

Send queue has a “Connect request sent · Log” button. It only records a manually sent invitation, storing the profile URL and request timestamp separately from message history. The Connect table lists pending and accepted invitations, links to the recorded profile, and records acceptance when the user clicks “Accepted · Log”. Acceptance is checked manually on LinkedIn. Pending invitations cannot be planned or logged as LinkedIn messages, and do not return to Review queue; other available channels remain in Send queue. Acceptance restores LinkedIn to Send queue without sending anything; the table offers “Write message”. Changed profile URLs and stale revisions are rejected. Closed/replied contacts stay unavailable after acceptance.

## Separate sender account

The Cold Reach header has its own “Connect personal Gmail” control, shows the connected sender email, and links to Settings. Client ID / secret editing lives only in Settings → Cold Reach · Personal sender, separate from School email & Google Calendar. Inbox/calendar continue using the existing `google.json` grant; Cold Reach uses only `google-outreach.json`, never falls back to the school account, and requests Gmail read/send without calendar access. Each account uses its own OAuth client; both use the same callback URL. Cold Reach never falls back to the school OAuth client. Configure the Web application client in Settings → Cold Reach · Personal sender (`/dashboard/settings#cold-reach-email`); its credentials are stored separately under `outreachGoogle` in the existing protected secrets store (or `ROBIN_OUTREACH_GOOGLE_CLIENT_ID` / `ROBIN_OUTREACH_GOOGLE_CLIENT_SECRET`). Changing that client disconnects only the personal grant and disables the outbox. The secret is never returned by a status response. A single-use server nonce binds each authorization to its destination account. The sender email is verified through Gmail's profile endpoint before saving credentials.

Connecting or disconnecting the Cold Reach account disables the automatic outbox; users explicitly enable it again when ready. It does not disconnect the school account. Manual and automatic sends persist the sender email with the send attempt. Reply checks and automatic follow-ups only process threads belonging to the currently connected Cold Reach sender. Historical attempts without sender identity remain visible in Sent and are excluded from personal-account sync/follow-up. Token refresh cannot restore a disconnected or replaced account. Tests use temporary stores and mocked Google responses; no live mail is sent.

OAuth redirects use the browser's validated same-origin `Origin` when a relay rewrites the request scheme, rather than blindly copying the backend URL. The exact redirect URI is stored with the single-use account state and reused during token exchange; callback headers cannot change it. For the local HTTP dev server, register `http://localhost:30141/api/robin/google/callback` in the Google client's authorized redirect URIs and start authorization from that HTTP origin. Real HTTPS deployments keep HTTPS. Authorization links issued before this state change must be restarted.

### CRM overview

The Cold Reach workspace includes a **CRM overview** tab. It defaults to today in the browser's local timezone, with last-seven-days, all-time and specific-date views. Channel filters apply to the metrics, audience breakdown and activity table together. Search narrows the activity table only.

Metrics count confirmed initial email/social sends and recorded email follow-ups; contacts are deduplicated by lead ID across channels. Follow-ups are included in message totals. Queue claims, pending/uncertain attempts, drafts and LinkedIn connection invitations are excluded. Confirmed attempts provide fallback timestamps for older records. Social sends require manual logging; this is a record of sends, not delivery confirmation. Audience breakdowns use current persona/segment or industry, not historical snapshots. Email copy is labelled as the currently saved copy because immutable historical bodies are not available for every send.
