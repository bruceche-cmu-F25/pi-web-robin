# Local text recovery

Existing Notes drafts (title, text, Notion destination), existing Product ideas
(name, notebook), and the Resume workspace (LaTeX source) keep best-effort browser-local copies of unacknowledged edits.
This is recovery, not offline synchronization, version history or server conflict detection.

## Behavior

- Copy text synchronously at the edit boundary, before the network debounce. Do not
  depend on `beforeunload`, `pagehide` or mobile background callbacks being delivered.
- Reopening a note or opening an idea's notebook offers previous copies in
  `TextRecoveryNotice`. The server-loaded editor is not replaced automatically.
  Preview renders plain text; **Restore draft** replaces those fields explicitly.
  Notes/body text follows existing autosave; an idea name focuses its input and
  still saves on blur. **Discard backup** changes local storage only.
- A restored copy is removed only after its replacement has been backed up locally.
  Failed network writes retain the replacement; confirmed writes clear their own
  receipt, never a newer revision. Lost response receipts may leave a copy even
  though the server saved it: review rather than assume it is newer than the server.
- Each component mount has a random writer id; name and note use separate slots.
  Every edit has an immutable storage key. Save the new copy before removing the
  previous one. This avoids a cross-tab read/remove race: localStorage has no CAS.
  Other tabs' copies are never overwritten by editing or by a save acknowledgement.
  Confirmed record deletion/archive removes that record's local copies.
- `getRandomValues` creates ids, so HTTP LAN origins do not require `randomUUID`.

## Boundaries

`lib/text-recovery.ts` uses the `pi-web:text-recovery:v1:` localStorage prefix.
Serialized records are limited to 256,000 UTF-16 code units to bound synchronous
work. Oversized/quota-denied writes retain the earlier copy and show a warning;
text is never truncated and unrelated drafts are not evicted. Malformed or unknown
records are left intact, reported as unavailable, and never applied.

Copies are plain text in this browser/origin, not encrypted storage or a server
backup. Browser storage clearing/eviction, private-session teardown and storage
failures can still lose them. A closed tab is not a hardware crash/disk-durability
guarantee. Opening existing records requires their server data; this is not a
fully offline app. Records deleted elsewhere are not recreated from backups.
The Resume editor uses its own `resume/main` scope and manual Save; restoration does not save automatically. Its server saves are revision-checked (see [Resume workspace](agents/resume.md)).
The new-idea capture form, product map decisions, attachments, canvas and other
editors are outside this scope. Concurrent server edits still use existing APIs,
without an expected-version check; manual restoration is not conflict resolution.

## Checks

- `node --experimental-strip-types --test lib/text-recovery.test.mjs`: exact receipts,
  A → B → A, concurrent discard/edit, separate tabs/fields/scopes, bounds, quota,
  malformed records and deletion scope.
- `PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local --experimental-strip-types e2e/text-recovery.mjs`:
  mocked APIs, departure with lifecycle callbacks suppressed, server-version
  preservation, manual restore/discard, failed-save retention, two-tab copies,
  quota warning, independent name/note receipts, unavailable `randomUUID`, Chinese
  and English recovery controls and 320–1440px layout. Also samples 2,000/200,000
  character input-event processing with 4× CPU throttling; this is not INP or real
  device certification. No personal records or paid operations are touched.
